/**
 * Email the meeting minutes.
 *
 *   POST /api/boards/:boardId/minutes/send   →   { sent, message }
 *
 * Recipients are derived on the server, never taken from the request: the
 * person asking, plus everyone who has written a note on this board. A caller
 * therefore cannot use the app to email arbitrary people, and addresses never
 * reach the browser — other recipients are bcc'd.
 *
 * Content is the board's shared summary plus lists rebuilt from the notes
 * (see lib/minutes.ts). No model call is made here.
 */

import type { Hono } from 'hono'
import { createUserToolExecutor, isTestAccountEmail, loggableError } from 'deepspace/worker'
import { minutesHtml, minutesSubject, minutesText } from '../lib/minutes.js'
import { asNoteKind } from '../schemas/board-schema.js'
import { boardStore, requireMember, type ResolveAuth } from './board-agent.js'
import { callIntegration } from './integrations.js'
import { consumeQuota, systemTool } from './quota.js'
import type { AppContext, Env } from '../../worker.js'

const MAX_RECIPIENTS = 20

interface Envelope {
  success?: boolean
  data?: Record<string, unknown>
}

/** Look up a member's address. RBAC-off: members cannot read each other's rows. */
async function emailOf(env: Env, userId: string): Promise<string | null> {
  const found = await systemTool(env, userId, 'records.get', { collection: 'users', recordId: userId })
  const email = found.success ? found.data?.record?.data?.email : undefined
  // Test accounts use a reserved, undeliverable domain.
  return typeof email === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) && !isTestAccountEmail(email)
    ? email
    : null
}

export function registerMinutesRoutes(app: Hono<AppContext>, resolveAuth: ResolveAuth): void {
  app.post('/api/boards/:boardId/minutes/send', async (c) => {
    const auth = await requireMember(c.req.raw, c.env, resolveAuth)
    if (auth instanceof Response) return auth
    const boardId = c.req.param('boardId')

    // Read as the caller, RBAC on: they can only send what they can see.
    const executor = createUserToolExecutor(c.env, auth.userId, c.req.raw.signal)
    const board = (await executor('records.get', { collection: 'boards', recordId: boardId })) as Envelope
    const title = (board.data?.record as { data?: { title?: string } } | undefined)?.data?.title
    if (!board.success || title === undefined) return c.json({ error: 'Board not found' }, 404)

    const store = boardStore(executor, boardId)
    const [notes, summaryDoc] = await Promise.all([
      store.notes(),
      executor('yjs.getText', { collection: 'boards', recordId: boardId, fieldName: 'summary' }) as Promise<Envelope>,
    ])
    const summary = typeof summaryDoc.data?.text === 'string' ? summaryDoc.data.text : ''
    const hasOutcomes = notes.some((n) => asNoteKind(n.data.kind) !== 'idea')
    if (!summary.trim() && !hasOutcomes) {
      return c.json({ error: 'Nothing to send yet. Ask Scout to write the summary first.' }, 400)
    }

    const contributorIds = [...new Set(notes.map((n) => n.createdBy).filter((id): id is string => !!id))]
    const [mine, ...others] = await Promise.all(
      [auth.userId, ...contributorIds.filter((id) => id !== auth.userId)]
        .slice(0, MAX_RECIPIENTS)
        .map((id) => emailOf(c.env, id)),
    )
    const bcc = [...new Set(others.filter((email): email is string => !!email))]
    const to = mine ?? bcc.shift()
    if (!to) {
      return c.json({ sent: 0, message: 'No deliverable email address for you or the contributors.' })
    }

    const overLimit = await consumeQuota(c.env, auth.userId, 'email')
    if (overLimit) return c.json({ error: overLimit }, 429)

    const input = {
      title,
      summary,
      boardUrl: `${new URL(c.req.url).origin}/b/${encodeURIComponent(boardId)}`,
      notes: notes.map((n) => ({
        text: n.data.text,
        kind: asNoteKind(n.data.kind),
        owner: n.data.owner,
        done: n.data.done,
      })),
    }
    try {
      await callIntegration(c.env, 'email/send', {
        to,
        ...(bcc.length > 0 ? { bcc } : {}),
        subject: minutesSubject(title),
        text: minutesText(input),
        html: minutesHtml(input),
      })
    } catch (err) {
      console.error(`[minutes] send failed: ${loggableError(err)}`)
      return c.json({ error: 'The email could not be sent.' }, 502)
    }
    const sent = 1 + bcc.length
    return c.json({ sent, message: `Minutes sent to ${sent} ${sent === 1 ? 'person' : 'people'}.` })
  })
}
