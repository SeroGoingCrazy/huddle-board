/**
 * The shared board surface: pan/zoom, sticky notes, group frames, and two
 * kinds of cursor.
 *
 *  - People's cursors come from a PresenceRoom (ephemeral, never persisted).
 *  - Scout's cursor comes from its `agents` record, because the worker cannot
 *    join a PresenceRoom — it can only write records.
 *
 * Notes are positioned with a CSS transform that transitions, so a move made
 * by anyone else (a teammate or Scout) glides instead of teleporting. The
 * person dragging gets no transition and a local override, so their own drag
 * tracks the pointer exactly.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { getUserColor, useMutations, useQuery, useUsers } from 'deepspace'
import type { PresencePeerClient, RecordData } from 'deepspace'
import { ExternalLink, Maximize2, Mic, Minus, Plus, Sparkles, StickyNote, Trash2 } from 'lucide-react'
import { NOTE_COLORS, NOTE_H, NOTE_W, boundsOf, type Point } from '@/lib/layout'
import { SCOUT_COLOR, paintFor } from '@/lib/note-colors'
import { cn } from '@/lib/utils'
import { NOTE_KINDS, asNoteKind } from '@/schemas/board-schema'
import type { AgentState, Cluster, Note, NoteKind } from '@/schemas/board-schema'

interface View {
  x: number
  y: number
  zoom: number
}

const MIN_ZOOM = 0.3
const MAX_ZOOM = 2
/** Minimum gap between position writes while dragging. */
const DRAG_WRITE_MS = 70

const clampZoom = (zoom: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))

interface Props {
  boardId: string
  agent: RecordData<AgentState> | undefined
  peers: PresencePeerClient[]
  updatePresence: (state: Record<string, unknown>) => void
}

export function BoardCanvas({ boardId, agent, peers, updatePresence }: Props) {
  const { records: notes, status } = useQuery<Note>('notes', { where: { boardId }, limit: 500 })
  const { records: clusters } = useQuery<Cluster>('clusters', { where: { boardId }, limit: 50 })
  const noteWrites = useMutations<Note>('notes')

  const surfaceRef = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<View>({ x: 120, y: 90, zoom: 1 })
  const viewRef = useRef(view)
  viewRef.current = view

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  /** Positions this browser has set but the server has not echoed back yet. */
  const [overrides, setOverrides] = useState<Record<string, Point>>({})
  const [draggingId, setDraggingId] = useState<string | null>(null)

  const toWorld = useCallback((clientX: number, clientY: number): Point => {
    const rect = surfaceRef.current?.getBoundingClientRect()
    const v = viewRef.current
    return {
      x: (clientX - (rect?.left ?? 0) - v.x) / v.zoom,
      y: (clientY - (rect?.top ?? 0) - v.y) / v.zoom,
    }
  }, [])

  // Drop an override once the server's copy has caught up with it.
  useEffect(() => {
    setOverrides((current) => {
      let changed = false
      const next = { ...current }
      for (const note of notes) {
        const pending = current[note.recordId]
        if (!pending || note.recordId === draggingId) continue
        if (Math.abs(note.data.x - pending.x) < 1 && Math.abs(note.data.y - pending.y) < 1) {
          delete next[note.recordId]
          changed = true
        }
      }
      return changed ? next : current
    })
  }, [notes, draggingId])

  // ── Pan & zoom ─────────────────────────────────────────────────────────
  const zoomAt = useCallback((clientX: number, clientY: number, factor: number) => {
    const rect = surfaceRef.current?.getBoundingClientRect()
    const px = clientX - (rect?.left ?? 0)
    const py = clientY - (rect?.top ?? 0)
    setView((v) => {
      const zoom = clampZoom(v.zoom * factor)
      const scale = zoom / v.zoom
      return { zoom, x: px - (px - v.x) * scale, y: py - (py - v.y) * scale }
    })
  }, [])

  useEffect(() => {
    const el = surfaceRef.current
    if (!el) return
    // Native listener: React's onWheel is passive and cannot preventDefault.
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      if (e.ctrlKey || e.metaKey) {
        zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.01))
      } else {
        setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }))
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoomAt])

  const pan = useRef<{ startX: number; startY: number; viewX: number; viewY: number } | null>(null)

  const onSurfacePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    setSelectedId(null)
    setEditingId(null)
    pan.current = { startX: e.clientX, startY: e.clientY, viewX: view.x, viewY: view.y }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  // ── Presence: broadcast this pointer in board coordinates ──────────────
  const cursorFrame = useRef<number | null>(null)
  const latestCursor = useRef<Point | null>(null)
  const publishCursor = useCallback(
    (point: Point | null) => {
      latestCursor.current = point
      if (cursorFrame.current !== null) return
      cursorFrame.current = requestAnimationFrame(() => {
        cursorFrame.current = null
        updatePresence({ cursor: latestCursor.current })
      })
    },
    [updatePresence],
  )
  useEffect(
    () => () => {
      if (cursorFrame.current !== null) cancelAnimationFrame(cursorFrame.current)
    },
    [],
  )

  const onSurfacePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    publishCursor(toWorld(e.clientX, e.clientY))
    if (!pan.current) return
    const { startX, startY, viewX, viewY } = pan.current
    setView((v) => ({ ...v, x: viewX + e.clientX - startX, y: viewY + e.clientY - startY }))
  }

  const onSurfacePointerUp = () => {
    pan.current = null
  }

  // ── Notes ──────────────────────────────────────────────────────────────
  const addNoteAt = async (center: Point) => {
    const id = await noteWrites.create({
      boardId,
      text: '',
      x: Math.round(center.x - NOTE_W / 2),
      y: Math.round(center.y - NOTE_H / 2),
      color: 'yellow',
      clusterId: '',
      author: 'user',
      sourceUrl: '',
      kind: 'idea',
      owner: '',
    })
    setSelectedId(id)
    setEditingId(id)
  }

  const addNoteInView = () => {
    const rect = surfaceRef.current?.getBoundingClientRect()
    if (!rect) return
    // Nudge each new note so repeated clicks do not stack exactly.
    const jitter = (notes.length % 6) * 18
    void addNoteAt(toWorld(rect.left + rect.width / 2 + jitter, rect.top + rect.height / 2 + jitter))
  }

  const drag = useRef<{ id: string; dx: number; dy: number; lastWrite: number; moved: boolean } | null>(
    null,
  )

  const onNotePointerDown = (e: ReactPointerEvent<HTMLDivElement>, note: RecordData<Note>) => {
    if (e.button !== 0) return
    e.stopPropagation()
    setSelectedId(note.recordId)
    if (editingId === note.recordId) return
    setEditingId(null)
    const world = toWorld(e.clientX, e.clientY)
    const current = overrides[note.recordId] ?? note.data
    drag.current = {
      id: note.recordId,
      dx: world.x - current.x,
      dy: world.y - current.y,
      lastWrite: 0,
      moved: false,
    }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onNotePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const world = toWorld(e.clientX, e.clientY)
    publishCursor(world)
    const d = drag.current
    if (!d) return
    const next = { x: Math.round(world.x - d.dx), y: Math.round(world.y - d.dy) }
    if (!d.moved) {
      d.moved = true
      setDraggingId(d.id)
    }
    setOverrides((o) => ({ ...o, [d.id]: next }))
    const now = performance.now()
    if (now - d.lastWrite > DRAG_WRITE_MS) {
      d.lastWrite = now
      void noteWrites.put(d.id, next)
    }
  }

  const onNotePointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current
    drag.current = null
    setDraggingId(null)
    if (!d?.moved) return
    const world = toWorld(e.clientX, e.clientY)
    const final = { x: Math.round(world.x - d.dx), y: Math.round(world.y - d.dy) }
    setOverrides((o) => ({ ...o, [d.id]: final }))
    void noteWrites.put(d.id, final)
  }

  const removeNote = useCallback(
    (id: string) => {
      setSelectedId(null)
      setEditingId(null)
      void noteWrites.remove(id)
    },
    [noteWrites],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!selectedId || editingId) return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        removeNote(selectedId)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedId, editingId, removeNote])

  const fitToContent = useCallback(() => {
    const rect = surfaceRef.current?.getBoundingClientRect()
    const bounds = boundsOf([
      ...notes.map((n) => ({ x: n.data.x, y: n.data.y, w: NOTE_W, h: NOTE_H })),
      ...clusters.map((c) => ({ x: c.data.x, y: c.data.y, w: c.data.w, h: c.data.h })),
    ])
    if (!rect || !bounds) return setView({ x: 120, y: 90, zoom: 1 })
    const margin = 60
    const zoom = clampZoom(
      Math.min((rect.width - margin * 2) / bounds.w, (rect.height - margin * 2) / bounds.h, 1),
    )
    setView({
      zoom,
      x: (rect.width - bounds.w * zoom) / 2 - bounds.x * zoom,
      y: (rect.height - bounds.h * zoom) / 2 - bounds.y * zoom,
    })
  }, [notes, clusters])

  // A voice note is created by whoever spoke, so the roster names the speaker.
  const { users } = useUsers()
  const nameById = useMemo(() => new Map(users.map((user) => [user.id, user.name])), [users])

  const agentActive = !!agent?.data.busy
  const peerCursors = useMemo(
    () =>
      peers.flatMap((peer) => {
        const cursor = peer.state.cursor as Point | null | undefined
        return cursor && typeof cursor.x === 'number' && typeof cursor.y === 'number'
          ? [{ id: peer.userId, name: peer.userName || 'Guest', ...cursor }]
          : []
      }),
    [peers],
  )

  return (
    <div
      ref={surfaceRef}
      data-testid="board-surface"
      className="board-surface relative h-full w-full touch-none overflow-hidden select-none"
      style={{
        backgroundPosition: `${view.x}px ${view.y}px`,
        backgroundSize: `${24 * view.zoom}px ${24 * view.zoom}px`,
      }}
      onPointerDown={onSurfacePointerDown}
      onPointerMove={onSurfacePointerMove}
      onPointerUp={onSurfacePointerUp}
      onPointerLeave={() => publishCursor(null)}
      onDoubleClick={(e) => {
        if (e.target === e.currentTarget) void addNoteAt(toWorld(e.clientX, e.clientY))
      }}
    >
      <div
        className="pointer-events-none absolute left-0 top-0 origin-top-left"
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}
      >
        {clusters.map((cluster) => {
          const paint = paintFor(cluster.data.color)
          return (
            <div
              key={cluster.recordId}
              data-testid="cluster-frame"
              className="absolute left-0 top-0 rounded-2xl border-2 border-dashed transition-all duration-300"
              style={{
                transform: `translate(${cluster.data.x}px, ${cluster.data.y}px)`,
                width: cluster.data.w,
                height: cluster.data.h,
                borderColor: paint.edge,
                background: paint.frame,
              }}
            >
              <div
                className="px-4 pt-2.5 text-[13px] font-semibold tracking-wide uppercase"
                style={{ color: paint.ink }}
              >
                {cluster.data.label}
              </div>
            </div>
          )
        })}

        {notes.map((note) => {
          const position = overrides[note.recordId] ?? note.data
          return (
            <NoteCard
              key={note.recordId}
              note={note}
              position={position}
              dragging={draggingId === note.recordId}
              selected={selectedId === note.recordId}
              editing={editingId === note.recordId}
              onPointerDown={(e) => onNotePointerDown(e, note)}
              onPointerMove={onNotePointerMove}
              onPointerUp={onNotePointerUp}
              onStartEdit={() => setEditingId(note.recordId)}
              onCommit={(text) => {
                setEditingId(null)
                if (text !== note.data.text) void noteWrites.put(note.recordId, { text })
              }}
              onColor={(color) => void noteWrites.put(note.recordId, { color })}
              onKind={(kind) => void noteWrites.put(note.recordId, { kind })}
              speaker={nameById.get(note.createdBy) ?? ''}
              onRemove={() => removeNote(note.recordId)}
            />
          )
        })}

        {peerCursors.map((peer) => (
          <CursorMark
            key={peer.id}
            x={peer.x}
            y={peer.y}
            zoom={view.zoom}
            color={getUserColor(peer.id)}
            label={peer.name}
          />
        ))}

        {agentActive && agent && (
          <CursorMark
            x={agent.data.x}
            y={agent.data.y}
            zoom={view.zoom}
            color={SCOUT_COLOR}
            label="Scout"
            detail={agent.data.status}
            smooth
            testId="scout-cursor"
          />
        )}
      </div>

      {status === 'ready' && notes.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="max-w-xs text-center text-sm text-muted-foreground">
            <StickyNote className="mx-auto mb-3 h-7 w-7 opacity-60" />
            <p className="font-medium text-foreground">This board is empty</p>
            <p className="mt-1">
              Double-click anywhere to add a note, or ask Scout to brainstorm a first batch.
            </p>
          </div>
        </div>
      )}

      <div
        className="absolute bottom-4 left-4 flex items-center gap-1 rounded-xl border border-border bg-card p-1 shadow-sm"
        onPointerDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          data-testid="add-note"
          disabled={!noteWrites.ready}
          onClick={addNoteInView}
          className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          <Plus className="h-4 w-4" /> Note
        </button>
        <span className="mx-1 h-5 w-px bg-border" />
        <ToolButton label="Zoom out" onClick={() => zoomFromCenter(surfaceRef.current, zoomAt, 1 / 1.25)}>
          <Minus className="h-4 w-4" />
        </ToolButton>
        <span className="w-11 text-center text-xs tabular-nums text-muted-foreground">
          {Math.round(view.zoom * 100)}%
        </span>
        <ToolButton label="Zoom in" onClick={() => zoomFromCenter(surfaceRef.current, zoomAt, 1.25)}>
          <Plus className="h-4 w-4" />
        </ToolButton>
        <ToolButton label="Fit board to screen" onClick={fitToContent}>
          <Maximize2 className="h-4 w-4" />
        </ToolButton>
      </div>
    </div>
  )
}

function zoomFromCenter(
  el: HTMLDivElement | null,
  zoomAt: (x: number, y: number, factor: number) => void,
  factor: number,
) {
  const rect = el?.getBoundingClientRect()
  if (rect) zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor)
}

function ToolButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
    >
      {children}
    </button>
  )
}

const KIND_LABEL: Record<NoteKind, string> = {
  idea: 'Idea',
  decision: '✓ Decision',
  action: '→ Action',
  question: '? Question',
}

interface NoteCardProps {
  note: RecordData<Note>
  position: Point
  dragging: boolean
  selected: boolean
  editing: boolean
  onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void
  onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => void
  onPointerUp: (e: ReactPointerEvent<HTMLDivElement>) => void
  onStartEdit: () => void
  onCommit: (text: string) => void
  onColor: (color: string) => void
  onKind: (kind: NoteKind) => void
  onRemove: () => void
  /** For a note taken by voice: the name of the person who said it. */
  speaker: string
}

function NoteCard({
  note,
  position,
  dragging,
  selected,
  editing,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onStartEdit,
  onCommit,
  onColor,
  onKind,
  onRemove,
  speaker,
}: NoteCardProps) {
  const paint = paintFor(note.data.color)
  const kind = asNoteKind(note.data.kind)
  const [draft, setDraft] = useState(note.data.text)
  useEffect(() => {
    if (!editing) setDraft(note.data.text)
  }, [editing, note.data.text])

  return (
    <div
      data-testid="note"
      data-author={note.data.author}
      data-kind={kind}
      data-done={note.data.done ? 'true' : 'false'}
      className={cn(
        'pointer-events-auto absolute left-0 top-0 flex flex-col rounded-md p-3 text-[13px] leading-snug text-neutral-900',
        dragging
          ? 'z-20 cursor-grabbing shadow-xl'
          : 'cursor-grab shadow-md transition-transform duration-300 ease-out',
        selected && 'z-10 ring-2 ring-offset-1',
      )}
      style={
        {
          transform: `translate(${position.x}px, ${position.y}px)`,
          width: NOTE_W,
          minHeight: NOTE_H,
          background: paint.fill,
          '--tw-ring-color': paint.edge,
        } as React.CSSProperties
      }
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onDoubleClick={(e) => {
        e.stopPropagation()
        onStartEdit()
      }}
    >
      {kind !== 'idea' && (
        <div className="mb-1 flex items-center gap-1 text-[10px] font-bold tracking-wider text-neutral-700 uppercase">
          <span>{KIND_LABEL[kind]}</span>
          {kind === 'action' && note.data.owner && (
            <span className="truncate font-semibold tracking-normal normal-case">· {note.data.owner}</span>
          )}
        </div>
      )}
      {editing ? (
        <textarea
          autoFocus
          value={draft}
          maxLength={400}
          placeholder="Write an idea…"
          className="min-h-[84px] flex-1 cursor-text resize-none bg-transparent outline-none select-text placeholder:text-neutral-500"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => onCommit(draft.trim())}
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === 'Escape' || (e.key === 'Enter' && !e.shiftKey)) {
              e.preventDefault()
              e.currentTarget.blur()
            }
          }}
        />
      ) : (
        <p className={cn('flex-1 break-words whitespace-pre-wrap', note.data.done && 'line-through opacity-60')}>
          {note.data.text || <span className="text-neutral-500">Double-click to write…</span>}
        </p>
      )}

      {(note.data.author !== 'user' || note.data.sourceUrl) && (
        <div className="mt-2 flex items-center gap-2 text-[11px] font-medium text-neutral-600">
          {note.data.author === 'agent' && (
            <span className="flex items-center gap-1" style={{ color: SCOUT_COLOR }}>
              <Sparkles className="h-3 w-3" /> Scout
            </span>
          )}
          {note.data.author === 'voice' && (
            <span className="flex items-center gap-1">
              <Mic className="h-3 w-3" /> {speaker ? `${speaker} said` : 'heard'}
            </span>
          )}
          {note.data.sourceUrl && (
            <a
              href={note.data.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto flex items-center gap-1 underline-offset-2 hover:underline"
              onPointerDown={(e) => e.stopPropagation()}
            >
              source <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      )}

      {selected && !dragging && (
        <div
          className="absolute -top-10 left-0 flex items-center gap-1 rounded-lg border border-border bg-card px-1.5 py-1 shadow-sm"
          onPointerDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          {NOTE_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              aria-label={`Make note ${color}`}
              onClick={() => onColor(color)}
              className={cn(
                'h-5 w-5 rounded-full border border-black/10',
                note.data.color === color && 'ring-2 ring-foreground/60 ring-offset-1',
              )}
              style={{ background: paintFor(color).fill }}
            />
          ))}
          <span className="mx-0.5 h-4 w-px bg-border" />
          <select
            aria-label="Note type"
            value={kind}
            onChange={(e) => onKind(asNoteKind(e.target.value))}
            className="rounded border border-border bg-card px-1 py-0.5 text-xs text-foreground outline-none"
          >
            {NOTE_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
          <button
            type="button"
            aria-label="Delete note"
            onClick={onRemove}
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  )
}

/** A cursor pinned to board coordinates that stays the same size at any zoom. */
function CursorMark({
  x,
  y,
  zoom,
  color,
  label,
  detail,
  smooth,
  testId,
}: {
  x: number
  y: number
  zoom: number
  color: string
  label: string
  detail?: string
  smooth?: boolean
  testId?: string
}) {
  return (
    <div
      data-testid={testId ?? 'peer-cursor'}
      className={cn(
        'pointer-events-none absolute left-0 top-0 z-30 origin-top-left',
        smooth && 'transition-transform duration-200 ease-out',
      )}
      style={{ transform: `translate(${x}px, ${y}px) scale(${1 / zoom})` }}
    >
      <svg width="18" height="20" viewBox="0 0 18 20" className="drop-shadow-sm">
        <path d="M1 1l5.5 17 2.6-7.2L16.5 8z" fill={color} stroke="white" strokeWidth="1.5" />
      </svg>
      <div
        className="ml-4 -mt-1 max-w-[240px] rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap text-white shadow-sm"
        style={{ background: color }}
      >
        {label}
        {detail && <span className="ml-1.5 font-normal opacity-90">{detail}</span>}
      </div>
    </div>
  )
}
