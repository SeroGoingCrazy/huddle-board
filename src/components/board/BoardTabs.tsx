/** Lower half of the board sidebar: transcript, shared summary, action list. */

import { useState } from 'react'
import { useQuery } from 'deepspace'
import { cn } from '@/lib/utils'
import type { Note } from '@/schemas/board-schema'
import { ActionsPanel } from './ActionsPanel'
import { SummaryPanel } from './SummaryPanel'
import { TranscriptPanel } from './TranscriptPanel'

type Tab = 'summary' | 'transcript' | 'actions'

export function BoardTabs({ boardId }: { boardId: string }) {
  const [tab, setTab] = useState<Tab>('summary')
  const { records: notes } = useQuery<Note>('notes', { where: { boardId }, limit: 500 })
  const open = notes.filter((note) => note.data.kind === 'action' && !note.data.done).length

  const tabButton = (id: Tab, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === id}
      data-testid={`tab-${id}`}
      onClick={() => setTab(id)}
      className={cn(
        '-mb-px border-b-2 px-3 py-2 text-sm font-medium',
        tab === id
          ? 'border-primary text-foreground'
          : 'border-transparent text-muted-foreground hover:text-foreground',
      )}
    >
      {label}
    </button>
  )

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div role="tablist" className="flex border-b border-border px-2">
        {tabButton('summary', 'Summary')}
        {tabButton('transcript', 'Transcript')}
        {tabButton('actions', open > 0 ? `Actions (${open})` : 'Actions')}
      </div>
      {/* Both stay mounted so the summary keeps its live document connection. */}
      <div className={cn('min-h-0 flex-1 flex-col', tab === 'summary' ? 'flex' : 'hidden')}>
        <SummaryPanel boardId={boardId} />
      </div>
      {tab === 'transcript' && <TranscriptPanel boardId={boardId} />}
      <div className={cn('min-h-0 flex-1 flex-col', tab === 'actions' ? 'flex' : 'hidden')}>
        <ActionsPanel boardId={boardId} />
      </div>
    </section>
  )
}
