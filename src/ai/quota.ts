/**
 * Per-user daily limits on the features the app owner pays for.
 *
 * Scout runs and voice clips are billed to the owner's DeepSpace credits, so
 * without a ceiling one signed-in user could spend the whole balance. Each
 * user gets a daily allowance; the counter is one `usage` row per user per
 * UTC day.
 *
 * The counter is written with RBAC OFF (the same internal path server actions
 * use): members must not be able to edit their own usage, so the `usage`
 * collection grants them nothing and only this module writes it. The user id
 * always comes from the verified JWT, never from request input.
 *
 * Read-then-write is not atomic. Two simultaneous requests can both pass at
 * the boundary, so a limit of N can be exceeded by one or two. That is fine
 * for a spending cap; it would not be fine for anything security-critical.
 */

import type { Env } from '../../worker.js'

export const DAILY_LIMITS = {
  /** Scout runs: about five cents each. */
  scout: 30,
  /** Voice clips: one per utterance, so roughly an hour of talking. */
  listen: 300,
  /** Minutes emails: about a cent each, and they reach other people. */
  email: 5,
} as const

export type QuotaKind = keyof typeof DAILY_LIMITS

const LABEL: Record<QuotaKind, string> = {
  scout: 'Scout requests',
  listen: 'voice notes',
  email: 'minutes emails',
}

interface ToolEnvelope {
  success?: boolean
  data?: { record?: { data?: Record<string, unknown> } }
  error?: string
}

/** Run a record tool with RBAC off. Callers must authorize first. */
export async function systemTool(env: Env, userId: string, tool: string, params: Record<string, unknown>) {
  const stub = env.RECORD_ROOMS.get(env.RECORD_ROOMS.idFromName(`app:${env.DEEPSPACE_APP_ID}`))
  const res = await stub.fetch(
    new Request('https://internal/api/tools/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-User-Id': userId, 'X-App-Action': 'true' },
      body: JSON.stringify({ tool, params }),
    }),
  )
  return (await res.json()) as ToolEnvelope
}

/**
 * Count one use against today's allowance. Returns null when allowed, or the
 * message to show the user when the allowance is spent.
 */
export async function consumeQuota(env: Env, userId: string, kind: QuotaKind): Promise<string | null> {
  const day = new Date().toISOString().slice(0, 10)
  const recordId = `${userId}_${day}`
  const existing = await systemTool(env, userId, 'records.get', { collection: 'usage', recordId })
  const row = existing.success ? existing.data?.record?.data : undefined
  const used = typeof row?.[kind] === 'number' ? (row[kind] as number) : 0

  if (used >= DAILY_LIMITS[kind]) {
    return `You have used today's ${DAILY_LIMITS[kind]} ${LABEL[kind]}. The allowance resets at midnight UTC.`
  }

  const write = row
    ? await systemTool(env, userId, 'records.update', {
        collection: 'usage',
        recordId,
        data: { [kind]: used + 1 },
      })
    : await systemTool(env, userId, 'records.create', {
        collection: 'usage',
        recordId,
        data: { userId, day, scout: 0, listen: 0, email: 0, [kind]: 1 },
      })
  // A failed counter write must not take the feature down with it.
  if (!write.success) console.error(`[quota] could not record ${kind} use: ${write.error ?? 'unknown error'}`)
  return null
}

/** A member's display name, for labelling what they said or did. */
export async function displayNameOf(env: Env, userId: string): Promise<string> {
  const found = await systemTool(env, userId, 'records.get', { collection: 'users', recordId: userId })
  const row = found.success ? found.data?.record?.data : undefined
  const name = typeof row?.name === 'string' ? row.name.trim() : ''
  if (name) return name.slice(0, 40)
  // Fall back to the part of the address before the @, never the address.
  const email = typeof row?.email === 'string' ? row.email : ''
  return email.split('@')[0]?.slice(0, 40) || 'Guest'
}
