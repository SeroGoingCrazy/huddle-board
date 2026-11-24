/**
 * A board: canvas on the left, Scout and the shared summary on the right.
 * Lives under (protected)/ — boards are members-only.
 */

import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getUserColor, useMutations, usePresenceRoom, useQuery } from 'deepspace'
import type { PresencePeerClient } from 'deepspace'
import { ArrowLeft } from 'lucide-react'
import { BoardCanvas } from '@/components/board/BoardCanvas'
import { ScoutPanel } from '@/components/board/ScoutPanel'
import { BoardTabs } from '@/components/board/BoardTabs'
import { agentRecordId, type AgentState, type Board } from '@/schemas/board-schema'

export default function BoardPage() {
  const { id = '' } = useParams()
  const { records: boards, status } = useQuery<Board>('boards', { limit: 200 })
  const { records: agents } = useQuery<AgentState>('agents', { where: { boardId: id }, limit: 1 })
  const board = boards.find((b) => b.recordId === id)
  const agent = agents.find((a) => a.recordId === agentRecordId(id))
  // One presence socket per board, shared by the header and the canvas.
  const { peers, updateState } = usePresenceRoom(`board:${id}`)

  if (status !== 'ready') {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading board…</div>
  }
  if (!board) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
        <p>This board does not exist, or it was deleted.</p>
        <Link to="/home" className="font-medium text-foreground underline underline-offset-4">
          Back to boards
        </Link>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <title>{`${board.data.title} · Huddle`}</title>
      <BoardHeader boardId={id} title={board.data.title} peers={peers} />
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">
          <BoardCanvas boardId={id} agent={agent} peers={peers} updatePresence={updateState} />
        </div>
        <aside className="flex w-[340px] shrink-0 flex-col border-l border-border bg-card max-md:hidden">
          <ScoutPanel boardId={id} agent={agent} />
          <BoardTabs boardId={id} />
        </aside>
      </div>
    </div>
  )
}

function BoardHeader({
  boardId,
  title,
  peers,
}: {
  boardId: string
  title: string
  peers: PresencePeerClient[]
}) {
  const { put, ready } = useMutations<Board>('boards')
  const [draft, setDraft] = useState(title)
  useEffect(() => setDraft(title), [title])

  const commit = () => {
    const next = draft.trim()
    if (!next) return setDraft(title)
    if (next !== title) void put(boardId, { title: next })
  }

  return (
    <div className="flex h-11 shrink-0 items-center gap-3 border-b border-border bg-card px-3">
      <Link
        to="/home"
        aria-label="Back to boards"
        className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
      </Link>
      <input
        aria-label="Board title"
        value={draft}
        maxLength={80}
        disabled={!ready}
        className="min-w-0 flex-1 rounded-md bg-transparent px-2 py-1 text-sm font-semibold text-foreground outline-none hover:bg-accent focus:bg-accent"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
        }}
      />
      <div className="flex items-center" data-testid="peer-list">
        {peers.slice(0, 5).map((peer) => (
          <span
            key={peer.userId}
            title={peer.userName || 'Guest'}
            className="-ml-1.5 flex h-7 w-7 items-center justify-center rounded-full border-2 border-card text-[11px] font-semibold text-white first:ml-0"
            style={{ background: getUserColor(peer.userId) }}
          >
            {(peer.userName || 'G').slice(0, 1).toUpperCase()}
          </span>
        ))}
        <span className="ml-2 text-xs text-muted-foreground">
          {peers.length === 0 ? 'Only you here' : `${peers.length + 1} here`}
        </span>
      </div>
    </div>
  )
}
