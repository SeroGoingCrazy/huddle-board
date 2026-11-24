/**
 * Voice note-taker — browser half. Listens to this person's microphone and
 * turns what they say into notes, without being asked.
 *
 * Pipeline: microphone → raw samples (an audio worklet) → loudness-based
 * utterance cutting (lib/utterances.ts) → one short WAV per utterance
 * (lib/wav.ts) → POST /api/boards/:id/listen, which
 * transcribes it and writes the notes (ai/note-taker.ts). Notes then arrive
 * like any other record, for everyone on the board.
 *
 * Scope decision: each browser hears only its own microphone. Huddle does not
 * host the call (people are already in a room or on a meeting app); it only
 * takes notes. That makes attribution trivial (a note is created by whoever
 * spoke) and avoids multi-party audio routing. The cost: everyone who wants
 * their words captured has to press the button themselves.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { getAuthToken } from 'deepspace'
import { Mic, MicOff, Square } from 'lucide-react'
import { cn } from '@/lib/utils'
import { createSegmenter } from '@/lib/utterances'
import { encodeWav, rms, toBase64 } from '@/lib/wav'

/** Speech models are trained on 16 kHz; it also keeps uploads small. */
const SAMPLE_RATE = 16_000
/** Samples per loudness decision (80 ms). */
const TICK_SAMPLES = SAMPLE_RATE * 0.08
/** Auto-stop, so a forgotten tab cannot listen (and bill) indefinitely. */
const MAX_SESSION_MS = 45 * 60 * 1000
const CONTEXT_CHARS = 400

type Status = 'idle' | 'starting' | 'live' | 'error'

interface ListenResponse {
  text?: string
  added?: number
  scoutRequest?: string
  error?: string
}

interface Props {
  boardId: string
  /** Start a Scout run. Returns false when Scout could not start. */
  askScout: (request: string) => boolean
}

/** Everything one listening session owns, so stop() can release all of it. */
interface Session {
  stream: MediaStream
  audioContext: AudioContext
  stopped: boolean
  /** End the segment in progress, uploading it only if `send`. */
  cut: (send: boolean) => void
  hasSpeech: () => boolean
}

export function NoteTaker({ boardId, askScout }: Props) {
  const [status, setStatus] = useState<Status>('idle')
  const [paused, setPaused] = useState(false)
  const [taken, setTaken] = useState(0)
  const [heard, setHeard] = useState('')
  const [pending, setPending] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const session = useRef<Session | null>(null)
  /** Clips are processed strictly in order so notes land in spoken order. */
  const queue = useRef<Promise<void>>(Promise.resolve())
  const transcript = useRef('')

  const sendClip = useCallback(
    async (clip: Uint8Array) => {
      try {
        const audio = toBase64(clip)
        const token = await getAuthToken()
        const res = await fetch(`/api/boards/${encodeURIComponent(boardId)}/listen`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ audio, context: transcript.current.slice(-CONTEXT_CHARS) }),
        })
        const body = (await res.json().catch(() => ({}))) as ListenResponse
        if (body.text) {
          transcript.current = `${transcript.current} ${body.text}`.trim()
          setHeard(body.text)
        }
        if (body.added) setTaken((n) => n + body.added!)
        if (body.scoutRequest) askScout(body.scoutRequest)
        setError(res.ok ? null : (body.error ?? 'Could not take notes from that clip.'))
        // Allowance spent: stop recording rather than keep uploading refusals.
        if (res.status === 429) stopRef.current()
      } catch {
        setError('Lost connection while sending audio.')
      }
    },
    [askScout, boardId],
  )

  const enqueue = useCallback(
    (clip: Uint8Array) => {
      setPending((n) => n + 1)
      queue.current = queue.current.then(() => sendClip(clip)).finally(() => setPending((n) => n - 1))
    },
    [sendClip],
  )

  const stopRef = useRef<() => void>(() => {})

  const stop = useCallback(() => {
    const s = session.current
    if (!s || s.stopped) return
    s.stopped = true
    // Flush the segment in progress: keep it only if someone was speaking.
    s.cut(s.hasSpeech())
    s.stream.getTracks().forEach((track) => track.stop())
    void s.audioContext.close()
    session.current = null
    setPaused(false)
    setStatus('idle')
  }, [])

  stopRef.current = stop

  // Release the microphone if the panel unmounts mid-session.
  useEffect(() => stop, [stop])

  const start = async () => {
    setStatus('starting')
    setError(null)
    setTaken(0)
    setHeard('')
    transcript.current = ''
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      })
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

      const current: Session = {
        stream,
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
        if (Date.now() > deadline) stop()
      }
      session.current = current
      setStatus('live')
    } catch (err) {
      const denied = err instanceof DOMException && err.name === 'NotAllowedError'
      setError(denied ? 'Microphone access was blocked. Allow it in the browser and try again.' : 'Could not start the microphone.')
      setStatus('error')
    }
  }

  const togglePause = () => {
    const s = session.current
    if (!s) return
    const next = !paused
    // A disabled track records silence, which the segmenter then discards.
    s.stream.getAudioTracks().forEach((track) => (track.enabled = !next))
    setPaused(next)
  }

  if (status === 'idle' || status === 'error') {
    return (
      <div className="flex flex-col gap-1.5">
        <button
          type="button"
          data-testid="notetaker-start"
          onClick={() => void start()}
          className="flex items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground hover:bg-accent"
        >
          <Mic className="h-4 w-4" /> Take notes while I talk
        </button>
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        {status === 'idle' && (taken > 0 || pending > 0) && (
          <p className="text-xs text-muted-foreground" data-testid="notetaker-result">
            {pending > 0 ? 'Finishing the last clip…' : `Stopped. ${taken} ${taken === 1 ? 'note' : 'notes'} taken.`}
          </p>
        )}
      </div>
    )
  }

  const live = status === 'live'
  return (
    <div
      data-testid="notetaker-live"
      className="flex flex-col gap-1.5 rounded-lg border border-border bg-background px-3 py-2"
    >
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <span
          className={cn('h-2.5 w-2.5 rounded-full', live && !paused ? 'animate-pulse bg-red-500' : 'bg-muted-foreground')}
        />
        {!live ? 'Starting…' : paused ? 'Paused' : 'Listening'}
        {live && (
          <span className="font-normal text-muted-foreground">
            · {taken} {taken === 1 ? 'note' : 'notes'}
          </span>
        )}
        <button
          type="button"
          aria-label={paused ? 'Resume listening' : 'Pause listening'}
          title={paused ? 'Resume' : 'Pause'}
          disabled={!live}
          onClick={togglePause}
          className="ml-auto rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
        >
          {paused ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
        </button>
        <button
          type="button"
          data-testid="notetaker-stop"
          aria-label="Stop note-taking"
          title="Stop"
          onClick={stop}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-destructive"
        >
          <Square className="h-4 w-4" />
        </button>
      </div>
      <p data-testid="notetaker-heard" className="line-clamp-2 min-h-[1rem] text-xs text-muted-foreground">
        {heard ? `“${heard.slice(-140)}”` : live ? 'Say something — notes appear a few seconds after you pause.' : ''}
      </p>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
