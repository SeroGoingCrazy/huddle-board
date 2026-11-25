/**
 * The meeting's running transcript: who said what, as it is said. Lines are
 * records written by the note-taker route as the speaker, so this panel is
 * the same live query for everyone on the board.
 */

import { useEffect, useRef } from 'react'
import { getUserColor, useQuery } from 'deepspace'
import { MessagesSquare } from 'lucide-react'
import type { TranscriptLine } from '@/schemas/board-schema'

export function TranscriptPanel({ boardId }: { boardId: string }) {
  const { records: lines } = useQuery<TranscriptLine>('transcripts', {
    where: { boardId },
    orderBy: 'createdAt',
    orderDir: 'asc',
    limit: 400,
  })
  const end = useRef<HTMLDivElement>(null)
  // Keep the newest line in view as people talk. Braces matter: newer
  // browsers return a Promise from scrollIntoView, and an effect must not
  // return one (React would try to call it as a cleanup function).
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' })
  }, [lines.length])

  if (lines.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
        <MessagesSquare className="h-6 w-6 opacity-60" />
        <p className="font-medium text-foreground">Nothing said yet</p>
        <p>Join the meeting and talk. Everything said appears here, with who said it.</p>
      </div>
    )
  }

  return (
    <div data-testid="transcript" className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
      {lines.map((line) => (
        <div key={line.recordId} data-testid="transcript-line" className="text-sm">
          <div className="flex items-baseline gap-2">
            <span
              data-testid="transcript-speaker"
              className="font-semibold"
              style={{ color: getUserColor(line.createdBy) }}
            >
              {line.data.speaker || 'Guest'}
            </span>
            <time className="text-[11px] text-muted-foreground">
              {new Date(line.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </time>
          </div>
          <p className="text-foreground">{line.data.text}</p>
        </div>
      ))}
      <div ref={end} />
    </div>
  )
}
