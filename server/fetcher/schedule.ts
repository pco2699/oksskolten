import type { RssItem } from './rss.js'

// --- Constants ---

export const MIN_INTERVAL = 15 * 60       // 15 minutes (seconds)
export const MAX_INTERVAL = 4 * 60 * 60   // 4 hours (seconds)
export const DEFAULT_INTERVAL = 60 * 60   // 1 hour (seconds)

// --- Date formatting ---

/** Format a Date as SQLite strftime('%Y-%m-%dT%H:%M:%SZ') compatible string */
export function formatDateSqlite(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

/** Generate a future SQLite-compatible datetime string */
export function sqliteFuture(seconds: number): string {
  return formatDateSqlite(new Date(Date.now() + seconds * 1000))
}

// --- HTTP cache interval ---

export function parseHttpCacheInterval(headers: Headers): number | null {
  let maxAgeSec = 0

  // Cache-Control: max-age=3600
  const cc = headers.get('cache-control')
  const match = cc?.match(/max-age=(\d+)/)
  if (match) maxAgeSec = parseInt(match[1], 10)

  // Expires: Thu, 01 Jan 2026 12:00:00 GMT
  let expiresSec = 0
  const expires = headers.get('expires')
  if (expires) {
    const expiresMs = new Date(expires).getTime() - Date.now()
    if (expiresMs > 0) expiresSec = Math.floor(expiresMs / 1000)
  }

  const result = Math.max(maxAgeSec, expiresSec)
  return result > 0 ? result : null
}

// --- RSS TTL ---

export function parseRssTtl(xml: string): number | null {
  // Match <ttl>N</ttl> in RSS 2.0 (minutes → seconds)
  const match = xml.match(/<ttl>\s*(\d+)\s*<\/ttl>/i)
  if (!match) return null
  const minutes = parseInt(match[1], 10)
  return minutes > 0 ? minutes * 60 : null
}

// --- Empirical interval (CommaFeed-style) ---

export function computeEmpiricalInterval(items: RssItem[]): number {
  const now = Date.now()
  const dates = items
    .map(i => i.published_at ? new Date(i.published_at).getTime() : null)
    .filter((d): d is number => d !== null && !isNaN(d))
    .sort((a, b) => b - a)

  if (dates.length === 0) return MAX_INTERVAL

  const latestAge = now - dates[0]
  const daysSinceLatest = latestAge / (24 * 60 * 60 * 1000)

  // Step-down based on days since latest article
  if (daysSinceLatest >= 30) return MAX_INTERVAL         // 4h
  if (daysSinceLatest >= 14) return MAX_INTERVAL / 2     // 2h
  if (daysSinceLatest >= 7)  return MAX_INTERVAL / 4     // 1h

  // < 7 days: half the *median* gap between consecutive articles.
  //
  // The median rather than the mean, because `published_at` is the article's
  // own publication date, which for a ranking or forum feed is not when the
  // item entered the feed. A years-old post that suddenly trends, or a dormant
  // thread that gets a reply, arrives carrying its original date. Averaging
  // across the window lets one such item dictate the schedule: Hatena's
  // technology hotentry carried a 14-day-old entry among 30 otherwise same-day
  // ones, which pushed the mean gap to 11.7 hours and pinned the feed at the
  // 4-hour ceiling — while it was actually publishing about every 20 minutes.
  // The median of the same payload is 27 minutes. A genuinely slow feed has a
  // large median too, so it still backs off.
  if (dates.length >= 2) {
    const gaps: number[] = []
    for (let i = 0; i < dates.length - 1; i++) gaps.push(dates[i] - dates[i + 1])
    gaps.sort((a, b) => a - b)
    const mid = Math.floor(gaps.length / 2)
    const medianGapMs = gaps.length % 2 === 0 ? (gaps[mid - 1] + gaps[mid]) / 2 : gaps[mid]
    const halfMedianSec = Math.floor(medianGapMs / 2000)
    return Math.max(MIN_INTERVAL, halfMedianSec)
  }

  return MAX_INTERVAL / 4  // single article → 1h
}

// --- Combined interval computation ---

export function computeInterval(
  httpCacheSeconds: number | null,
  rssTtlSeconds: number | null,
  empiricalSeconds: number,
): number {
  return Math.min(
    MAX_INTERVAL,
    Math.max(
      MIN_INTERVAL,
      Math.max(httpCacheSeconds ?? 0, rssTtlSeconds ?? 0, empiricalSeconds),
    ),
  )
}
