// Helpers for constructing drill-in URLs from inside a shared
// analysis view.
//
// Detail pages (/project, /trial, /patent, /publication, /researcher)
// live at global routes, not under /share/[token], so a click from a
// share view leaves the share URL prefix behind and lands the visitor
// on an anonymous marketing surface (via DetailLayout). We tag those
// links with ?from=share so DetailLayout can pick the "shared" copy
// variant on the SampleGateBanner instead of the "sample report"
// framing — the visitor came from a real bought analysis, not a
// demo.
//
// Server components in the report tree call this after
// getShareContextFromHeaders() to conditionally decorate outbound
// hrefs. When the caller isn't in share mode, we hand back the raw
// href untouched.

export function detailHref(baseHref: string, fromShare: boolean): string {
  if (!fromShare) return baseHref
  // Handle hrefs that already carry a query string, which none of
  // ours currently do but the helper should be safe if that changes.
  const sep = baseHref.includes('?') ? '&' : '?'
  return `${baseHref}${sep}from=share`
}
