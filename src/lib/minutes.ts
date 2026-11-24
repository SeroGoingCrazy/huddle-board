/**
 * Meeting minutes as an email: pure text/HTML builders, shared by the worker
 * route and its unit tests.
 *
 * The prose summary is whatever is in the board's shared summary (written by
 * Scout, edited by people). The lists of decisions, actions and questions are
 * NOT taken from that prose: they are rebuilt from the notes themselves, so
 * the email cannot drift from, or invent beyond, what is on the board.
 */

export interface MinutesNote {
  text: string
  kind: string
  owner?: string
  done?: number
}

export interface MinutesInput {
  title: string
  summary: string
  notes: MinutesNote[]
  boardUrl: string
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function sections(notes: MinutesNote[]) {
  const of = (kind: string) => notes.filter((n) => n.kind === kind && n.text.trim())
  return [
    { heading: 'Decisions', lines: of('decision').map((n) => n.text.trim()) },
    {
      heading: 'Action items',
      lines: of('action').map(
        (n) => `${n.done ? '[done] ' : ''}${n.text.trim()}${n.owner ? ` — ${n.owner}` : ' — unassigned'}`,
      ),
    },
    { heading: 'Open questions', lines: of('question').map((n) => n.text.trim()) },
  ].filter((section) => section.lines.length > 0)
}

export function minutesSubject(title: string): string {
  return `Minutes: ${title.trim() || 'Untitled board'}`.slice(0, 150)
}

export function minutesText({ title, summary, notes, boardUrl }: MinutesInput): string {
  const parts = [title.trim() || 'Untitled board', '']
  if (summary.trim()) parts.push(summary.trim(), '')
  for (const section of sections(notes)) {
    parts.push(`${section.heading}:`, ...section.lines.map((line) => `- ${line}`), '')
  }
  parts.push(`Open the board: ${boardUrl}`)
  return parts.join('\n')
}

export function minutesHtml({ title, summary, notes, boardUrl }: MinutesInput): string {
  const blocks = [`<h2 style="margin:0 0 12px">${escapeHtml(title.trim() || 'Untitled board')}</h2>`]
  if (summary.trim()) {
    blocks.push(`<p style="white-space:pre-wrap;margin:0 0 16px">${escapeHtml(summary.trim())}</p>`)
  }
  for (const section of sections(notes)) {
    blocks.push(
      `<h3 style="margin:16px 0 6px;font-size:15px">${section.heading}</h3>`,
      `<ul style="margin:0;padding-left:20px">${section.lines.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>`,
    )
  }
  blocks.push(`<p style="margin:20px 0 0"><a href="${escapeHtml(boardUrl)}">Open the board in Huddle</a></p>`)
  return `<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.5;color:#1c1917">${blocks.join('')}</div>`
}
