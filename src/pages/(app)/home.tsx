/**
 * Boards list — the app's home. Dynamic but not gated, so a signed-out
 * visitor gets a sign-in prompt in the app's own chrome instead of a wall.
 */

import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AuthOverlay, getAuthToken, useAuth, useMutations, useQuery } from 'deepspace'
import { Plus, Sparkles, Trash2 } from 'lucide-react'
import { Button, useToast } from '@/components/ui'
import { SAMPLE_BOARD_TITLE, sampleNotes } from '@/lib/sample-board'
import type { Board, Note } from '@/schemas/board-schema'

export default function HomePage() {
  const { isSignedIn, userId } = useAuth()
  const [showAuth, setShowAuth] = useState(false)

  if (!isSignedIn) {
    return (
      <div className="flex min-h-full flex-col items-center justify-center gap-4 px-6 text-center">
        <h1 className="text-2xl font-semibold text-foreground">Sign in to open your boards</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          Boards are shared with everyone who signs in, and Scout works on them alongside you.
        </p>
        <Button data-testid="home-sign-in" onClick={() => setShowAuth(true)}>
          Sign in
        </Button>
        {showAuth && <AuthOverlay onClose={() => setShowAuth(false)} />}
      </div>
    )
  }
  return <BoardList userId={userId} />
}

function BoardList({ userId }: { userId: string | null }) {
  const navigate = useNavigate()
  const { error } = useToast()
  const { records: boards, status } = useQuery<Board>('boards', {
    orderBy: 'createdAt',
    orderDir: 'desc',
    limit: 200,
  })
  const { createConfirmed, ready } = useMutations<Board>('boards')
  const notes = useMutations<Note>('notes')
  const [creating, setCreating] = useState(false)

  const createBoard = async (sample: boolean) => {
    setCreating(true)
    try {
      // Confirmed: we navigate to the new board, so it must exist server-side.
      const id = await createConfirmed({ title: sample ? SAMPLE_BOARD_TITLE : 'Untitled board' })
      if (sample) await Promise.all(sampleNotes(id).map((note) => notes.createConfirmed(note)))
      navigate(`/b/${id}`)
    } catch {
      error('Could not create the board', 'Check your connection and try again.')
    } finally {
      setCreating(false)
    }
  }

  /** Boards are deleted server-side so their notes go with them. */
  const deleteBoard = async (boardId: string) => {
    try {
      const token = await getAuthToken()
      const res = await fetch('/api/actions/deleteBoard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token ?? ''}` },
        body: JSON.stringify({ boardId }),
      })
      const body = (await res.json().catch(() => null)) as { success?: boolean; error?: string } | null
      if (!res.ok || !body?.success) error('Could not delete the board', body?.error ?? 'Try again.')
    } catch {
      error('Could not delete the board', 'Check your connection and try again.')
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Boards</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Open a board, share its link, and think together.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            data-testid="sample-board"
            disabled={!ready || !notes.ready || creating}
            onClick={() => void createBoard(true)}
          >
            <Sparkles className="mr-1.5 h-4 w-4" /> Try a sample meeting
          </Button>
          <Button data-testid="new-board" disabled={!ready || creating} onClick={() => void createBoard(false)}>
            <Plus className="mr-1.5 h-4 w-4" /> New board
          </Button>
        </div>
      </div>

      {status === 'loading' ? (
        <p className="text-sm text-muted-foreground">Loading boards…</p>
      ) : boards.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border px-6 py-14 text-center">
          <p className="font-medium text-foreground">No boards yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Create the first one — then invite someone or ask Scout to get it started.
          </p>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {boards.map((board) => (
            <li
              key={board.recordId}
              className="group relative rounded-xl border border-border bg-card transition-shadow hover:shadow-md"
            >
              <Link to={`/b/${board.recordId}`} data-testid="board-link" className="block p-4">
                <p className="truncate font-medium text-foreground">{board.data.title}</p>
                <p className="mt-6 text-xs text-muted-foreground">
                  Created {new Date(board.createdAt).toLocaleDateString()}
                </p>
              </Link>
              {board.createdBy === userId && (
                <button
                  type="button"
                  aria-label={`Delete ${board.data.title}`}
                  onClick={() => {
                    if (window.confirm(`Delete "${board.data.title}"? This cannot be undone.`)) {
                      void deleteBoard(board.recordId)
                    }
                  }}
                  className="absolute right-2 top-2 rounded-md p-1.5 text-muted-foreground opacity-0 hover:bg-accent hover:text-destructive focus:opacity-100 group-hover:opacity-100"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
