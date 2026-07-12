/**
 * Inngest functions — background handlers registered with the app-side
 * Inngest instance. The /api/inngest route imports this file and serves
 * every function via inngest.serve().
 *
 * Adding a new function: define it with `inngest.createFunction({...})`
 * and export from the FUNCTIONS array below. The webhook route picks
 * it up automatically.
 */

import { inngest } from './client'
import { executeTopicReportGeneration, executePortfolioReportGeneration } from '@/lib/reports/generate'

/**
 * Report generation function. Wraps the two executors so both topic
 * and portfolio reports run in the same Inngest queue. Retries on
 * transient failure (network glitch, LLM 5xx). Non-retryable failures
 * still mark the report as 'failed' via the executors' catch block.
 *
 * Concurrency limit: 10 simultaneous runs. Each generation calls the
 * Anthropic API 8-13 times + OpenAI embeddings; Anthropic's org rate
 * limit is 20k RPM (well over what 10 concurrent runs consume) but
 * bursty concurrent starts can trip per-project rate limits. Cap at 10
 * for safety.
 *
 * Timeout: no explicit timeout — Inngest lets background functions run
 * as long as needed. Executors log progress via updateProgressStage
 * so the client polling loop sees intermediate updates.
 */
const generateReport = inngest.createFunction(
  {
    id: 'generate-report',
    name: 'Generate Report',
    retries: 2,
    // Inngest plan caps function concurrency at 5. Well within Anthropic
    // per-project rate limits for the 8-13 calls per synthesis.
    concurrency: {
      limit: 5,
    },
    triggers: [{ event: 'report.generate.requested' }],
  },
  async ({ event, step }) => {
    const { reportId, userId, reportType, topic, dataLimited, persona, interpretation } = event.data

    // Wrap the executor in step.run() so Inngest can retry the whole
    // execution as a unit. Inngest's per-step retry semantics apply
    // here: on throw, the step is re-invoked from the top with the
    // same inputs. The executors are idempotent-ish (they mark the
    // row 'failed' on error) — re-running from a failed state will
    // re-attempt synthesis and either succeed or fail again.
    await step.run('execute-generation', async () => {
      if (reportType === 'topic') {
        if (!topic) throw new Error('topic is required for topic reports')
        await executeTopicReportGeneration(
          reportId,
          userId,
          topic,
          dataLimited ?? false,
          persona,
          interpretation,
        )
      } else {
        await executePortfolioReportGeneration(reportId, userId, dataLimited ?? false)
      }
    })

    return { reportId, ok: true }
  },
)

export const FUNCTIONS = [generateReport]
