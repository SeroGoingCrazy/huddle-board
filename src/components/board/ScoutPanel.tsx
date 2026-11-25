/**
 * Ask Scout. The run's progress is read from Scout's `agents` record, not
 * from the HTTP response — so everyone on the board sees the same status
 * line and the same closing message, not just the person who asked.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { getAuthToken } from 'deepspace'
import type { RecordData } from 'deepspace'
import { ArrowUp, Loader2, Sparkles } from 'lucide-react'
import { SCOUT_COLOR } from '@/lib/note-colors'
import type { AgentState } from '@/schemas/board-schema'
import { useMeeting } from './MeetingProvider'
import { NoteTaker } from './NoteTaker'

const SUGGESTIONS = [
  { label: 'Group into themes', prompt: 'Group the notes on this board into themes.' },
  { label: 'Add what is missing', prompt: 'Read the board and add 5 ideas nobody has written yet.' },
  {
    label: 'Research it',
    prompt: 'Search the web for real examples related to this board and add the most useful ones as notes with sources.',
  },
  { label: 'Write the summary', prompt: 'Write a summary of this board.' },
]

interface Props {
  boardId: string
  agent: RecordData<AgentState> | undefined
}

export function ScoutPanel({ boardId, agent }: Props) {
  const [prompt, setPrompt] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const askRef = useRef<(text: string) => Promise<void>>(async () => {})
  const busy = !!agent?.data.busy
  const disabled = busy || sending
  // The voice note-taker calls ask() from outside the render cycle.
  const disabledRef = useRef(disabled)
  disabledRef.current = disabled

  const ask = async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || disabledRef.current) return
    disabledRef.current = true
    setSending(true)
    setError(null)
    try {
      const token = await getAuthToken()
      const res = await fetch(`/api/boards/${encodeURIComponent(boardId)}/agent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ prompt: trimmed }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        setError(body?.error ?? `Scout could not start (${res.status}).`)
        return
      }
      setPrompt('')
      // Drain the stream so the request stays open until the run ends; the
      // visible result arrives through the agents record.
      await res.text()
    } catch {
      setError('Lost connection to Scout. The run may still finish on the board.')
    } finally {
      setSending(false)
    }
  }

  askRef.current = ask

  /** Spoken request → Scout run. False when Scout is already busy. */
  const askByVoice = useCallback((request: string) => {
    if (disabledRef.current) return false
    void askRef.current(request)
    return true
  }, [])

  // Spoken "Scout, …" requests reach Scout through the meeting state.
  const { registerScout } = useMeeting()
  useEffect(() => registerScout(askByVoice), [registerScout, askByVoice])

  return (
    <section className="flex flex-col gap-3 border-b border-border p-4">
      <header className="flex items-center gap-2">
        <span
          className="flex h-7 w-7 items-center justify-center rounded-full text-white"
          style={{ background: SCOUT_COLOR }}
        >
          <Sparkles className="h-4 w-4" />
        </span>
        <div>
          <h2 className="text-sm font-semibold text-foreground">Scout</h2>
          <p className="text-xs text-muted-foreground">AI facilitator — works on the board with you</p>
        </div>
      </header>

      <div
        data-testid="scout-status"
        aria-live="polite"
        className="min-h-[52px] rounded-lg bg-muted px-3 py-2 text-sm text-foreground"
      >
        {busy ? (
          <div className="flex items-start gap-2">
            <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" style={{ color: SCOUT_COLOR }} />
            <div className="min-w-0">
              <p className="font-medium">{agent?.data.status || 'Working…'}</p>
              {agent?.data.prompt && (
                <p className="truncate text-xs text-muted-foreground">“{agent.data.prompt}”</p>
              )}
            </div>
          </div>
        ) : agent?.data.lastMessage ? (
          <p className="whitespace-pre-wrap">{agent.data.lastMessage}</p>
        ) : (
          <p className="text-muted-foreground">
            Ask Scout to group notes, add ideas, research the topic, or write up the board.
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {SUGGESTIONS.map((s) => (
          <button
            key={s.label}
            type="button"
            disabled={disabled}
            onClick={() => void ask(s.prompt)}
            className="rounded-full border border-border px-2.5 py-1 text-xs text-foreground hover:bg-accent disabled:opacity-50"
          >
            {s.label}
          </button>
        ))}
      </div>

      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          void ask(prompt)
        }}
      >
        <textarea
          data-testid="scout-input"
          value={prompt}
          rows={2}
          maxLength={600}
          disabled={disabled}
          placeholder="Brainstorm 8 ideas for…"
          className="flex-1 resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-ring disabled:opacity-60"
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void ask(prompt)
            }
          }}
        />
        <button
          type="submit"
          data-testid="scout-send"
          aria-label="Ask Scout"
          disabled={disabled || !prompt.trim()}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40"
        >
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
        </button>
      </form>

      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}

      <NoteTaker />
    </section>
  )
}
