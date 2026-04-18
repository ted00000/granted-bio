/**
 * Retry utility for fetch operations
 * Implements exponential backoff with jitter for resilient API calls
 */

interface RetryOptions {
  maxRetries?: number
  initialDelayMs?: number
  maxDelayMs?: number
  backoffMultiplier?: number
  retryableStatusCodes?: number[]
  onRetry?: (attempt: number, error: Error | Response) => void
}

const DEFAULT_OPTIONS: Required<Omit<RetryOptions, 'onRetry'>> = {
  maxRetries: 3,
  initialDelayMs: 500,
  maxDelayMs: 10000,
  backoffMultiplier: 2,
  retryableStatusCodes: [408, 429, 500, 502, 503, 504],
}

/**
 * Calculate delay with exponential backoff and jitter
 */
function calculateDelay(
  attempt: number,
  initialDelay: number,
  maxDelay: number,
  multiplier: number
): number {
  const exponentialDelay = initialDelay * Math.pow(multiplier, attempt)
  const cappedDelay = Math.min(exponentialDelay, maxDelay)
  // Add jitter: random value between 0% and 25% of the delay
  const jitter = cappedDelay * Math.random() * 0.25
  return cappedDelay + jitter
}

/**
 * Check if an error is a network error that can be retried
 */
function isNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const message = error.message.toLowerCase()
  return (
    message.includes('network') ||
    message.includes('fetch') ||
    message.includes('failed to fetch') ||
    message.includes('connection') ||
    message.includes('timeout') ||
    error.name === 'TypeError' // Often indicates network issues
  )
}

/**
 * Execute a fetch with automatic retries for transient failures
 *
 * @param fetchFn - The fetch function to execute (should return Response)
 * @param options - Retry configuration options
 * @returns The successful Response
 * @throws The last error if all retries fail
 *
 * @example
 * const response = await fetchWithRetry(
 *   () => fetch('/api/data'),
 *   { maxRetries: 3, onRetry: (attempt) => console.log(`Retry ${attempt}`) }
 * )
 */
export async function fetchWithRetry(
  fetchFn: () => Promise<Response>,
  options: RetryOptions = {}
): Promise<Response> {
  const opts = { ...DEFAULT_OPTIONS, ...options }
  let lastError: Error | null = null

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      const response = await fetchFn()

      // Check if the response status code is retryable
      if (opts.retryableStatusCodes.includes(response.status) && attempt < opts.maxRetries) {
        opts.onRetry?.(attempt + 1, response)
        const delay = calculateDelay(
          attempt,
          opts.initialDelayMs,
          opts.maxDelayMs,
          opts.backoffMultiplier
        )
        await sleep(delay)
        continue
      }

      return response
    } catch (error) {
      // Only retry network errors, not abort errors or other exceptions
      if (error instanceof Error && error.name === 'AbortError') {
        throw error
      }

      if (isNetworkError(error) && attempt < opts.maxRetries) {
        lastError = error as Error
        opts.onRetry?.(attempt + 1, error as Error)
        const delay = calculateDelay(
          attempt,
          opts.initialDelayMs,
          opts.maxDelayMs,
          opts.backoffMultiplier
        )
        await sleep(delay)
        continue
      }

      throw error
    }
  }

  // If we get here, all retries failed
  throw lastError || new Error('All retry attempts failed')
}

/**
 * Sleep for a specified number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Check if a response indicates a rate limit that should be retried
 * Returns the delay to wait before retrying (in ms), or null if not rate limited
 */
export function getRateLimitDelay(response: Response): number | null {
  if (response.status !== 429) return null

  // Check for Retry-After header
  const retryAfter = response.headers.get('Retry-After')
  if (retryAfter) {
    const seconds = parseInt(retryAfter, 10)
    if (!isNaN(seconds)) {
      return seconds * 1000
    }
    // Could be an HTTP-date, but we'll use default backoff instead
  }

  // Default rate limit delay if no header
  return 5000
}
