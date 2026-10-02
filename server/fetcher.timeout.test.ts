import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setupTestDb } from './__tests__/helpers/testDb.js'
import { createFeed, getArticleByUrl, getDb, getFeedById } from './db.js'
import type { Feed } from './db.js'

// The sweep timeouts are minutes long in production. Shrink them here; getters
// so each test can pick the ceiling it exercises.
const timeouts = { feed: 50, article: 50, sweep: 10_000 }

vi.mock('./fetcher/util.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('./fetcher/util.js')>()
  return {
    ...real,
    get FEED_TIMEOUT_MS() { return timeouts.feed },
    get ARTICLE_TIMEOUT_MS() { return timeouts.article },
    get SWEEP_TIMEOUT_MS() { return timeouts.sweep },
  }
})

vi.mock('./fetcher/flaresolverr.js', () => ({
  fetchViaFlareSolverr: () => Promise.resolve(null),
}))

const mockFetch = vi.fn()
/** A request that is never answered — the shape of the 2026-10-01 hang. */
const never = () => new Promise<never>(() => {})

beforeEach(() => {
  setupTestDb()
  timeouts.feed = 50
  timeouts.article = 50
  timeouts.sweep = 10_000
  mockFetch.mockReset()
  vi.stubGlobal('fetch', mockFetch)
})

function rssXml(links: string[]): string {
  const items = links.map(l => `<item><title>${l}</title><link>${l}</link></item>`).join('')
  return `<?xml version="1.0"?><rss version="2.0"><channel><title>T</title>${items}</channel></rss>`
}

function articleHtml(): string {
  const p = '<p>This is a paragraph of article content that is long enough for Readability to consider it meaningful text. It has several sentences. It keeps going.</p>'
  return `<!DOCTYPE html><html><head><title>A</title></head><body><article><h1>A</h1>${p.repeat(10)}</article></body></html>`
}

function mockResponse(body: string, contentType = 'text/html'): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': contentType }),
    text: () => Promise.resolve(body),
    arrayBuffer: () => Promise.resolve(new TextEncoder().encode(body).buffer),
  } as Response
}

function seedFeed(name: string, host: string): Feed {
  return createFeed({ name, url: `https://${host}`, rss_url: `https://${host}/rss` })
}

describe('fetchAllFeeds — timeouts', () => {
  let fetcher: typeof import('./fetcher.js')

  beforeEach(async () => {
    fetcher = await import('./fetcher.js')
  })

  it('a hung article fails alone and is queued for retry; the sweep completes', async () => {
    // The first parse loads the worker module, which takes far longer than the
    // 50ms ceiling; pay that cost before the clock matters.
    mockFetch.mockResolvedValue(mockResponse(articleHtml()))
    await fetcher.fetchArticleContent('https://warmup.example.com/')

    const feed = seedFeed('A', 'a.example.com')
    mockFetch.mockImplementation((url: string | URL) => {
      const u = url.toString()
      if (u === feed.rss_url) {
        return Promise.resolve(mockResponse(rssXml(['https://a.example.com/hang', 'https://a.example.com/ok']), 'application/rss+xml'))
      }
      if (u === 'https://a.example.com/hang') return never()
      return Promise.resolve(mockResponse(articleHtml()))
    })

    await expect(fetcher.fetchAllFeeds()).resolves.toBeUndefined()

    expect(getArticleByUrl('https://a.example.com/ok')?.full_text).toBeTruthy()
    // Stored with an error rather than dropped, so it is retried with backoff
    // instead of reappearing as "new" — and hanging — on every sweep.
    const hung = getDb()
      .prepare('SELECT full_text, last_error FROM articles WHERE url = ?')
      .get('https://a.example.com/hang') as { full_text: string | null; last_error: string | null } | undefined
    expect(hung).toBeDefined()
    expect(hung!.full_text).toBeNull()
    expect(hung!.last_error).toMatch(/article fetch timed out/)
  })

  it('a hung feed fails alone; other feeds are still ingested', async () => {
    const hung = seedFeed('Hung', 'hung.example.com')
    const ok = seedFeed('Ok', 'ok.example.com')
    mockFetch.mockImplementation((url: string | URL) => {
      const u = url.toString()
      if (u === hung.rss_url) return never()
      if (u === ok.rss_url) return Promise.resolve(mockResponse(rssXml(['https://ok.example.com/1']), 'application/rss+xml'))
      return Promise.resolve(mockResponse(articleHtml()))
    })

    await expect(fetcher.fetchAllFeeds()).resolves.toBeUndefined()

    expect(getArticleByUrl('https://ok.example.com/1')).toBeDefined()
    expect(getFeedById(hung.id)?.last_error).toMatch(/feed fetch timed out/)
  })

  it('abandons a sweep past its ceiling so the next one can start', async () => {
    timeouts.feed = 10_000
    timeouts.sweep = 50
    seedFeed('Hung', 'hung.example.com')
    mockFetch.mockImplementation(never)

    const first = fetcher.fetchAllFeeds()
    await expect(first).rejects.toThrow(/feed sweep timed out/)

    expect(fetcher.isFetchAllRunning()).toBe(false)
    const second = fetcher.fetchAllFeeds()
    expect(second).not.toBe(first)
    await expect(second).rejects.toThrow(/feed sweep timed out/)
  })

  it('reports a stall only when no sweep has completed recently', async () => {
    seedFeed('Ok', 'ok.example.com')
    mockFetch.mockImplementation(() => Promise.resolve(mockResponse(rssXml([]), 'application/rss+xml')))

    await fetcher.fetchAllFeeds()

    expect(fetcher.isFetchStalled()).toBe(false)
    expect(fetcher.isFetchStalled(Date.now() + 61 * 60_000)).toBe(true)
  })
})
