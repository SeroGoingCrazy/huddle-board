/**
 * Action items as a checklist. It is a second view of the same `notes`
 * records the canvas shows (kind = 'action'), not a separate list, so
 * ticking an item here strikes it through on the board for everyone.
 */

import { useEffect, useState } from 'react'
import { useMutations, useQuery } from 'deepspace'
import { ListChecks } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Note } from '@/schemas/board-schema'

export function ActionsPanel({ boardId }: { boardId: string }) {
  const { records: notes } = useQuery<Note>('notes', { where: { boardId }, limit: 500 })
  const { put, ready } = useMutations<Note>('notes')
  const actions = notes
    .filter((note) => note.data.kind === 'action')
    .sort((a, b) => Number(!!a.data.done) - Number(!!b.data.done) || a.createdAt.localeCompare(b.createdAt))

  if (actions.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
        <ListChecks className="h-6 w-6 opacity-60" />
        <p className="font-medium text-foreground">No action items yet</p>
        <p>
          Say “Maya will send the draft by Friday” while the note-taker is listening, or set a note’s type to
          Action.
        </p>
      </div>
    )
  }

  return (
    <ul data-testid="action-list" className="min-h-0 flex-1 space-y-1 overflow-y-auto p-3">
      {actions.map((note) => (
        <li
          key={note.recordId}
          data-testid="action-item"
          className="flex items-start gap-2.5 rounded-lg px-2 py-2 hover:bg-accent"
        >
          <input
            type="checkbox"
            aria-label={`Mark "${note.data.text}" as done`}
            checked={!!note.data.done}
            disabled={!ready}
            onChange={(e) => void put(note.recordId, { done: e.target.checked ? 1 : 0 })}
            className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-primary)]"
          />
          <div className="min-w-0 flex-1">
            <p className={cn('text-sm text-foreground', note.data.done && 'text-muted-foreground line-through')}>
              {note.data.text || 'Untitled action'}
            </p>
            <OwnerField
              value={note.data.owner ?? ''}
              disabled={!ready}
              onCommit={(owner) => void put(note.recordId, { owner })}
            />
          </div>
        </li>
      ))}
    </ul>
  )
}

function OwnerField({
  value,
  disabled,
  onCommit,
}: {
  value: string
  disabled: boolean
  onCommit: (owner: string) => void
}) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])

  return (
    <input
      aria-label="Owner"
      value={draft}
      maxLength={40}
      disabled={disabled}
      placeholder="Unassigned — add an owner"
      className="mt-0.5 w-full rounded bg-transparent text-xs text-muted-foreground outline-none placeholder:text-muted-foreground/70 focus:bg-background focus:px-1 focus:text-foreground"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const next = draft.trim()
        if (next !== value) onCommit(next)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
      }}
    />
  )
}
