/**
 * Board geometry — pure functions shared by the browser and the worker.
 *
 * The model decides *meaning* (which notes belong together, what a group is
 * called); this file decides *coordinates*. Language models are unreliable at
 * pixel arithmetic, so the agent's tools never accept x/y from the model.
 */

export const NOTE_W = 176
export const NOTE_H = 116
export const NOTE_GAP = 14
export const CLUSTER_PAD = 18
export const CLUSTER_HEADER = 40
export const CLUSTER_GAP = 44
/** Clusters wrap onto a new row once a row would exceed this width. */
export const ROW_MAX_WIDTH = 1500

export const NOTE_COLORS = ['yellow', 'pink', 'blue', 'green', 'violet'] as const
export type NoteColor = (typeof NOTE_COLORS)[number]

export interface Point {
  x: number
  y: number
}

export interface Rect extends Point {
  w: number
  h: number
}

export interface ClusterGroup {
  label: string
  noteIds: string[]
}

export interface ClusterLayout extends Rect {
  label: string
  color: NoteColor
  noteIds: string[]
}

export interface BoardLayout {
  clusters: ClusterLayout[]
  /** Target position per note id. */
  notes: Record<string, Point>
}

/** Notes per row inside a cluster: 2 for small groups, up to 4 for big ones. */
export function clusterColumns(noteCount: number): number {
  if (noteCount <= 4) return 2
  if (noteCount <= 9) return 3
  return 4
}

function clusterSize(noteCount: number): { w: number; h: number; cols: number } {
  const cols = clusterColumns(noteCount)
  const rows = Math.max(1, Math.ceil(noteCount / cols))
  return {
    cols,
    w: CLUSTER_PAD * 2 + cols * NOTE_W + (cols - 1) * NOTE_GAP,
    h: CLUSTER_HEADER + CLUSTER_PAD + rows * NOTE_H + (rows - 1) * NOTE_GAP,
  }
}

/**
 * Lay groups out left to right, wrapping rows, starting at `origin`.
 * Deterministic: the same groups always produce the same board.
 */
export function layoutClusters(groups: ClusterGroup[], origin: Point = { x: 0, y: 0 }): BoardLayout {
  const clusters: ClusterLayout[] = []
  const notes: Record<string, Point> = {}
  let cursorX = origin.x
  let cursorY = origin.y
  let rowHeight = 0

  groups.forEach((group, index) => {
    const { w, h, cols } = clusterSize(group.noteIds.length)
    if (cursorX > origin.x && cursorX + w - origin.x > ROW_MAX_WIDTH) {
      cursorX = origin.x
      cursorY += rowHeight + CLUSTER_GAP
      rowHeight = 0
    }
    clusters.push({
      label: group.label,
      color: NOTE_COLORS[index % NOTE_COLORS.length],
      noteIds: group.noteIds,
      x: cursorX,
      y: cursorY,
      w,
      h,
    })
    group.noteIds.forEach((id, i) => {
      notes[id] = {
        x: cursorX + CLUSTER_PAD + (i % cols) * (NOTE_W + NOTE_GAP),
        y: cursorY + CLUSTER_HEADER + Math.floor(i / cols) * (NOTE_H + NOTE_GAP),
      }
    })
    cursorX += w + CLUSTER_GAP
    rowHeight = Math.max(rowHeight, h)
  })

  return { clusters, notes }
}

/** Bounding box of everything on the board, or null when it is empty. */
export function boundsOf(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null
  const minX = Math.min(...rects.map((r) => r.x))
  const minY = Math.min(...rects.map((r) => r.y))
  const maxX = Math.max(...rects.map((r) => r.x + r.w))
  const maxY = Math.max(...rects.map((r) => r.y + r.h))
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

/**
 * Positions for `count` new loose notes: the first free cells of a grid
 * anchored at the board's top-left corner, `perRow` wide. Cells covered by an
 * existing note or group frame are skipped, so notes added one at a time (a
 * note-taker during a meeting) fill rows instead of stacking or drifting.
 */
export function freeSpots(existing: Rect[], count: number, perRow = 5): Point[] {
  const bounds = boundsOf(existing)
  const originX = bounds ? bounds.x : 0
  const originY = bounds ? bounds.y : 0
  const taken = [...existing]
  const spots: Point[] = []
  // Bounded scan: every cell in a row that starts below the board's bottom
  // edge is free, so enough such rows to hold `count` always suffices.
  const rowsInBounds = bounds ? Math.ceil(bounds.h / (NOTE_H + NOTE_GAP)) + 1 : 0
  const maxCells = (rowsInBounds + Math.ceil(count / perRow)) * perRow
  for (let cell = 0; cell < maxCells && spots.length < count; cell++) {
    const candidate: Rect = {
      x: originX + (cell % perRow) * (NOTE_W + NOTE_GAP),
      y: originY + Math.floor(cell / perRow) * (NOTE_H + NOTE_GAP),
      w: NOTE_W,
      h: NOTE_H,
    }
    if (taken.some((rect) => overlaps(rect, candidate))) continue
    taken.push(candidate)
    spots.push({ x: candidate.x, y: candidate.y })
  }
  return spots
}

/**
 * Turn the model's grouping into a complete partition of the board's notes:
 * unknown ids are dropped, a note claimed twice stays in its first group, and
 * notes the model forgot are collected into a trailing "Unsorted" group.
 */
export function normalizeGroups(groups: ClusterGroup[], allNoteIds: string[]): ClusterGroup[] {
  const known = new Set(allNoteIds)
  const seen = new Set<string>()
  const result: ClusterGroup[] = []
  for (const group of groups) {
    const label = group.label.trim().slice(0, 60)
    // A group with no usable label is discarded whole; its notes stay
    // unclaimed so they fall through to "Unsorted" instead of vanishing.
    if (!label) continue
    const noteIds = group.noteIds.filter((id) => known.has(id) && !seen.has(id))
    noteIds.forEach((id) => seen.add(id))
    if (noteIds.length > 0) result.push({ label, noteIds })
  }
  const leftover = allNoteIds.filter((id) => !seen.has(id))
  if (leftover.length > 0) result.push({ label: 'Unsorted', noteIds: leftover })
  return result
}
