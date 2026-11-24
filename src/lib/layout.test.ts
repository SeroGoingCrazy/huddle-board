import { describe, expect, it } from 'vitest'
import {
  NOTE_H,
  NOTE_W,
  ROW_MAX_WIDTH,
  layoutClusters,
  freeSpots,
  normalizeGroups,
  type Rect,
} from './layout'

const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

const ids = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i}`)

describe('normalizeGroups', () => {
  it('drops unknown ids and keeps a doubly-claimed note in its first group', () => {
    const result = normalizeGroups(
      [
        { label: 'A', noteIds: ['n1', 'ghost', 'n2'] },
        { label: 'B', noteIds: ['n2', 'n3'] },
      ],
      ['n1', 'n2', 'n3'],
    )
    expect(result).toEqual([
      { label: 'A', noteIds: ['n1', 'n2'] },
      { label: 'B', noteIds: ['n3'] },
    ])
  })

  it('collects notes the model forgot into an Unsorted group', () => {
    const result = normalizeGroups([{ label: 'A', noteIds: ['n1'] }], ['n1', 'n2', 'n3'])
    expect(result.at(-1)).toEqual({ label: 'Unsorted', noteIds: ['n2', 'n3'] })
  })

  it('drops groups left empty or unlabelled', () => {
    const result = normalizeGroups(
      [
        { label: 'Empty', noteIds: ['ghost'] },
        { label: '   ', noteIds: ['n1'] },
      ],
      ['n1'],
    )
    expect(result).toEqual([{ label: 'Unsorted', noteIds: ['n1'] }])
  })
})

describe('layoutClusters', () => {
  const groups = [
    { label: 'A', noteIds: ids('a', 3) },
    { label: 'B', noteIds: ids('b', 7) },
    { label: 'C', noteIds: ids('c', 12) },
    { label: 'D', noteIds: ids('d', 1) },
    { label: 'E', noteIds: ids('e', 5) },
  ]
  const layout = layoutClusters(groups, { x: 100, y: 50 })

  it('positions every note', () => {
    expect(Object.keys(layout.notes)).toHaveLength(28)
  })

  it('never overlaps two cluster frames', () => {
    for (const [i, a] of layout.clusters.entries()) {
      for (const b of layout.clusters.slice(i + 1)) expect(overlaps(a, b)).toBe(false)
    }
  })

  it('keeps each note inside its own cluster frame, and notes apart', () => {
    for (const cluster of layout.clusters) {
      const rects = cluster.noteIds.map((id) => ({ ...layout.notes[id], w: NOTE_W, h: NOTE_H }))
      for (const [i, r] of rects.entries()) {
        expect(r.x).toBeGreaterThanOrEqual(cluster.x)
        expect(r.y).toBeGreaterThanOrEqual(cluster.y)
        expect(r.x + r.w).toBeLessThanOrEqual(cluster.x + cluster.w)
        expect(r.y + r.h).toBeLessThanOrEqual(cluster.y + cluster.h)
        for (const other of rects.slice(i + 1)) expect(overlaps(r, other)).toBe(false)
      }
    }
  })

  it('wraps rows instead of growing past the row width', () => {
    const rows = new Set(layout.clusters.map((c) => c.y))
    expect(rows.size).toBeGreaterThan(1)
    for (const c of layout.clusters) expect(c.x + c.w - 100).toBeLessThanOrEqual(ROW_MAX_WIDTH)
  })

  it('is deterministic', () => {
    expect(layoutClusters(groups, { x: 100, y: 50 })).toEqual(layout)
  })
})

describe('freeSpots', () => {
  const asRects = (points: { x: number; y: number }[]) => points.map((p) => ({ ...p, w: NOTE_W, h: NOTE_H }))
  const noOverlap = (rects: Rect[]) => {
    for (const [i, a] of rects.entries()) {
      for (const b of rects.slice(i + 1)) expect(overlaps(a, b)).toBe(false)
    }
  }

  it('starts at the origin on an empty board', () => {
    expect(freeSpots([], 1)).toEqual([{ x: 0, y: 0 }])
  })

  it('fills a row before starting the next when notes arrive one at a time', () => {
    const board: Rect[] = []
    for (let i = 0; i < 7; i++) board.push(...asRects(freeSpots(board, 1)))
    noOverlap(board)
    expect(new Set(board.slice(0, 5).map((r) => r.y)).size).toBe(1)
    expect(board[5].y).toBeGreaterThan(board[0].y)
    expect(board[5].x).toBe(board[0].x)
  })

  it('reuses the gap left by a deleted note', () => {
    const board = asRects(freeSpots([], 4))
    const [removed] = board.splice(1, 1)
    expect(freeSpots(board, 1)).toEqual([{ x: removed.x, y: removed.y }])
  })

  it('never lands on an existing note or group frame, however large', () => {
    const existing: Rect[] = [
      { x: 40, y: 10, w: 1200, h: 900 },
      { x: 600, y: 950, w: NOTE_W, h: NOTE_H },
    ]
    const spots = asRects(freeSpots(existing, 9))
    expect(spots).toHaveLength(9)
    noOverlap([...existing, ...spots])
  })
})
