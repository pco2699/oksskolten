export const CONCURRENCY = Number(process.env.FETCH_CONCURRENCY) || 5
export const RETRY_MAX_ATTEMPTS = Number(process.env.RETRY_MAX_ATTEMPTS) || 5
export const RETRY_BATCH_LIMIT = Number(process.env.RETRY_BATCH_LIMIT) || 3

/**
 * Hard ceilings on the feed sweep. Every outbound request already carries its
 * own timeout, but that only bounds the awaits we know about: on 2026-10-01 a
 * sweep awaited something that never settled — no socket open, no CPU in use —
 * and because `noOverlap` skips a firing while the previous one is still
 * running, no article was ingested for 8.5 hours. These bound the work as a
 * whole, so a hang anywhere underneath costs one feed or one article, not all
 * of them.
 *
 * Worst legitimate cases they must clear: a feed is a 15s fetch plus a 65s
 * FlareSolverr fallback (and, for CSS bridges, more FlareSolverr calls); an
 * article is fetch + FlareSolverr + worker parse, then a FlareSolverr retry
 * and a second parse — about 4 minutes end to end.
 */
export const FEED_TIMEOUT_MS = Number(process.env.FEED_TIMEOUT_MS) || 3 * 60_000
export const ARTICLE_TIMEOUT_MS = Number(process.env.ARTICLE_TIMEOUT_MS) || 5 * 60_000
export const SWEEP_TIMEOUT_MS = Number(process.env.SWEEP_TIMEOUT_MS) || 30 * 60_000

export class TimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} timed out after ${Math.round(ms / 1000)}s`)
    this.name = 'TimeoutError'
  }
}

/**
 * Reject with `TimeoutError` if `promise` has not settled within `ms`.
 *
 * This stops *waiting*; it does not cancel the underlying work, which keeps
 * running (or stays hung) in the background. That is the point — the caller
 * gets its slot back — but a timed-out task should be treated as abandoned.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

export class Semaphore {
  private queue: (() => void)[] = []
  private active = 0
  constructor(private max: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) {
      await new Promise<void>(resolve => this.queue.push(resolve))
    }
    this.active++
    try {
      return await fn()
    } finally {
      this.active--
      this.queue.shift()?.()
    }
  }
}

/** Extract a meaningful error message, unwinding `cause` chains (e.g. Node fetch). */
export function errorMessage(err: unknown): string {
  if (!(err instanceof Error)) return String(err)
  let msg = err.message
  let cause = err.cause
  while (cause instanceof Error) {
    if (cause.message && cause.message !== msg) {
      msg += `: ${cause.message}`
    }
    cause = cause.cause
  }
  return msg
}

export function normalizeDate(pubDate: string | undefined | null): string | null {
  if (!pubDate) return null
  const d = new Date(pubDate)
  return isNaN(d.getTime()) ? null : d.toISOString()
}
