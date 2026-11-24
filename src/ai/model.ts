/**
 * One place that decides who serves (and bills) the app's model calls.
 *
 *   production / demo  →  DeepSpace (`streamDeepSpaceAgent`), billed to the
 *                         app owner's DeepSpace credits. This is the path the
 *                         deployed app always takes.
 *   local development  →  if the secret DEV_ANTHROPIC_API_KEY is present, the
 *                         same request goes straight to the Anthropic API on
 *                         the developer's own key instead.
 *
 * Why the switch exists: DeepSpace reserves credits for the worst case before
 * each call, and a free-tier balance does not survive many test runs. Day to
 * day development should not eat the credits the demo needs.
 *
 * What it does NOT cover: speech-to-text and web search still go through
 * DeepSpace integrations (they cost fractions of a cent, and Claude does not
 * transcribe audio).
 *
 * Safety: the key lives only in a separate `dev` secrets config
 * (`deepspace secrets … -c dev`), never in the `prd` config a deploy reads,
 * never in the repo. With no key, this file is a plain pass-through.
 *
 * The two paths are not byte-identical (DeepSpace adds its own tool-result
 * capping and effort defaults), so anything shipped must be verified once on
 * the DeepSpace path — run the tests without the dev config before a release.
 */

import { createAnthropic } from '@ai-sdk/anthropic'
import { isStepCount, streamText } from 'ai'
import type { ModelMessage, ToolSet } from 'ai'
import { deepSpaceAgentErrorSummary, loggableError, streamDeepSpaceAgent } from 'deepspace/worker'
import type { Env } from '../../worker.js'

export interface AgentRun {
  /** Model id valid on both DeepSpace and the Anthropic API. */
  modelId: string
  instructions: string
  messages: ModelMessage[]
  tools: ToolSet
  /** Tool calls allowed before the model must answer. */
  maxToolCalls: number
  /**
   * Always set. DeepSpace sizes its credit reservation from this number, and
   * the SDK default (64k) is refused with 402 on a low balance.
   */
  maxOutputTokens: number
  /** DeepSpace path only; the direct path uses the provider default. */
  effort?: 'low' | 'medium' | 'high'
  abortSignal?: AbortSignal
  /** Called once per failure with a log-safe description. */
  onError: (summary: string) => void
}

let announced = false

/** Start one tool-using model turn. Consume `textStream` to drive it. */
export function streamAgent(
  env: Env,
  run: AgentRun,
): { textStream: AsyncIterable<string>; source: 'deepspace' | 'developer-key' } {
  const devKey = env.DEV_ANTHROPIC_API_KEY?.trim()

  if (devKey && !/^sk-ant-[!-~]+$/.test(devKey)) {
    // A mis-pasted secret (extra lines, quotes, the wrong clipboard) otherwise
    // surfaces as an opaque "Invalid header value" from fetch. Say what is
    // wrong, without echoing any of it, and fail the run rather than quietly
    // falling back to DeepSpace credits.
    const problem = `DEV_ANTHROPIC_API_KEY is malformed (${devKey.length} characters${/\s/.test(devKey) ? ', contains whitespace' : ''}); re-run scripts/set-dev-key.mjs`
    run.onError(problem)
    return {
      source: 'developer-key',
      textStream: (async function* (): AsyncGenerator<string> {
        throw new Error(problem)
      })(),
    }
  }

  if (devKey) {
    if (!announced) {
      announced = true
      console.info('[model] DEV_ANTHROPIC_API_KEY is set: model calls use the developer key, not DeepSpace credits')
    }
    const anthropic = createAnthropic({ apiKey: devKey })
    const result = streamText({
      model: anthropic(run.modelId),
      instructions: run.instructions,
      messages: run.messages,
      tools: run.tools,
      maxOutputTokens: run.maxOutputTokens,
      // One step per tool call, plus the closing reply.
      stopWhen: isStepCount(run.maxToolCalls + 1),
      abortSignal: run.abortSignal,
      onError: ({ error }) => run.onError(`developer-key model=${run.modelId} <- ${loggableError(error)}`),
    })
    return { textStream: result.textStream, source: 'developer-key' }
  }

  const { result } = streamDeepSpaceAgent(env, {
    profile: 'application',
    modelId: run.modelId,
    // No authToken: billed to the app owner.
    instructions: run.instructions,
    messages: run.messages,
    tools: run.tools,
    maxToolCalls: run.maxToolCalls,
    maxOutputTokens: run.maxOutputTokens,
    ...(run.effort ? { effort: run.effort } : {}),
    abortSignal: run.abortSignal,
    onError: ({ error }) =>
      run.onError(deepSpaceAgentErrorSummary(error, { profile: 'application', modelId: run.modelId })),
  })
  return { textStream: result.textStream, source: 'deepspace' }
}
