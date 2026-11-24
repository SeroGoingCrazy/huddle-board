# Huddle

A shared sticky-note board that takes the meeting notes for you.

People talk and brainstorm; the board listens and writes down ideas,
decisions, action items and open questions as sticky notes. **Scout**, an AI
teammate on the same board, groups the notes into themes, adds ideas, looks
things up on the web, and writes the summary. Everyone watches it work, live.

Built on [DeepSpace](https://docs.deep.space) (Cloudflare Workers + Durable
Objects).

## What it does

- **Boards** — create a board, share its URL, anyone signed in can join.
- **Sticky notes** — add, edit, drag, recolor, delete. Every change syncs to
  everyone on the board.
- **Live cursors** — see where each teammate is pointing.
- **Voice note-taker** — press "Take notes while I talk". What you say becomes
  notes, typed as *idea*, *decision*, *action* (with an owner) or *question*.
  Say "Scout, group these" and Scout does it.
- **Scout** — ask in plain language. Scout can:
  - read the board,
  - add notes (placed automatically in free space),
  - sort the whole board into labelled groups,
  - search the web and cite sources on the notes it adds,
  - write the board's summary.
- **Shared summary** — a text document next to the board that Scout drafts
  and people keep editing together.

## How it is built

| Need | DeepSpace primitive | Where |
| --- | --- | --- |
| Sign-in, roles | Auth + RBAC schemas | `src/schemas/board-schema.ts` |
| Notes, groups, Scout's state | RecordRoom collections | `src/schemas/board-schema.ts` |
| People's cursors | PresenceRoom | `src/pages/(app)/(protected)/b/[id].tsx` |
| Shared summary | Yjs text field | `src/components/board/SummaryPanel.tsx` |
| Scout's tool loop | `streamDeepSpaceAgent` | `src/ai/board-agent.ts` |
| Web research | `exa/search` integration | `src/ai/board-agent.ts` |
| Speech to text | `speech/speech-to-text` integration | `src/ai/note-taker.ts` |

### The main design decision

DeepSpace ships a `CanvasRoom` for whiteboards and a `PresenceRoom` for
cursors. Huddle uses the PresenceRoom for people, but **does not use the
CanvasRoom**, and Scout's cursor is not a presence peer.

The reason: both of those rooms can only be written by a browser socket. Scout
runs in the worker. The one realtime primitive the worker can write is a
record. So notes and group frames are records, and Scout's cursor is a row in
an `agents` collection that every browser renders as a cursor.

The cost of that choice: no built-in canvas undo, and note positions are
last-write-wins. The benefit: the agent and the humans edit exactly the same
data through exactly the same permission checks, with no second code path.

### The voice trade-off (measured, not guessed)

The first voice version used the SDK's `useVoiceAgent`, a realtime speech
model over WebRTC. It worked: silent, tool-calling, about one second from
speech to note. But the platform reserves credits for the whole session up
front: on the free tier a one-minute session reserved **$2.00**, and with
$4.24 of credit a three-minute session was refused outright. A 30-minute
meeting would need about $60 on hand before it could start.

Notes do not need one-second latency. The shipped version is a pipeline:

1. The browser captures raw microphone samples through an audio worklet.
2. `src/lib/utterances.ts` cuts them into utterances at pauses, and drops
   silence, using loudness alone.
3. Each utterance is uploaded as a small WAV to
   `POST /api/boards/:id/listen`.
4. The worker transcribes it, then a small model turns the transcript into
   typed notes through tool calls.

The same 25-second test clip costs a few cents through this pipeline
(transcription itself is under a tenth of a cent). Through the realtime
session it was charged the full $2.00 reservation — the test closed the page
before the SDK settled the session, so true usage may have been lower, but
the reservation is the binding limit either way. The price of the pipeline
is latency: a note appears a few seconds after you pause, not as you speak.

Each browser listens only to its own microphone. Huddle does not host the
call; people are already in a room or on a meeting app. That keeps "who said
it" trivial and avoids multi-party audio. The cost is that each person who
wants their words captured presses the button themselves.

### Other choices worth knowing

- **The model never picks coordinates.** Scout's tools take meaning ("these
  note ids belong in a group called X"). `src/lib/layout.ts` turns that into
  positions, deterministically, and is unit-tested for overlap. If the model
  forgets a note or invents an id, `normalizeGroups` repairs the grouping so
  no note is lost.
- **Scout runs as the person who asked.** Its record writes go through
  `createUserToolExecutor`, with RBAC on. It cannot do anything the caller
  could not do by hand.
- **Progress is data, not a private stream.** Scout's status line and closing
  message live in its `agents` record, so the whole room sees them, not only
  the person who asked.
- **One run per board at a time**, enforced by a soft lock on that record.

### Left out on purpose

- **Per-board permissions.** Every signed-in user can open every board. Good
  enough to demonstrate collaboration; a real product needs invitations.
- **Hosting the call (LiveKit rooms).** People already have a meeting app.
  Huddle listens; it does not replace the call.
- **Emailing minutes, calendar, payments.** Nice later; none of them makes
  the meeting itself better.
- **Computer use / browser automation.** The platform has no desktop or
  headless browser to drive, and an agent that edits shared state through
  tools is faster, more reliable, and visible to everyone.
- **Chat history with Scout.** Each request is independent. The board is the
  memory.

### Known limits

- Deleting a board leaves its notes and groups behind as orphan rows.
- Note text is last-write-wins: two people editing the same note at once will
  overwrite each other. (The summary uses Yjs and does not have this problem.)
- The per-board lock is read-then-write, not atomic. Two requests in the same
  few milliseconds could both start.
- Model and search costs are billed to the app owner, with no per-user quota.
  Sign-in is required, but a signed-in user could run Scout repeatedly.
- If the person who asked closes the tab mid-run, the run may be cut short.
  The lock then expires on its own after three minutes.
- The side panel (Scout, summary, note-taker) is hidden on narrow screens.
- The note-taker's speech detection uses a fixed loudness threshold. A noisy
  room may produce clips with no real speech (the transcript is then too
  short and is ignored), and a very quiet speaker may be missed.
- An action item's owner is set by voice or by Scout; there is no control to
  edit it by hand yet.
- Notes taken by voice are placed by the worker one request at a time. Two
  people speaking at the same instant can be given the same free spot.

## Run it

```sh
npx deepspace auth login
npx deepspace dev start        # http://localhost:5173
```

### Developing without spending DeepSpace credits

Model calls can run on your own Anthropic API key during development; the
deployed app always uses DeepSpace. `src/ai/model.ts` is the one switch.

```sh
node scripts/set-dev-key.mjs                         # hidden prompt; stores the key in the "dev" secrets config
npx deepspace dev start --secrets-config dev
npx deepspace test run all --secrets-config dev
```

The key lives only in the `dev` config, never in `prd` (what a deploy reads)
and never in the repo. Speech-to-text and web search still go through
DeepSpace; they cost fractions of a cent. The two model paths are not
identical, so run the tests once without `--secrets-config dev` before a
release.

## Test it

```sh
npm run test:unit              # layout, utterance cutting, WAV encoding
npx deepspace test run all     # smoke, API, two-user board and voice tests
```

The two-user tests need two test accounts
(`npx deepspace test accounts create …`). Tests tagged `@scout` and `@voice`
make real model, search and transcription calls billed to the app owner
(a few cents per run); run only the free one with
`npx deepspace test run e2e --grep "sync between"`.

The voice test replaces Chromium's microphone with a recorded clip,
`tests/fixtures/meeting.wav`, so it exercises the real capture path.

## Deploy

```sh
npx deepspace deploy
```
