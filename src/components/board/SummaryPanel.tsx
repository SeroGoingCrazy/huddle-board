/**
 * The board's shared summary: a Yjs text field on the board record. Scout
 * writes it from the worker (`yjs.setText`); people edit it here, live.
 * "Email minutes" sends it, with the board's decisions, action items and
 * open questions, to everyone who contributed notes (ai/minutes.ts).
 */

import { useState } from 'react'
import { getAuthToken, useYjsText } from 'deepspace'
import { Loader2, Mail } from 'lucide-react'
import { useToast } from '@/components/ui'

export function SummaryPanel({ boardId }: { boardId: string }) {
  const { text, setText, synced, canWrite } = useYjsText('boards', boardId, 'summary')
  const { success, error, warning } = useToast()
  const [sending, setSending] = useState(false)

  const emailMinutes = async () => {
    setSending(true)
    try {
      const token = await getAuthToken()
      const res = await fetch(`/api/boards/${encodeURIComponent(boardId)}/minutes/send`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token ?? ''}` },
      })
      const body = (await res.json().catch(() => null)) as { sent?: number; message?: string; error?: string } | null
      if (!res.ok) error('Minutes not sent', body?.error ?? 'Try again in a moment.')
      else if (!body?.sent) warning('Minutes not sent', body?.message ?? 'No one to send to.')
      else success('Minutes sent', body.message ?? '')
    } catch {
      error('Minutes not sent', 'Check your connection and try again.')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">
          {synced ? 'Shared — edits sync live' : 'Connecting…'}
        </span>
        <button
          type="button"
          data-testid="email-minutes"
          disabled={sending || !synced}
          onClick={() => void emailMinutes()}
          title="Email the summary, decisions, action items and open questions to everyone who added notes"
          className="ml-auto flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground hover:bg-accent disabled:opacity-50"
        >
          {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />}
          Email minutes
        </button>
      </div>
      <textarea
        data-testid="summary"
        value={text}
        disabled={!synced || !canWrite}
        placeholder="Nothing here yet. Ask Scout to write the summary, or start typing."
        className="min-h-0 flex-1 resize-none rounded-lg border border-input bg-background p-3 text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground focus:border-ring disabled:opacity-60"
        onChange={(e) => setText(e.target.value)}
      />
    </div>
  )
}
