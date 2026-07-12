/**
 * Inngest webhook endpoint. Inngest's cloud dispatcher POSTs events
 * to this URL; the `serve()` handler dispatches each event to the
 * matching function registered in src/lib/inngest/functions.ts.
 *
 * Local dev: run `npx inngest-cli@latest dev` alongside `npm run dev`.
 * The CLI listens on http://localhost:8288 and proxies events here.
 *
 * Production: Inngest's cloud dispatcher requires:
 *   - INNGEST_SIGNING_KEY (signs requests so we can verify)
 *   - INNGEST_EVENT_KEY (used by client.send() to authenticate)
 * Both set on Vercel as environment variables.
 *
 * maxDuration = 300 is preserved here because each Inngest step CAN
 * run up to 300s. But an Inngest function that exceeds one step's
 * budget can be broken into multiple step.run() calls — Inngest
 * checkpoints between steps, so the total run time is unbounded.
 * Report synthesis fits inside a single 300s step comfortably
 * (base gen ~180-240s, plus retry pass now within budget).
 */

import { serve } from 'inngest/next'
import { inngest } from '@/lib/inngest/client'
import { FUNCTIONS } from '@/lib/inngest/functions'

export const runtime = 'nodejs'
export const maxDuration = 300
export const dynamic = 'force-dynamic'

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: FUNCTIONS,
})
