/**
 * Call controls in the board header: join, who is in the call and who is
 * speaking, mute, leave.
 */

import { Loader2, Mic, MicOff, Phone, PhoneOff } from 'lucide-react'
import { getUserColor } from 'deepspace'
import { cn } from '@/lib/utils'
import { useMeeting } from './MeetingProvider'

export function MeetingBar() {
  const meeting = useMeeting()

  if (meeting.call !== 'joined') {
    return (
      <div className="flex items-center gap-2">
        {meeting.call === 'error' && meeting.callError && (
          <span role="alert" className="max-w-[240px] truncate text-xs text-destructive" title={meeting.callError}>
            {meeting.callError}
          </span>
        )}
        <button
          type="button"
          data-testid="join-meeting"
          disabled={meeting.call === 'joining'}
          onClick={() => void meeting.join()}
          title="Talk with everyone on this board. Notes are taken automatically while you are in the meeting."
          className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
        >
          {meeting.call === 'joining' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Phone className="h-4 w-4" />}
          {meeting.call === 'joining' ? 'Joining…' : 'Join meeting'}
        </button>
      </div>
    )
  }

  return (
    <div data-testid="meeting-bar" className="flex items-center gap-2">
      <ul className="flex items-center gap-1" aria-label="People in the meeting">
        {meeting.participants.map((person) => (
          <li
            key={person.id}
            data-testid="call-participant"
            data-speaking={person.speaking ? 'true' : 'false'}
            title={`${person.name}${person.isLocal ? ' (you)' : ''}${person.muted ? ' — muted' : ''}`}
            className={cn(
              'relative flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-semibold text-white ring-2 ring-offset-1 ring-offset-card transition-shadow',
              person.speaking ? 'ring-emerald-500' : 'ring-transparent',
            )}
            style={{ background: getUserColor(person.id) }}
          >
            {person.name.slice(0, 1).toUpperCase()}
            {person.muted && (
              <span className="absolute -right-1 -bottom-1 rounded-full bg-card p-0.5 text-muted-foreground">
                <MicOff className="h-2.5 w-2.5" />
              </span>
            )}
          </li>
        ))}
      </ul>
      <span className="text-xs text-muted-foreground" data-testid="call-count">
        {meeting.participants.length} in meeting
      </span>
      <button
        type="button"
        data-testid="toggle-mic"
        aria-label={meeting.micMuted ? 'Unmute microphone' : 'Mute microphone'}
        aria-pressed={meeting.micMuted}
        title={meeting.micMuted ? 'Unmute' : 'Mute'}
        onClick={meeting.toggleMic}
        className={cn(
          'rounded-lg border border-border p-1.5 hover:bg-accent',
          meeting.micMuted ? 'bg-accent text-destructive' : 'text-foreground',
        )}
      >
        {meeting.micMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
      </button>
      <button
        type="button"
        data-testid="leave-meeting"
        onClick={meeting.leave}
        className="flex items-center gap-1.5 rounded-lg bg-destructive px-3 py-1.5 text-sm font-medium text-destructive-foreground hover:opacity-90"
      >
        <PhoneOff className="h-4 w-4" /> Leave
      </button>
    </div>
  )
}
