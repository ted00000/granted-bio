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
import {
  fetchReportForGeneration,
  runTopicReportPhase1Projects,
  runTopicReportPhase2DataAgents,
  runTopicReportPhase3Aggregation,
  runTopicReportPhase4Synthesis,
  runTopicReportPhase5Save,
  markReportFailed,
  executePortfolioReportGeneration,
} from '@/lib/reports/generate'

/**
 * Report generation function. Uses Inngest steps to break synthesis
 * into phases, each of which runs in its own /api/inngest invocation
 * with a fresh maxDuration window. Prevents any single phase from
 * exceeding the Vercel function timeout.
 *
 * Steps:
 *   1. fetch-report - grab the DB row (fast)
 *   2. phase-1-projects - projects agent (~30-60s)
 *   3. phase-2-data-agents - trials/patents/pubs/market in parallel (~30-60s)
 *   4. phase-3-aggregation - deterministic aggregates (fast)
 *   5. phase-4-synthesis - all LLM synthesis + lint-retry (~240-300s)
 *   6. phase-5-save - single DB write
 *
 * Inngest checkpoints state between steps: each step's return value
 * is serialized and passed to the next as the input. State budget per
 * step return is a few MB - agent outputs typically fit.
 *
 * Concurrency limit: 5 (Inngest plan cap). Well within Anthropic
 * per-project rate limits for the ~10 LLM calls per synthesis.
 */
const generateReport = inngest.createFunction(
  {
    id: 'generate-report',
    name: 'Generate Report',
    retries: 2,
    concurrency: {
      limit: 5,
    },
    triggers: [{ event: 'report.generate.requested' }],
  },
  async ({ event, step }) => {
    const { reportId, userId, reportType, topic, dataLimited, persona, interpretation } = event.data

    try {
      if (reportType === 'topic') {
        if (!topic) throw new Error('topic is required for topic reports')

        // Step 1: fetch report record (for createdAt stamp on markdown)
        const report = await step.run('fetch-report', () => fetchReportForGeneration(reportId))

        // Step 2: projects agent
        const projectsOutput = await step.run('phase-1-projects', () =>
          runTopicReportPhase1Projects(reportId, topic, interpretation),
        )

        // Step 3: data agents in parallel
        const agentOutputs = await step.run('phase-2-data-agents', () =>
          runTopicReportPhase2DataAgents(reportId, topic, projectsOutput, interpretation),
        )

        // Step 4: aggregation
        const { fundingStats, topOrgs, topResearchers } = await step.run('phase-3-aggregation', () =>
          runTopicReportPhase3Aggregation(reportId, agentOutputs),
        )

        // Step 5: synthesis (LLM-heavy - the phase that most needed
        // its own budget window). Includes lint-retry. Returns both
        // reportData AND the mutated agentOutputs (relevance filter
        // runs inside synthesizeReport and mutates counts in place;
        // Inngest state serialization means we must return the
        // mutated version explicitly to propagate it to Phase 5).
        const { reportData, agentOutputs: filteredAgentOutputs } = await step.run('phase-4-synthesis', () =>
          runTopicReportPhase4Synthesis(
            reportId,
            userId,
            topic,
            agentOutputs,
            fundingStats,
            topOrgs,
            topResearchers,
            dataLimited ?? false,
            persona,
            interpretation,
            report.createdAt,
          ),
        )

        // Step 6: persist. Uses filteredAgentOutputs so the DB
        // agent_outputs.trials.byPhase matches the markdown table.
        await step.run('phase-5-save', () =>
          runTopicReportPhase5Save(reportId, persona, filteredAgentOutputs, reportData, fundingStats, topOrgs, topResearchers),
        )
      } else {
        // Portfolio flow: kept as a single step for now. Fewer LLM
        // calls than topic reports, less critical to split. If it
        // starts stalling we can apply the same phase-split pattern.
        await step.run('portfolio-generation', () =>
          executePortfolioReportGeneration(reportId, userId, dataLimited ?? false),
        )
      }
    } catch (error) {
      // Any step failure (including a retried-then-failed step) lands
      // here. Mark the report as failed + auto-grant retry credit so
      // the user has a recovery path.
      await markReportFailed(reportId, userId, error)
      throw error
    }

    return { reportId, ok: true }
  },
)

export const FUNCTIONS = [generateReport]
