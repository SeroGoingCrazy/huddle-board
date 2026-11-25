/**
 * Board collections.
 *
 * Everything on a board is a record, not a CanvasRoom shape, on purpose: the
 * AI facilitator runs in the worker, and records are the realtime primitive
 * the worker can write to. A CanvasRoom shape (or a PresenceRoom cursor) can
 * only be written by a browser socket, so the agent could not touch it.
 *
 * Access model: one open workspace. Every signed-in user is a `member` and
 * can read and edit every board; signed-out visitors (`viewer`) see nothing.
 * Per-board sharing is deliberately out of scope.
 */

import type { CollectionSchema, RolePermissions } from 'deepspace/schema'

const NONE: RolePermissions = { read: false, create: false, update: false, delete: false }
const FULL: RolePermissions = { read: true, create: true, update: true, delete: true }

export const boardsSchema: CollectionSchema = {
  name: 'boards',
  columns: [
    { name: 'title', storage: 'text', interpretation: 'plain', required: true, maxLength: 80 },
  ],
  permissions: {
    viewer: NONE,
    // `update: true` also gates the board's collaborative summary: a Yjs
    // text field is writable by whoever may update its record.
    member: { read: true, create: true, update: true, delete: 'own' },
    admin: FULL,
  },
}

export const notesSchema: CollectionSchema = {
  name: 'notes',
  columns: [
    { name: 'boardId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'text', storage: 'text', interpretation: 'plain', maxLength: 400 },
    { name: 'x', storage: 'number', interpretation: 'number' },
    { name: 'y', storage: 'number', interpretation: 'number' },
    { name: 'color', storage: 'text', interpretation: 'plain', maxLength: 16 },
    { name: 'clusterId', storage: 'text', interpretation: 'plain' },
    // 'user' (typed), 'voice' (heard by the note-taker) or 'agent' (Scout).
    { name: 'author', storage: 'text', interpretation: 'plain', maxLength: 8 },
    // What the note records: see NOTE_KINDS. Empty means 'idea'.
    { name: 'kind', storage: 'text', interpretation: 'plain', maxLength: 12 },
    // Who an action item belongs to (free text, as spoken).
    { name: 'owner', storage: 'text', interpretation: 'plain', maxLength: 40 },
    // 1 once an action item is completed.
    { name: 'done', storage: 'number', interpretation: 'number' },
    { name: 'sourceUrl', storage: 'text', interpretation: 'plain', maxLength: 500 },
  ],
  permissions: { viewer: NONE, member: FULL, admin: FULL },
}

export const clustersSchema: CollectionSchema = {
  name: 'clusters',
  columns: [
    { name: 'boardId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'label', storage: 'text', interpretation: 'plain', maxLength: 60 },
    { name: 'x', storage: 'number', interpretation: 'number' },
    { name: 'y', storage: 'number', interpretation: 'number' },
    { name: 'w', storage: 'number', interpretation: 'number' },
    { name: 'h', storage: 'number', interpretation: 'number' },
    { name: 'color', storage: 'text', interpretation: 'plain', maxLength: 16 },
  ],
  permissions: { viewer: NONE, member: FULL, admin: FULL },
}

/**
 * One row per board (id `agent-<boardId>`): where the facilitator's cursor is,
 * what it is doing, and whether a run is in flight. Clients render it as a
 * cursor; the worker uses `busy` as a soft per-board lock.
 */
export const agentsSchema: CollectionSchema = {
  name: 'agents',
  columns: [
    { name: 'boardId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'x', storage: 'number', interpretation: 'number' },
    { name: 'y', storage: 'number', interpretation: 'number' },
    { name: 'status', storage: 'text', interpretation: 'plain', maxLength: 120 },
    { name: 'busy', storage: 'number', interpretation: 'number' },
    { name: 'startedAt', storage: 'number', interpretation: 'number' },
    { name: 'prompt', storage: 'text', interpretation: 'plain', maxLength: 600 },
    { name: 'lastMessage', storage: 'text', interpretation: 'plain', maxLength: 2000 },
  ],
  permissions: { viewer: NONE, member: FULL, admin: FULL },
}

/**
 * The running transcript: one row per utterance, written by the note-taker
 * route as the person who spoke (so `createdBy` is the speaker).
 */
export const transcriptsSchema: CollectionSchema = {
  name: 'transcripts',
  columns: [
    { name: 'boardId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'speaker', storage: 'text', interpretation: 'plain', maxLength: 40 },
    { name: 'text', storage: 'text', interpretation: 'plain', maxLength: 2000 },
  ],
  permissions: {
    viewer: NONE,
    member: { read: true, create: true, update: false, delete: 'own' },
    admin: FULL,
  },
}

export interface TranscriptLine {
  boardId: string
  speaker: string
  text: string
}

/**
 * Daily use of owner-billed features, one row per user per UTC day (id
 * `<userId>_<yyyy-mm-dd>`). Server-written only: see src/ai/quota.ts.
 */
export const usageSchema: CollectionSchema = {
  name: 'usage',
  columns: [
    { name: 'userId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'day', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'scout', storage: 'number', interpretation: 'number' },
    { name: 'listen', storage: 'number', interpretation: 'number' },
    { name: 'email', storage: 'number', interpretation: 'number' },
  ],
  permissions: {
    viewer: NONE,
    member: NONE,
    admin: { read: true, create: false, update: false, delete: true },
  },
}

/** What a note records. A meeting produces all four; a brainstorm mostly ideas. */
export const NOTE_KINDS = ['idea', 'decision', 'action', 'question'] as const
export type NoteKind = (typeof NOTE_KINDS)[number]

export const asNoteKind = (value: unknown): NoteKind =>
  NOTE_KINDS.includes(value as NoteKind) ? (value as NoteKind) : 'idea'

export interface Board {
  title: string
}

export interface Note {
  boardId: string
  text: string
  x: number
  y: number
  color: string
  clusterId: string
  author: 'user' | 'voice' | 'agent'
  sourceUrl: string
  kind: NoteKind
  owner: string
  /** 1 once an action item is completed; absent or 0 otherwise. */
  done?: number
}

export interface Cluster {
  boardId: string
  label: string
  x: number
  y: number
  w: number
  h: number
  color: string
}

export interface AgentState {
  boardId: string
  x: number
  y: number
  status: string
  busy: number
  startedAt: number
  prompt: string
  lastMessage: string
}

export const agentRecordId = (boardId: string) => `agent-${boardId}`
