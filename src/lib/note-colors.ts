import type { NoteColor } from './layout'

/** Sticky-note paint. Fixed (not themed): a yellow note is yellow everywhere. */
export const NOTE_PAINT: Record<NoteColor, { fill: string; edge: string; ink: string; frame: string }> = {
  yellow: { fill: '#fde68a', edge: '#eab308', ink: '#a16207', frame: 'rgba(234, 179, 8, 0.10)' },
  pink: { fill: '#fbcfe8', edge: '#ec4899', ink: '#be185d', frame: 'rgba(236, 72, 153, 0.08)' },
  blue: { fill: '#bfdbfe', edge: '#3b82f6', ink: '#1d4ed8', frame: 'rgba(59, 130, 246, 0.08)' },
  green: { fill: '#bbf7d0', edge: '#22c55e', ink: '#15803d', frame: 'rgba(34, 197, 94, 0.09)' },
  violet: { fill: '#ddd6fe', edge: '#8b5cf6', ink: '#6d28d9', frame: 'rgba(139, 92, 246, 0.09)' },
}

export function paintFor(color: string) {
  return NOTE_PAINT[color as NoteColor] ?? NOTE_PAINT.yellow
}

/** Scout's cursor and badge colour. */
export const SCOUT_COLOR = '#7c3aed'
