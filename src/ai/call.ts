/**
 * In-board voice call (LiveKit).
 *
 *   POST /api/boards/:boardId/call/token   →   { token, url }
 *
 * The browser never chooses the room: the room name is derived here from the
 * app and board ids, after checking the caller is a member who can read that
 * board. A token therefore only ever opens the call of a board the caller
 * could already open.
 *
 * The token is minted with the CALLER's JWT, not the owner's: LiveKit takes
 * the participant identity from it, and two participants with one identity
 * would evict each other. Minting is free on the platform, so "who is billed"
 * does not change. The ad-hoc flow (no create-room) is used on purpose: it
 * needs no credit reservation; tokens expire on their own.
 */

import type { Hono } from 'hono'
import { createUserToolExecutor, loggableError } from 'deepspace/worker'
import { boardStore, requireMember, type ResolveAuth } from './board-agent.js'
import { callIntegration } from './integrations.js'
import { displayNameOf } from './quota.js'
import type { AppContext } from '../../worker.js'

/** Long enough for a meeting; short enough that a leaked token dies soon. */
const TOKEN_TTL_SECONDS = 2 * 60 * 60

export function registerCallRoutes(app: Hono<AppContext>, resolveAuth: ResolveAuth): void {
  app.post('/api/boards/:boardId/call/token', async (c) => {
    const auth = await requireMember(c.req.raw, c.env, resolveAuth)
    if (auth instanceof Response) return auth
    const callerJwt = (c.req.header('Authorization') ?? '').slice('Bearer '.length)

    const boardId = c.req.param('boardId')
    const executor = createUserToolExecutor(c.env, auth.userId, c.req.raw.signal)
    if (!(await boardStore(executor, boardId).boardExists())) return c.json({ error: 'Board not found' }, 404)

    try {
      const { token, url } = await callIntegration<{ token: string; url: string }>(
        c.env,
        'livekit/generate-token',
        {
          roomName: `huddle-${c.env.DEEPSPACE_APP_ID}-${boardId}`,
          displayName: await displayNameOf(c.env, auth.userId),
          ttlSeconds: TOKEN_TTL_SECONDS,
        },
        callerJwt,
      )
      return c.json({ token, url })
    } catch (err) {
      console.error(`[call] token failed: ${loggableError(err)}`)
      return c.json({ error: 'Could not start the call.' }, 502)
    }
  })
}
