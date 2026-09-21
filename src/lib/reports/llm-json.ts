/**
 * Structured-output helper for Anthropic Claude calls.
 *
 * Wraps `client.messages.create` with tool_use + tool_choice so the
 * model MUST emit a tool_use block matching the provided JSON schema.
 * The SDK validates the tool input at the API layer, so the returned
 * value is guaranteed to parse — no regex extraction, no code-fence
 * stripping, no JSON.parse-on-a-string.
 *
 * Why this exists: prior JSON callsites in the report pipeline
 * (relevance filter, curated publications, audit agent, white-space
 * narrate) generated malformed JSON often enough to be visible in
 * production logs. Each site had bespoke defensive parsing (strip
 * fences → regex extract → JSON.parse → fall back on failure), and
 * the fall-back paths silently degraded output. Tool use fixes the
 * class of problem at the source.
 *
 * The function never throws — network / timeout / abort errors are
 * caught and logged, returning null. Callers can treat null as
 * "fall back to the neutral default." That matches the historical
 * behavior of every callsite it replaces.
 */

import Anthropic from '@anthropic-ai/sdk'
import type { Tool } from '@anthropic-ai/sdk/resources/messages'

export interface UsageTracker {
  // Cumulative across all models. Retained for backward compat with
  // in-file `usageTracker.inputTokens += ...` incrementers that pre-
  // date the per-model breakdown.
  inputTokens: number
  outputTokens: number
  /**
   * Per-model breakdown (added 2026-09-21). Populated by
   * `recordModelUsage()` below. Callers that only ever fire against a
   * single model can rely on the cumulative fields above; report-time
   * synthesis fires Sonnet + Haiku + Opus and must use the per-model
   * split so `logApiUsage` can price each row correctly.
   */
  byModel?: Record<string, ModelTokenCount>
}

export interface ModelTokenCount {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

/**
 * Record a client.messages.create response's usage against a specific
 * model bucket. Updates both the legacy cumulative fields and the
 * per-model breakdown so existing consumers of tracker.inputTokens keep
 * working while new consumers can price accurately per-model.
 *
 * Every callsite that previously did:
 *   tracker.inputTokens  += response.usage.input_tokens
 *   tracker.outputTokens += response.usage.output_tokens
 * should migrate to:
 *   recordModelUsage(tracker, model, response.usage)
 *
 * Both paths still work today; the legacy pattern just assumes Sonnet
 * pricing at logApiUsage time.
 */
export function recordModelUsage(
  tracker: UsageTracker,
  model: string,
  usage: {
    input_tokens: number
    output_tokens: number
    cache_creation_input_tokens?: number | null
    cache_read_input_tokens?: number | null
  },
): void {
  const inputTokens = usage.input_tokens ?? 0
  const outputTokens = usage.output_tokens ?? 0
  const cacheWrite = usage.cache_creation_input_tokens ?? 0
  const cacheRead = usage.cache_read_input_tokens ?? 0

  tracker.inputTokens += inputTokens
  tracker.outputTokens += outputTokens

  if (!tracker.byModel) tracker.byModel = {}
  const bucket = tracker.byModel[model] ?? {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  }
  bucket.inputTokens += inputTokens
  bucket.outputTokens += outputTokens
  bucket.cacheReadTokens += cacheRead
  bucket.cacheWriteTokens += cacheWrite
  tracker.byModel[model] = bucket
}

export interface StructuredOutputOptions {
  client: Anthropic
  /** Anthropic model ID — e.g. 'claude-sonnet-4-6' or 'claude-opus-4-8'. */
  model: string
  /** The user-message content that describes what to produce. */
  prompt: string
  /** max_tokens for the response. Tool_use output counts against this. */
  maxTokens: number
  /** Name of the (single) tool the model must call. Used for logs. */
  toolName: string
  /** Human-readable description shown to the model as tool intent. */
  toolDescription: string
  /** JSON Schema for the tool's input. The SDK validates against this. */
  schema: Tool['input_schema']
  /** SDK-level per-request timeout. Defaults to 90s. */
  timeoutMs?: number
  /** Abort signal for external cancellation (e.g. wall-clock budget). */
  signal?: AbortSignal
  /** Optional usage accumulator — mutated in place with in/out tokens. */
  usageTracker?: UsageTracker
}

/**
 * Generate structured output. Returns the tool's `input` field as
 * plain JS (already validated against the schema by the SDK) or
 * null when the call couldn't complete.
 *
 * The caller narrows the return type via the generic parameter —
 * TypeScript can't infer it from a runtime schema, so pass the
 * expected type explicitly at the call site.
 */
export async function generateStructured<T>(
  opts: StructuredOutputOptions,
): Promise<T | null> {
  try {
    const response = await opts.client.messages.create(
      {
        model: opts.model,
        max_tokens: opts.maxTokens,
        messages: [{ role: 'user', content: opts.prompt }],
        tools: [
          {
            name: opts.toolName,
            description: opts.toolDescription,
            input_schema: opts.schema,
          },
        ],
        // tool_choice: { type: 'tool', name } forces the model to
        // emit exactly one tool_use block calling that tool. Without
        // this, the model could return a text-only response and we'd
        // be back to parsing prose.
        tool_choice: { type: 'tool', name: opts.toolName },
      },
      {
        timeout: opts.timeoutMs ?? 90_000,
        signal: opts.signal,
      },
    )

    if (opts.usageTracker) {
      // Track per-model so logApiUsage can price the row correctly.
      // Sonnet, Haiku, and Opus all differ; the prior cumulative-only
      // pattern always priced at Sonnet, undercounting Opus (audit
      // agent) and overcounting Haiku (classifiers).
      recordModelUsage(opts.usageTracker, opts.model, response.usage)
    }

    const toolUse = response.content.find((c) => c.type === 'tool_use')
    if (!toolUse || toolUse.type !== 'tool_use') {
      // Should be impossible given tool_choice forces tool use, but
      // handle it defensively — very old model versions or an
      // Anthropic-side bug could theoretically drop the block.
      console.warn(
        `[LLM JSON] Model returned no tool_use block for ${opts.toolName} — falling back.`,
      )
      return null
    }

    return toolUse.input as T
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`[LLM JSON] ${opts.toolName} call failed: ${msg}`)
    return null
  }
}
