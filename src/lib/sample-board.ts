/**
 * A ready-made board: what the note-taker leaves behind after a short
 * meeting. Lets a first-time visitor see every note kind, and try Scout on
 * real content, without a microphone or a model call.
 */

import { freeSpots, type NoteColor } from './layout'
import type { Note, NoteKind } from '../schemas/board-schema'

export const SAMPLE_BOARD_TITLE = 'Sample: onboarding redesign sync'

const KIND_COLOR: Record<NoteKind, NoteColor> = {
  idea: 'yellow',
  decision: 'green',
  action: 'blue',
  question: 'pink',
}

const SAMPLE: { text: string; kind: NoteKind; owner?: string }[] = [
  { kind: 'idea', text: 'Cut sign-up to email and password only' },
  { kind: 'idea', text: 'Show a sample project on first login' },
  { kind: 'idea', text: 'Add a progress checklist to the dashboard' },
  { kind: 'idea', text: 'Offer a two-minute video tour' },
  { kind: 'decision', text: 'Ship the new onboarding to 10% of users first' },
  { kind: 'decision', text: 'Drop the phone-number field' },
  { kind: 'action', text: 'Draft the checklist copy by Thursday', owner: 'Maya' },
  { kind: 'action', text: 'Set up the 10% rollout flag', owner: 'Leo' },
  { kind: 'question', text: 'Do we need legal sign-off to remove the phone number?' },
  { kind: 'question', text: 'Which metric defines an activated user?' },
]

export function sampleNotes(boardId: string): Note[] {
  const spots = freeSpots([], SAMPLE.length)
  return SAMPLE.map((note, i) => ({
    boardId,
    text: note.text,
    x: spots[i].x,
    y: spots[i].y,
    color: KIND_COLOR[note.kind],
    clusterId: '',
    author: 'voice',
    sourceUrl: '',
    kind: note.kind,
    owner: note.owner ?? '',
  }))
}
