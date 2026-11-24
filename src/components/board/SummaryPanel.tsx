/**
 * The board's shared summary: a Yjs text field on the board record. Scout
 * writes it from the worker (`yjs.setText`); people edit it here, live.
 */

import { useYjsText } from 'deepspace'
import { FileText } from 'lucide-react'

export function SummaryPanel({ boardId }: { boardId: string }) {
  const { text, setText, synced, canWrite } = useYjsText('boards', boardId, 'summary')

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-2 p-4">
      <header className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <FileText className="h-4 w-4 text-muted-foreground" />
        Summary
        <span className="ml-auto text-xs font-normal text-muted-foreground">
          {synced ? 'Shared, edits sync live' : 'Connecting…'}
        </span>
      </header>
      <textarea
        data-testid="summary"
        value={text}
        disabled={!synced || !canWrite}
        placeholder="Nothing here yet. Ask Scout to write the summary, or start typing."
        className="min-h-0 flex-1 resize-none rounded-lg border border-input bg-background p-3 text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground focus:border-ring disabled:opacity-60"
        onChange={(e) => setText(e.target.value)}
      />
    </section>
  )
}
