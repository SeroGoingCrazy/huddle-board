/**
 * Landing page — STATIC (top level of src/pages/): no providers, no auth
 * fetch, no WebSocket. Prerendered at build, so keep it renderable without a
 * browser. The live app starts at /home.
 */

import { Link } from 'react-router-dom'
import { Seo } from '../components/Seo'
import { APP_NAME } from '../constants'
import { seo } from '../seo'

const STEPS = [
  {
    title: 'Everyone throws ideas on the board',
    body: 'Sticky notes, live cursors, no turn-taking. Share the link and people are in.',
  },
  {
    title: 'Scout joins as a teammate',
    body: 'Ask it to group the notes, fill the gaps, or look things up. You watch its cursor do the work.',
  },
  {
    title: 'Leave with a write-up',
    body: 'Scout drafts the summary in a shared doc that anyone can keep editing.',
  },
]

const DEMO_NOTES = [
  { text: 'Onboarding takes 4 clicks too many', color: '#fde68a', rotate: '-3deg' },
  { text: 'Nobody finds the export button', color: '#bfdbfe', rotate: '2deg' },
  { text: 'Weekly digest email?', color: '#bbf7d0', rotate: '-1deg' },
  { text: 'Competitors ship templates', color: '#ddd6fe', rotate: '3deg', scout: true },
]

export default function Landing() {
  return (
    <>
      <Seo {...seo} path="/" />
      <div data-testid="static-landing" className="mx-auto flex min-h-screen max-w-5xl flex-col px-6">
        <header className="flex h-16 items-center justify-between">
          <span className="text-base font-semibold tracking-tight text-foreground">{APP_NAME}</span>
          <Link to="/home" className="text-sm font-medium text-foreground underline-offset-4 hover:underline">
            Open boards
          </Link>
        </header>

        <main className="grid flex-1 items-center gap-12 py-12 md:grid-cols-2">
          <div>
            <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
              A sticky-note board with a facilitator built in
            </h1>
            <p className="mt-5 max-w-md text-lg text-muted-foreground">
              Brainstorm together in real time. Then hand the messy board to Scout, an AI teammate that
              sorts it, researches it, and writes it up — on the board, where everyone can see.
            </p>
            <Link
              to="/home"
              className="mt-8 inline-flex items-center rounded-full bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              Start a board
            </Link>
          </div>

          <div aria-hidden="true" className="relative mx-auto grid w-full max-w-sm grid-cols-2 gap-4">
            {DEMO_NOTES.map((note) => (
              <div
                key={note.text}
                className="flex min-h-28 flex-col rounded-md p-3 text-sm leading-snug text-neutral-900 shadow-md"
                style={{ background: note.color, transform: `rotate(${note.rotate})` }}
              >
                <span className="flex-1">{note.text}</span>
                {note.scout && <span className="mt-2 text-[11px] font-semibold text-violet-700">✦ Scout</span>}
              </div>
            ))}
          </div>
        </main>

        <section className="grid gap-6 border-t border-border py-12 md:grid-cols-3">
          {STEPS.map((step, i) => (
            <div key={step.title}>
              <p className="text-sm font-semibold text-primary">{i + 1}</p>
              <h2 className="mt-1 font-semibold text-foreground">{step.title}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{step.body}</p>
            </div>
          ))}
        </section>
      </div>
    </>
  )
}
