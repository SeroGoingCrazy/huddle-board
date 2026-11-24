import { describe, expect, it } from 'vitest'
import { minutesHtml, minutesSubject, minutesText } from './minutes'

const input = {
  title: 'Onboarding sync',
  summary: 'Ship the new flow to 10% first.',
  boardUrl: 'https://example.test/b/1',
  notes: [
    { kind: 'idea', text: 'Video tour' },
    { kind: 'decision', text: 'Drop the phone field' },
    { kind: 'action', text: 'Draft copy', owner: 'Maya', done: 1 },
    { kind: 'action', text: 'Rollout flag' },
    { kind: 'question', text: 'Legal sign-off?' },
    { kind: 'question', text: '   ' },
  ],
}

describe('minutes email', () => {
  const text = minutesText(input)

  it('lists decisions, actions and questions from the notes, not ideas', () => {
    expect(text).toContain('Decisions:\n- Drop the phone field')
    expect(text).toContain('Open questions:\n- Legal sign-off?')
    expect(text).not.toContain('Video tour')
  })

  it('shows owner, missing owner and completion on action items', () => {
    expect(text).toContain('- [done] Draft copy — Maya')
    expect(text).toContain('- Rollout flag — unassigned')
  })

  it('skips blank notes and empty sections', () => {
    expect(text.match(/^- /gm)).toHaveLength(4)
    expect(minutesText({ ...input, notes: [] })).not.toContain('Decisions')
  })

  it('includes the summary and a link back to the board', () => {
    expect(text).toContain('Ship the new flow to 10% first.')
    expect(text.trimEnd().endsWith('https://example.test/b/1')).toBe(true)
  })

  it('escapes board content in the HTML version', () => {
    const html = minutesHtml({
      ...input,
      title: '<script>alert(1)</script>',
      notes: [{ kind: 'decision', text: 'Use <b>bold</b> & "quotes"' }],
    })
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('Use &lt;b&gt;bold&lt;/b&gt; &amp; &quot;quotes&quot;')
  })

  it('builds a bounded subject and survives an empty title', () => {
    expect(minutesSubject('  ')).toBe('Minutes: Untitled board')
    expect(minutesSubject('x'.repeat(400)).length).toBeLessThanOrEqual(150)
  })
})
