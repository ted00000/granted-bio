# Inngest Setup

Report synthesis runs in the background via [Inngest](https://www.inngest.com) so it isn't bounded by Vercel's 300s serverless-function ceiling.

## Flow

1. Client `POST /api/reports` → server calls `generateTopicReport(...)` or `generatePortfolioReport(...)`
2. That function inserts a `user_reports` row with `status='generating'`, fires an `inngest.send({ name: 'report.generate.requested', ... })`, and returns the report ID immediately
3. Client is redirected to `/reports/[id]`, which polls every 5s while `status='generating'`
4. Inngest picks up the event and invokes the `generate-report` function (registered in `src/lib/inngest/functions.ts`), which runs the full synthesis pipeline
5. The pipeline updates the row to `status='complete'` when done (or `status='failed'` on error), and the client's next poll catches it

## Local dev

You need the Inngest CLI running alongside `npm run dev`:

```bash
# terminal 1: Next.js
npm run dev

# terminal 2: Inngest dev server
npx inngest-cli@latest dev
```

The CLI listens on `http://localhost:8288` and proxies events to `http://localhost:3000/api/inngest`. Open the dashboard at `http://localhost:8288` to inspect running/queued/failed functions.

Locally, `inngest.send()` requires no auth — the CLI accepts any event.

## Production env vars

Set these on Vercel (Production scope):

- `INNGEST_EVENT_KEY` — required by `inngest.send()` to authenticate publishes to the cloud dispatcher
- `INNGEST_SIGNING_KEY` — required by `serve()` at `/api/inngest` to verify incoming webhook requests

Get both from the Inngest dashboard (`https://app.inngest.com`) after registering the app.

## Adding a new function

1. Define it in `src/lib/inngest/functions.ts` using `inngest.createFunction(...)`
2. Add it to the `FUNCTIONS` array exported from that file
3. The `/api/inngest` route imports `FUNCTIONS` and serves them automatically — no route change needed

## Event schema

Event payloads are typed in `src/lib/inngest/client.ts` (`EventPayloads`). Adding a new event: extend that type; both `inngest.send()` and the corresponding function handler will get TypeScript enforcement.
