/**
 * Client-side POST helper with a single automatic retry on transient
 * failure modes that produce non-JSON responses.
 *
 * The failure this exists to absorb: Vercel serverless cold starts can
 * return truncated bodies or Vercel's own HTML error pages instead of
 * the API route's normal JSON. Calling `response.json()` on those
 * throws SyntaxError with the raw parser message ("Unexpected end of
 * JSON input" or similar), which surfaces to the user as "Failed to
 * parse JSON" — scary and misleading (implies their input was bad,
 * not that the server hiccuped). A single retry after a short delay
 * hits a warm function and almost always succeeds.
 *
 * Retry policy:
 *   - Retry once if body is not valid JSON (typical cold-start signature)
 *   - Retry once if status is 5xx (upstream / gateway error)
 *   - Do NOT retry on 4xx — those are legitimate client errors
 *     (auth, validation, payment required) that a retry can't fix
 *
 * Returns: { ok, status, data } — data is the parsed JSON on success.
 * Throws: friendly Error message on second-attempt failure.
 */
export async function postWithJsonRetry(
  url: string,
  init: RequestInit,
  retryDelayMs: number = 800
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const attempt = async (): Promise<{
    ok: boolean
    status: number
    data: unknown | null
  }> => {
    const res = await fetch(url, init)
    const body = await res.text()
    let data: unknown | null = null
    try {
      data = body ? JSON.parse(body) : null
    } catch {
      // Non-JSON body — leave data as null so caller retries.
    }
    return { ok: res.ok, status: res.status, data }
  }

  let result = await attempt()
  const shouldRetry =
    result.data === null || (result.status >= 500 && result.status < 600)

  if (shouldRetry) {
    console.warn(
      `[postWithJsonRetry] first attempt to ${url} failed ` +
        `(status=${result.status}, parseable=${result.data !== null}); ` +
        `retrying in ${retryDelayMs}ms`
    )
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs))
    result = await attempt()
  }

  if (result.data === null) {
    // Second attempt also produced a non-JSON body. Throw a
    // human-readable error so the UI can show something useful
    // instead of the raw parser message.
    throw new Error(
      result.status >= 500
        ? `The server had a temporary issue (${result.status}). Please try again in a moment.`
        : 'The server returned an unexpected response. Please try again in a moment.'
    )
  }

  return { ok: result.ok, status: result.status, data: result.data }
}
