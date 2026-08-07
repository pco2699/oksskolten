import { describe, it, expect } from 'vitest'
import {
  MIN_INTERVAL,
  MAX_INTERVAL,
  formatDateSqlite,
  sqliteFuture,
  parseHttpCacheInterval,
  parseRssTtl,
  computeEmpiricalInterval,
  computeInterval,
} from './schedule.js'

// --- formatDateSqlite ---

describe('formatDateSqlite', () => {
  it('strips milliseconds from ISO string', () => {
    const d = new Date('2026-03-09T12:34:56.789Z')
    expect(formatDateSqlite(d)).toBe('2026-03-09T12:34:56Z')
  })

  it('produces a string comparable with SQLite strftime', () => {
    // strftime('%Y-%m-%dT%H:%M:%SZ', 'now') produces "2026-03-09T12:00:00Z"
    const a = formatDateSqlite(new Date('2026-03-09T11:00:00Z'))
    const b = formatDateSqlite(new Date('2026-03-09T12:00:00Z'))
    expect(a < b).toBe(true)
  })
})

// --- sqliteFuture ---

describe('sqliteFuture', () => {
  it('returns a date in the future', () => {
    const now = new Date()
    const future = sqliteFuture(3600)
    const futureDate = new Date(future)
    expect(futureDate.getTime()).toBeGreaterThan(now.getTime())
    expect(futureDate.getTime()).toBeLessThanOrEqual(now.getTime() + 3600 * 1000 + 1000)
  })

  it('has no milliseconds', () => {
    expect(sqliteFuture(60)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
  })
})

// --- parseHttpCacheInterval ---

describe('parseHttpCacheInterval', () => {
  it('parses Cache-Control max-age', () => {
    const headers = new Headers({ 'cache-control': 'public, max-age=3600' })
    expect(parseHttpCacheInterval(headers)).toBe(3600)
  })

  it('parses Expires header', () => {
    const future = new Date(Date.now() + 7200 * 1000).toUTCString()
    const headers = new Headers({ expires: future })
    const result = parseHttpCacheInterval(headers)!
    // Allow 5 second tolerance
    expect(result).toBeGreaterThan(7190)
    expect(result).toBeLessThanOrEqual(7200)
  })

  it('takes the max of Cache-Control and Expires', () => {
    const future = new Date(Date.now() + 7200 * 1000).toUTCString()
    const headers = new Headers({
      'cache-control': 'max-age=1800',
      expires: future,
    })
    const result = parseHttpCacheInterval(headers)!
    expect(result).toBeGreaterThan(7190)
  })

  it('returns null when no cache headers', () => {
    const headers = new Headers({ 'content-type': 'application/xml' })
    expect(parseHttpCacheInterval(headers)).toBeNull()
  })

  it('returns null for past Expires', () => {
    const past = new Date(Date.now() - 3600 * 1000).toUTCString()
    const headers = new Headers({ expires: past })
    expect(parseHttpCacheInterval(headers)).toBeNull()
  })
})

// --- parseRssTtl ---

describe('parseRssTtl', () => {
  it('extracts <ttl> from RSS 2.0 (minutes → seconds)', () => {
    const xml = '<rss><channel><ttl>60</ttl><item/></channel></rss>'
    expect(parseRssTtl(xml)).toBe(3600)
  })

  it('returns null when no <ttl>', () => {
    const xml = '<rss><channel><item/></channel></rss>'
    expect(parseRssTtl(xml)).toBeNull()
  })

  it('returns null for <ttl>0</ttl>', () => {
    const xml = '<rss><channel><ttl>0</ttl></channel></rss>'
    expect(parseRssTtl(xml)).toBeNull()
  })

  it('handles whitespace in <ttl>', () => {
    const xml = '<rss><channel><ttl> 30 </ttl></channel></rss>'
    expect(parseRssTtl(xml)).toBe(1800)
  })
})

// --- computeEmpiricalInterval ---

describe('computeEmpiricalInterval', () => {
  function makeItems(datesAgo: number[]): { title: string; url: string; published_at: string | null }[] {
    return datesAgo.map((daysAgo, i) => ({
      title: `Post ${i}`,
      url: `https://example.com/${i}`,
      published_at: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString(),
    }))
  }

  it('returns MAX_INTERVAL for empty items', () => {
    expect(computeEmpiricalInterval([])).toBe(MAX_INTERVAL)
  })

  it('returns MAX_INTERVAL when latest article is 30+ days old', () => {
    const items = makeItems([35, 40])
    expect(computeEmpiricalInterval(items)).toBe(MAX_INTERVAL)
  })

  it('returns MAX_INTERVAL/2 when latest article is 14-30 days old', () => {
    const items = makeItems([20, 25])
    expect(computeEmpiricalInterval(items)).toBe(MAX_INTERVAL / 2)
  })

  it('returns MAX_INTERVAL/4 when latest article is 7-14 days old', () => {
    const items = makeItems([10, 12])
    expect(computeEmpiricalInterval(items)).toBe(MAX_INTERVAL / 4)
  })

  it('returns half the median interval for active feeds (<7 days)', () => {
    // Articles every 2 days: median gap = 2 days, half = 1 day = 86400s
    const items = makeItems([1, 3, 5])
    const result = computeEmpiricalInterval(items)
    // Half of 2 days ≈ 86400s (raw, unclamped — clamping is done in computeInterval)
    expect(result).toBeGreaterThan(80000)
    expect(result).toBeLessThan(90000)
  })

  it('is not dragged out by a single old item resurfacing', () => {
    // The shape that pinned Hatena's hotentry feeds at the 4-hour ceiling: a
    // stream of same-day items plus one entry whose publication date is two
    // weeks back, because a ranking feed carries the article's own date rather
    // than the moment it entered the ranking. The mean gap here is over 2 days;
    // the median is 1 hour, which is what the feed actually does.
    const hoursAgo = [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5]
    const items = hoursAgo.map((h, i) => ({
      title: `Post ${i}`,
      url: `https://example.com/${i}`,
      published_at: new Date(Date.now() - h * 60 * 60 * 1000).toISOString(),
    }))
    items.push({
      title: 'Resurfaced',
      url: 'https://example.com/old',
      published_at: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString(),
    })

    const result = computeEmpiricalInterval(items)
    // Half of a 1-hour median gap, not half of the ~2.5-day mean.
    expect(result).toBe(30 * 60)
  })

  it('returns MAX_INTERVAL/4 for single recent article', () => {
    const items = makeItems([1])
    expect(computeEmpiricalInterval(items)).toBe(MAX_INTERVAL / 4)
  })

  it('clamps to MIN_INTERVAL for very frequent feeds', () => {
    // Articles every hour: avg = 1h, half = 30min > 15min min
    const items = Array.from({ length: 10 }, (_, i) => ({
      title: `Post ${i}`,
      url: `https://example.com/${i}`,
      published_at: new Date(Date.now() - i * 60 * 60 * 1000).toISOString(),
    }))
    const result = computeEmpiricalInterval(items)
    expect(result).toBeGreaterThanOrEqual(MIN_INTERVAL)
  })

  it('handles items with null published_at', () => {
    const items = [
      { title: 'A', url: 'https://a.com', published_at: null },
      { title: 'B', url: 'https://b.com', published_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString() },
    ]
    // One valid date → treated as single article
    expect(computeEmpiricalInterval(items)).toBe(MAX_INTERVAL / 4)
  })
})

// --- computeInterval ---

describe('computeInterval', () => {
  it('takes the max of all signals', () => {
    const result = computeInterval(1800, 3600, 900)
    expect(result).toBe(3600)
  })

  it('clamps to MAX_INTERVAL', () => {
    const result = computeInterval(99999, null, 900)
    expect(result).toBe(MAX_INTERVAL)
  })

  it('clamps to MIN_INTERVAL', () => {
    const result = computeInterval(60, 120, 30)
    expect(result).toBe(MIN_INTERVAL)
  })

  it('uses empirical when no HTTP/TTL signals', () => {
    const result = computeInterval(null, null, 7200)
    expect(result).toBe(7200)
  })

  it('ignores null signals', () => {
    const result = computeInterval(null, null, 1800)
    expect(result).toBe(1800)
  })
})
