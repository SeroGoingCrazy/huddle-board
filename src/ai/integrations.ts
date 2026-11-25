/**
 * Owner-billed calls to DeepSpace platform integrations from worker code.
 *
 * The browser-facing proxy (/api/integrations/*) bills per src/integrations.ts;
 * this helper is for server features that the app owner pays for on behalf of
 * signed-in members, so every caller must authorize the request first.
 */

import { apiWorkerFetch, splitIntegrationEndpoint } from 'deepspace/worker'
import type { Env } from '../../worker.js'

export async function callIntegration<T>(
  env: Env,
  endpoint: string,
  body: unknown,
  /** Act as this user instead of the owner (identity-bearing calls only). */
  asUserJwt?: string,
): Promise<T> {
  const target = splitIntegrationEndpoint(endpoint)
  if (!target) throw new Error(`${endpoint} is not a valid integration endpoint`)
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${asUserJwt || env.APP_OWNER_JWT}`,
  }
  // A call made as a user is otherwise scoped to that user alone (two people
  // asking for the same LiveKit room name would get two private rooms).
  // Identifying the app scopes it to the app, shared by its members. Absent
  // before the first deploy; the platform then fails closed.
  if (asUserJwt && env.APP_IDENTITY_TOKEN) {
    headers['x-app-identity-token'] = env.APP_IDENTITY_TOKEN
    headers['x-app-id'] = env.DEEPSPACE_APP_ID
  }
  const res = await apiWorkerFetch(env, target.path, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  const payload = (await res.json()) as { success?: boolean; error?: string; data?: unknown }
  if (!res.ok || payload.success === false) {
    throw new Error(payload.error ?? `${endpoint} failed (${res.status})`)
  }
  return (payload.data ?? payload) as T
}
