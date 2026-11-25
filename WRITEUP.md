# Huddle — submission note

- **Live:** https://huddle-board.app.space
- **Repo:** https://github.com/SeroGoingCrazy/huddle-board

## What I built

A meeting room built around a shared sticky-note board. People join a voice
call on the board and talk. What they say shows up as a live transcript, and
the ideas, decisions, action items and open questions in it become typed
sticky notes on their own. Scout, an AI teammate on the same board, groups
the notes, adds ideas, researches the topic and writes the summary while
everyone watches its cursor. One click emails the minutes.

Fastest way to see it: sign in, click **Try a sample meeting**, then
**Group into themes**. For the call, open the board in two browsers and click
**Join meeting** in both.

## DeepSpace pieces used

- **Auth + RBAC**, **RecordRoom** (notes, groups, transcript, Scout's state,
  usage counters), **PresenceRoom** (people's cursors), **Yjs** (the shared
  summary), **server actions** (deleting a board with its contents).
- **Integrations:** Claude via `streamDeepSpaceAgent` (Scout and note
  extraction), `exa/search` (research), `speech/speech-to-text` (transcription),
  `livekit` (the call), `email/send` (minutes).

Left out because they would not make a meeting better: payments, calendar,
video, image generation.

## Main trade-offs

1. **Records instead of CanvasRoom.** CanvasRoom and PresenceRoom can only be
   written from a browser socket, and Scout runs in the worker. So notes are
   records and Scout's cursor is a record. Cost: no built-in undo, and note
   positions are last-write-wins. Benefit: the agent and the people edit the
   same data through the same permission checks.
2. **Chunked speech-to-text instead of realtime voice.** The first version
   used `useVoiceAgent`. It worked, but the platform reserves about $2 of
   credit per session-minute up front. I replaced it with: cut the microphone
   into utterances in the browser, transcribe each, extract notes with a
   small model. A few cents per meeting instead of dollars per minute; the
   price is a few seconds of delay.
3. **Each browser transcribes only its own microphone.** That gives exact
   "who said it" with no speaker-recognition model. Cost: someone not joined
   through Huddle is heard but not transcribed.

## What the agent did, and how I directed it

I used Claude Code for nearly all of the code. My part was direction and
judgment:

- Picked the idea from several options, and rejected "computer use" after the
  agent showed the platform has nothing for it to drive.
- Pushed the product from "whiteboard plus chat box" to a note-taker, then
  again to a real meeting with an in-board call. The agent had argued against
  the call on cost; I insisted, it checked the pricing, and it was wrong.
- Had it switch local development to my own Anthropic key so testing would
  not drain the demo's credits (`src/ai/model.ts`).
- Caught that red meant both "muted" and "recording" in the same screen.

Things the agent got wrong and fixed: it spent $2 of credit on an unpriced
realtime-voice experiment; its first call implementation put two people in
separate rooms; a unit test it wrote caught its own bug where grouping could
drop notes.

## What I verified myself

- Ran the app locally and went through a meeting: joined, spoke, and checked
  that notes and the transcript appeared.
- Two accounts in the call on the live site, hearing each other.
- Received the minutes email.
- Read the code paths I would be asked to explain: `src/ai/board-agent.ts`,
  `src/ai/note-taker.ts`, `src/components/board/MeetingProvider.tsx`,
  `src/lib/layout.ts`.

Automated: 33 unit tests and 17 end-to-end tests, including a two-browser
call where one side's microphone is a recorded clip.

## Unfinished, and what I would do next

- Every signed-in user can open every board; it needs per-board invitations.
- Speech detection uses a fixed loudness threshold, so noisy rooms and quiet
  speakers are handled poorly.
- Without headphones a microphone can pick up other people from the speakers.
- Next: Scout speaking up during the meeting (duplicates, contradictions,
  actions with no owner), and a morning reminder for open action items.
