/**
 * Note-taker status and controls (state lives in MeetingProvider).
 *
 * In a call the note-taker runs automatically on the call's microphone, so
 * this shows what it is hearing and lets you pause it. Outside a call it
 * offers a notes-only mode for people sitting in the same room.
 */

import { Mic, MicOff, Square } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useMeeting } from './MeetingProvider'

export function NoteTaker() {
  const meeting = useMeeting()
  const { listen, paused, taken, heard, pending, listenError } = meeting
  const inCall = meeting.call === 'joined' || meeting.call === 'joining'

  if (listen === 'idle' || listen === 'error') {
    return (
      <div className="flex flex-col gap-1.5">
        {!inCall && (
          <button
            type="button"
            data-testid="notetaker-start"
            onClick={() => void meeting.startListening()}
            title="For people in the same room: take notes from this microphone without joining the call"
            className="flex items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground hover:bg-accent"
          >
            <Mic className="h-4 w-4" /> Take notes without a call
          </button>
        )}
        {listenError && (
          <p role="alert" className="text-xs text-destructive">
            {listenError}
          </p>
        )}
        {listen === 'idle' && (taken > 0 || pending > 0) && (
          <p className="text-xs text-muted-foreground" data-testid="notetaker-result">
            {pending > 0 ? 'Finishing the last clip…' : `Stopped. ${taken} ${taken === 1 ? 'note' : 'notes'} taken.`}
          </p>
        )}
      </div>
    )
  }

  const live = listen === 'live'
  // In a call, a muted microphone carries silence: nothing reaches the notes.
  const muted = inCall && meeting.micMuted
  return (
    <div
      data-testid="notetaker-live"
      className="flex flex-col gap-1.5 rounded-lg border border-border bg-background px-3 py-2"
    >
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <span
          className={cn('h-2.5 w-2.5 rounded-full', live && !paused && !muted ? 'animate-pulse bg-red-500' : 'bg-muted-foreground')}
        />
        {!live ? 'Starting…' : muted ? 'Muted' : paused ? 'Notes paused' : 'Taking notes'}
        {live && (
          <span className="font-normal text-muted-foreground">
            · {taken} {taken === 1 ? 'note' : 'notes'}
          </span>
        )}
        <button
          type="button"
          aria-label={paused ? 'Resume note-taking' : 'Pause note-taking'}
          title={paused ? 'Resume note-taking' : 'Pause note-taking (you stay in the call)'}
          disabled={!live}
          onClick={meeting.togglePause}
          className="ml-auto rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
        >
          {paused ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
        </button>
        {!inCall && (
          <button
            type="button"
            data-testid="notetaker-stop"
            aria-label="Stop note-taking"
            title="Stop"
            onClick={meeting.stopListening}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-destructive"
          >
            <Square className="h-4 w-4" />
          </button>
        )}
      </div>
      <p data-testid="notetaker-heard" className="line-clamp-2 min-h-[1rem] text-xs text-muted-foreground">
        {muted
          ? 'Unmute to speak. Notes are only taken from what you say.'
          : heard
            ? `“${heard.slice(-140)}”`
            : live
              ? 'Say something — notes appear a few seconds after you pause.'
              : ''}
      </p>
      {listenError && (
        <p role="alert" className="text-xs text-destructive">
          {listenError}
        </p>
      )}
    </div>
  )
}
