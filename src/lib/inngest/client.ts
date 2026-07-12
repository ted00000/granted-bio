/**
 * Inngest client — the single source-of-truth for the app-side event bus.
 *
 * Why Inngest:
 * - Report synthesis takes 3-4 minutes wall-clock. Vercel serverless
 *   functions time out at 300s, and we blew past that ceiling three times
 *   trying to add a linter-retry pass. Inngest runs functions
 *   asynchronously with no per-run wall-clock limit, so the retry can
 *   safely run past what a request-response function can tolerate.
 * - Client polling is already in place: /reports/[id] polls every 5s
 *   while status='generating'. Inngest updates the DB row when synthesis
 *   completes; the poller catches it and re-renders.
 *
 * Local dev: run `npx inngest-cli@latest dev` alongside `npm run dev`.
 * The CLI listens on http://localhost:8288 and proxies events to
 * http://localhost:3000/api/inngest.
 *
 * Production: set INNGEST_EVENT_KEY and INNGEST_SIGNING_KEY on Vercel.
 * Inngest's cloud dispatcher POSTs events to /api/inngest, which the
 * `serve()` handler processes via the registered functions.
 */

import { Inngest } from 'inngest'

/**
 * Event schema. Each event type is a string ID + a data payload shape.
 * Adding a new event: declare it here so TypeScript enforces payload
 * shape at both send-site and function-handler-site.
 */
type EventPayloads = {
  'report.generate.requested': {
    data: {
      reportId: string
      userId: string
      reportType: 'topic' | 'portfolio'
      topic?: string
      dataLimited?: boolean
      persona: 'researcher' | 'investor'
      interpretation?: {
        semanticQuery: string
        keywordQuery: string
        label: string
      }
    }
  }
}

export const inngest = new Inngest({
  id: 'granted-bio',
  schemas: undefined as unknown as never, // type-only; runtime not needed
})

// Re-export the event payload type so send-sites and function
// definitions share the schema.
export type { EventPayloads }
