// Validation for post-auth redirect targets.
//
// Both /api/auth/callback's `next` query param and the `redirect` param
// passed into AuthForm end up in something like `${origin}${next}`. If
// either is taken unvalidated from the URL, an attacker can craft a
// magic link / OAuth callback URL with `?next=https://evil.com` or
// `?next=//evil.com` (protocol-relative) and steer the post-auth
// browser to a controlled origin — a phishing vector that inherits
// the just-completed sign-in session's cookies.
//
// A safe path:
//   - is a non-empty string
//   - starts with a single `/`
//   - does NOT start with `//` (protocol-relative)
//   - does NOT start with `/\` (some routers interpret backslash as `/`)
//   - has no scheme prefix (http:, https:, javascript:, data:, etc.)
//
// Use cases:
//   - AuthForm reads the prop / search param, validates, encodes, and
//     hands the result to Supabase's redirectTo.
//   - /api/auth/callback receives the param back from Supabase, re-
//     validates, and falls back to a safe default if anything looks off.
//
// The default fallback is the caller's choice (commonly "/chat" today,
// likely "/reports" going forward); this helper just confirms a value
// is safe to use.

const SCHEME_PREFIX_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/

export function isSafeRedirectPath(value: unknown): value is string {
  if (typeof value !== 'string') return false
  if (value.length === 0) return false
  if (value[0] !== '/') return false
  if (value.startsWith('//')) return false
  if (value.startsWith('/\\')) return false
  if (SCHEME_PREFIX_RE.test(value)) return false
  return true
}

/**
 * Return the input if it's a safe same-origin path, otherwise the
 * supplied fallback (which must itself be safe — guarded with an
 * `isSafeRedirectPath` check at module/test boundaries).
 */
export function safeRedirectOr(
  value: unknown,
  fallback: string
): string {
  if (isSafeRedirectPath(value)) return value
  return fallback
}
