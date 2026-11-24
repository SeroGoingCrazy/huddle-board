/**
 * Owner-billed calls to DeepSpace platform integrations from worker code.
 *
 * The browser-facing proxy (/api/integrations/*) bills per src/integrations.ts;
 * this helper is for server features that the app owner pays for on behalf of
 * signed-in members, so every caller must authorize the request first.
 */

import { apiWorkerFetch, splitIntegrationEndpoint } from 'deepspace/worker'
import type { Env } from '../../worker.js'

export async function callIntegration<T>(env: Env, endpoint: string, body: unknown): Promise<T> {
  const target = splitIntegrationEndpoint(endpoint)
  if (!target) throw new Error(`${endpoint} is not a valid integration endpoint`)
  const res = await apiWorkerFetch(env, target.path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.APP_OWNER_JWT}`,
    },
    body: JSON.stringify(body),
  })
  const payload = (await res.json()) as { success?: boolean; error?: string; data?: unknown }
  if (!res.ok || payload.success === false) {
    throw new Error(payload.error ?? `${endpoint} failed (${res.status})`)
  }
  return (payload.data ?? payload) as T
}
