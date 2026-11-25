/**
 * Meeting state for one board: the voice call and the note-taker, which share
 * a microphone.
 *
 *   Call        LiveKit room, one per board. People hear each other.
 *   Note-taker  This person's microphone → utterances → /listen → notes and
 *               transcript lines (lib/utterances.ts, lib/wav.ts,
 *               ai/note-taker.ts).
 *
 * Joining the call starts the note-taker on the SAME microphone track the
 * call publishes, so nobody has to remember a second button and muting in
 * the call also silences the notes. The note-taker can still run without a
 * call (people in one physical room), on its own microphone stream.
 *
 * Each browser transcribes only its own microphone. That is what makes the
 * transcript's "who said it" exact without any speaker-recognition model:
 * a line is written by the signed-in person whose microphone produced it.
 * The cost is that someone who is in the call from another app, or who has
 * not joined, is heard but not transcribed.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { getAuthToken } from 'deepspace'
import { Room, RoomEvent, Track } from 'livekit-client'
import { createSegmenter } from '@/lib/utterances'
import { encodeWav, rms, toBase64 } from '@/lib/wav'

/** Speech models are trained on 16 kHz; it also keeps uploads small. */
const SAMPLE_RATE = 16_000
/** Samples per loudness decision (80 ms). */
const TICK_SAMPLES = SAMPLE_RATE * 0.08
/** Auto-stop, so a forgotten tab cannot listen (and bill) indefinitely. */
const MAX_SESSION_MS = 90 * 60 * 1000
const CONTEXT_CHARS = 400

export type ListenStatus = 'idle' | 'starting' | 'live' | 'error'
export type CallStatus = 'idle' | 'joining' | 'joined' | 'error'

export interface CallParticipant {
  id: string
  name: string
  isLocal: boolean
  speaking: boolean
  muted: boolean
}

interface MeetingState {
  // Note-taker
  listen: ListenStatus
  paused: boolean
  taken: number
  heard: string
  pending: number
  listenError: string | null
  startListening: () => Promise<void>
  stopListening: () => void
  togglePause: () => void
  /** Scout registers how to start a run; spoken "Scout, …" requests use it. */
  registerScout: (ask: (request: string) => boolean) => void
  // Call
  call: CallStatus
  callError: string | null
  participants: CallParticipant[]
  micMuted: boolean
  join: () => Promise<void>
  leave: () => void
  toggleMic: () => void
}

const MeetingContext = createContext<MeetingState | null>(null)

export function useMeeting(): MeetingState {
  const value = useContext(MeetingContext)
  if (!value) throw new Error('useMeeting must be used inside <MeetingProvider>')
  return value
}

interface ListenResponse {
  text?: string
  added?: number
  scoutRequest?: string
  error?: string
}

/** Everything one listening session owns, so stop() can release all of it. */
interface ListenSession {
  stream: MediaStream
  /** False when the call owns the microphone: do not stop its tracks. */
  ownsStream: boolean
  audioContext: AudioContext
  stopped: boolean
  /** End the segment in progress, uploading it only if `send`. */
  cut: (send: boolean) => void
  hasSpeech: () => boolean
}

async function authedPost(path: string, body?: unknown): Promise<Response> {
  const token = await getAuthToken()
  return fetch(path, {
    method: 'POST',
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

export function MeetingProvider({ boardId, children }: { boardId: string; children: ReactNode }) {
  const boardPath = `/api/boards/${encodeURIComponent(boardId)}`

  // ── Note-taker ───────────────────────────────────────────────────────────
  const [listen, setListen] = useState<ListenStatus>('idle')
  const [paused, setPaused] = useState(false)
  const [taken, setTaken] = useState(0)
  const [heard, setHeard] = useState('')
  const [pending, setPending] = useState(0)
  const [listenError, setListenError] = useState<string | null>(null)

  const session = useRef<ListenSession | null>(null)
  const pausedRef = useRef(false)
  /** Clips are processed strictly in order so notes land in spoken order. */
  const queue = useRef<Promise<void>>(Promise.resolve())
  const transcript = useRef('')
  const askScout = useRef<(request: string) => boolean>(() => false)
  const stopListeningRef = useRef<() => void>(() => {})

  const registerScout = useCallback((ask: (request: string) => boolean) => {
    askScout.current = ask
  }, [])

  const sendClip = useCallback(
    async (clip: Uint8Array) => {
      try {
        const res = await authedPost(`${boardPath}/listen`, {
          audio: toBase64(clip),
          context: transcript.current.slice(-CONTEXT_CHARS),
        })
        const body = (await res.json().catch(() => ({}))) as ListenResponse
        if (body.text) {
          transcript.current = `${transcript.current} ${body.text}`.trim()
          setHeard(body.text)
        }
        if (body.added) setTaken((n) => n + body.added!)
        if (body.scoutRequest) askScout.current(body.scoutRequest)
        setListenError(res.ok ? null : (body.error ?? 'Could not take notes from that clip.'))
        // Allowance spent: stop recording rather than keep uploading refusals.
        if (res.status === 429) stopListeningRef.current()
      } catch {
        setListenError('Lost connection while sending audio.')
      }
    },
    [boardPath],
  )

  const enqueue = useCallback(
    (clip: Uint8Array) => {
      setPending((n) => n + 1)
      queue.current = queue.current.then(() => sendClip(clip)).finally(() => setPending((n) => n - 1))
    },
    [sendClip],
  )

  const stopListening = useCallback(() => {
    const s = session.current
    if (!s || s.stopped) return
    s.stopped = true
    // Flush the segment in progress: keep it only if someone was speaking.
    s.cut(s.hasSpeech())
    if (s.ownsStream) s.stream.getTracks().forEach((track) => track.stop())
    void s.audioContext.close()
    session.current = null
    pausedRef.current = false
    setPaused(false)
    setListen('idle')
  }, [])
  stopListeningRef.current = stopListening

  /** Start cutting `source` (or a fresh microphone stream) into utterances. */
  const listenTo = useCallback(
    async (source?: MediaStream) => {
      if (session.current) return
      setListen('starting')
      setListenError(null)
      setTaken(0)
      setHeard('')
      transcript.current = ''
      try {
        const stream =
          source ??
          (await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true },
          }))
        // The context resamples the microphone to SAMPLE_RATE for us.
        const audioContext = new AudioContext({ sampleRate: SAMPLE_RATE })
        await audioContext.audioWorklet.addModule('/audio-tap.worklet.js')
        const tap = new AudioWorkletNode(audioContext, 'huddle-tap')
        audioContext.createMediaStreamSource(stream).connect(tap)

        const segmenter = createSegmenter()
        /** Samples of the utterance in progress. */
        let segment: Float32Array[] = []
        /** Samples since the last loudness decision. */
        let tickBlock: Float32Array[] = []
        let tickLength = 0

        const current: ListenSession = {
          stream,
          ownsStream: !source,
          audioContext,
          stopped: false,
          hasSpeech: segmenter.hasSpeech,
          cut: (send) => {
            if (send) enqueue(encodeWav(segment, SAMPLE_RATE))
            segment = []
            segmenter.reset()
          },
        }
        const deadline = Date.now() + MAX_SESSION_MS
        tap.port.onmessage = (event: MessageEvent<Float32Array>) => {
          if (current.stopped) return
          if (pausedRef.current) {
            // Paused: finish what was being said, then drop audio unheard.
            if (segment.length > 0) current.cut(segmenter.hasSpeech())
            return
          }
          segment.push(event.data)
          tickBlock.push(event.data)
          tickLength += event.data.length
          if (tickLength < TICK_SAMPLES) return

          const block = new Float32Array(tickLength)
          let offset = 0
          for (const part of tickBlock) {
            block.set(part, offset)
            offset += part.length
          }
          const decision = segmenter.tick(rms(block), (tickLength / SAMPLE_RATE) * 1000)
          tickBlock = []
          tickLength = 0
          if (decision !== 'continue') current.cut(decision === 'send')
          if (Date.now() > deadline) stopListeningRef.current()
        }
        session.current = current
        setListen('live')
      } catch (err) {
        const denied = err instanceof DOMException && err.name === 'NotAllowedError'
        setListenError(
          denied
            ? 'Microphone access was blocked. Allow it in the browser and try again.'
            : 'Could not start the microphone.',
        )
        setListen('error')
      }
    },
    [enqueue],
  )

  const startListening = useCallback(() => listenTo(), [listenTo])

  const togglePause = useCallback(() => {
    if (!session.current) return
    pausedRef.current = !pausedRef.current
    setPaused(pausedRef.current)
  }, [])

  // ── Call ─────────────────────────────────────────────────────────────────
  const [call, setCall] = useState<CallStatus>('idle')
  const [callError, setCallError] = useState<string | null>(null)
  const [participants, setParticipants] = useState<CallParticipant[]>([])
  const [micMuted, setMicMuted] = useState(false)
  const room = useRef<Room | null>(null)
  /** Remote voices play through <audio> elements kept here, off-screen. */
  const speakers = useRef<HTMLDivElement | null>(null)

  const leave = useCallback(() => {
    stopListeningRef.current()
    const current = room.current
    room.current = null
    if (current) void current.disconnect()
    speakers.current?.replaceChildren()
    setParticipants([])
    setMicMuted(false)
    setCall('idle')
  }, [])

  const join = useCallback(async () => {
    if (room.current) return
    setCall('joining')
    setCallError(null)
    // The note-taker may be running on its own microphone; the call takes over.
    stopListeningRef.current()
    const next = new Room()
    room.current = next
    try {
      const res = await authedPost(`${boardPath}/call/token`)
      const body = (await res.json().catch(() => ({}))) as { token?: string; url?: string; error?: string }
      if (!res.ok || !body.token || !body.url) throw new Error(body.error ?? 'Could not start the call.')

      const sync = () => {
        if (room.current !== next) return
        setParticipants(
          [next.localParticipant, ...next.remoteParticipants.values()].map((p) => ({
            id: p.identity,
            name: p.name || 'Guest',
            isLocal: p === next.localParticipant,
            speaking: p.isSpeaking,
            muted: !p.isMicrophoneEnabled,
          })),
        )
        setMicMuted(!next.localParticipant.isMicrophoneEnabled)
      }
      next
        .on(RoomEvent.ParticipantConnected, sync)
        .on(RoomEvent.ParticipantDisconnected, sync)
        .on(RoomEvent.ActiveSpeakersChanged, sync)
        .on(RoomEvent.TrackMuted, sync)
        .on(RoomEvent.TrackUnmuted, sync)
        .on(RoomEvent.LocalTrackPublished, sync)
        .on(RoomEvent.TrackSubscribed, (track) => {
          if (track.kind === Track.Kind.Audio) speakers.current?.appendChild(track.attach())
          sync()
        })
        .on(RoomEvent.TrackUnsubscribed, (track) => {
          track.detach().forEach((element) => element.remove())
          sync()
        })
        .on(RoomEvent.Disconnected, () => {
          if (room.current === next) leave()
        })

      await next.connect(body.url, body.token)
      await next.localParticipant.setMicrophoneEnabled(true)
      if (room.current !== next) return // left while connecting
      sync()
      setCall('joined')

      // Feed the note-taker the very track the call publishes.
      const mic = next.localParticipant.getTrackPublication(Track.Source.Microphone)?.track?.mediaStreamTrack
      if (mic) await listenTo(new MediaStream([mic]))
    } catch (err) {
      if (room.current === next) room.current = null
      void next.disconnect()
      const denied = err instanceof DOMException && err.name === 'NotAllowedError'
      setCallError(
        denied
          ? 'Microphone access was blocked. Allow it in the browser and try again.'
          : err instanceof Error
            ? err.message
            : 'Could not join the call.',
      )
      setCall('error')
    }
  }, [boardPath, leave, listenTo])

  const toggleMic = useCallback(() => {
    const current = room.current
    if (!current) return
    // A muted track carries silence, so the note-taker hears nothing either.
    void current.localParticipant.setMicrophoneEnabled(!current.localParticipant.isMicrophoneEnabled)
  }, [])

  // Leaving the board ends the call and releases the microphone.
  useEffect(() => leave, [leave])

  const value = useMemo<MeetingState>(
    () => ({
      listen,
      paused,
      taken,
      heard,
      pending,
      listenError,
      startListening,
      stopListening,
      togglePause,
      registerScout,
      call,
      callError,
      participants,
      micMuted,
      join,
      leave,
      toggleMic,
    }),
    [
      listen,
      paused,
      taken,
      heard,
      pending,
      listenError,
      startListening,
      stopListening,
      togglePause,
      registerScout,
      call,
      callError,
      participants,
      micMuted,
      join,
      leave,
      toggleMic,
    ],
  )

  return (
    <MeetingContext.Provider value={value}>
      {children}
      <div ref={speakers} data-testid="call-audio" hidden />
    </MeetingContext.Provider>
  )
}
