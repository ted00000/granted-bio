# Maintenance Mode

A site-wide "System Undergoing Improvement Updates" page you can flip on/off
via a Vercel env var without deploying. Added 2026-08-12 while iterating on
the report portal redesign.

## Activating

In Vercel dashboard → project → Settings → Environment Variables:

1. Add `MAINTENANCE_MODE=true` (Production scope, or all scopes for
   full pause including Preview and Development).
2. Redeploy is NOT required — env-var changes take effect on the next
   incoming request per Vercel's edge behavior. May take up to a minute
   to fully propagate across regions.
3. Verify by visiting `https://www.granted.bio/` in an incognito window;
   you should be redirected to `/maintenance`.

## Deactivating

Remove the `MAINTENANCE_MODE` env var (or set it to any value other than
`true` — case-sensitive). Next request serves the normal site.

## Bypass (preview during maintenance)

While `MAINTENANCE_MODE=true`, add a second env var:

- `MAINTENANCE_BYPASS_TOKEN=<some-random-string>` — a shared secret.
  Keep it long and unguessable (e.g., 32 random alphanumerics).

Anyone with the token can visit:

    https://www.granted.bio/api/maintenance/bypass?token=<the-token>

Once. That sets a 30-day cookie on their browser, and the middleware lets
them through on all subsequent requests.

To clear your own bypass cookie (to test the maintenance experience
yourself):

    https://www.granted.bio/api/maintenance/bypass?token=clear

## Behavior details

- API routes (`/api/*`) are NEVER redirected — Inngest webhooks, Stripe
  webhooks, Supabase auth callbacks, and the bypass endpoint itself all
  keep working.
- Static assets (`/_next/*`) are excluded via the middleware matcher.
- Every user-facing page (`/`, `/reports/*`, `/sample/*`, `/samples`,
  `/pricing`, `/chat`, `/account`, `/projects`, `/people`, `/trials`,
  `/admin`, etc.) redirects to `/maintenance` unless the bypass cookie
  is set.
- The `/maintenance` page itself renders normally regardless of mode so
  the redirect target exists in both states.

## Files

- `src/middleware.ts` — `shouldServeMaintenance()` + redirect
- `src/app/maintenance/page.tsx` — the page
- `src/app/api/maintenance/bypass/route.ts` — cookie-setting endpoint
