import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setupTestDb } from '../__tests__/helpers/testDb.js'
import {
  createFeed,
  insertArticle,
  getArticleById,
  markArticleSeen,
  createCategory,
  updateArticleContent,
} from '../db.js'

// Mock fetcher AI calls
vi.mock('../fetcher.js', () => ({
  summarizeArticle: vi.fn().mockResolvedValue({
    summary: 'Mocked summary',
    inputTokens: 100,
    outputTokens: 50,
  }),
  translateArticle: vi.fn().mockResolvedValue({
    fullTextTranslated: 'モック翻訳テキスト',
    inputTokens: 200,
    outputTokens: 150,
  }),
}))

import { TOOLS, toOpenAITools, executeTool } from './tools.js'

beforeEach(() => {
  setupTestDb()
})

function seedFeed(overrides: Partial<Parameters<typeof createFeed>[0]> = {}) {
  return createFeed({
    name: 'Test Feed',
    url: 'https://example.com',
    ...overrides,
  })
}

/** Body long enough to clear the summarizer's minimum-length check. */
function articleBody(text = 'Some article text.'): string {
  return text + ' ' + 'The quick brown fox jumps over the lazy dog. '.repeat(10)
}

function seedArticle(feedId: number, overrides: Partial<Parameters<typeof insertArticle>[0]> = {}) {
  return insertArticle({
    feed_id: feedId,
    title: 'Test Article',
    url: `https://example.com/article/${Math.random()}`,
    published_at: '2025-01-01T00:00:00Z',
    ...overrides,
  })
}

describe('TOOLS array', () => {
  it('all tools have required fields', () => {
    for (const tool of TOOLS) {
      expect(tool.name).toBeTruthy()
      expect(tool.description).toBeTruthy()
      expect(tool.inputSchema.type).toBe('object')
      expect(typeof tool.execute).toBe('function')
    }
  })
})

describe('toOpenAITools', () => {
  it('converts to the chat-completions function format', () => {
    const tools = toOpenAITools()
    expect(tools.length).toBeGreaterThan(0)
    for (const tool of tools) {
      expect(tool.type).toBe('function')
      expect(tool.function).toHaveProperty('name')
      expect(tool.function).toHaveProperty('description')
      expect(tool.function.parameters.type).toBe('object')
    }
  })
})

describe('executeTool', () => {
  it('throws for unknown tool', async () => {
    await expect(executeTool('nonexistent', {})).rejects.toThrow('Unknown tool: nonexistent')
  })
})

describe('search_articles', () => {
  it('returns articles matching filters', async () => {
    const feed = seedFeed()
    seedArticle(feed.id, { url: 'https://example.com/a1', title: 'TypeScript Guide' })
    seedArticle(feed.id, { url: 'https://example.com/a2', title: 'Python Tips' })

    const result = JSON.parse(await executeTool('search_articles', {}))
    expect(result).toHaveLength(2)
    expect(result[0]).toHaveProperty('title')
    expect(result[0]).toHaveProperty('feed_name')
  })

  it('filters by FTS query', async () => {
    const feed = seedFeed()
    seedArticle(feed.id, { url: 'https://example.com/ts', title: 'TypeScript Guide' })
    seedArticle(feed.id, { url: 'https://example.com/py', title: 'Python Tips' })

    const result = JSON.parse(await executeTool('search_articles', { query: 'TypeScript' }))
    expect(result).toHaveLength(1)
    expect(result[0].title).toBe('TypeScript Guide')
  })

  it('filters by unread', async () => {
    const feed = seedFeed()
    const id1 = seedArticle(feed.id, { url: 'https://example.com/1' })
    seedArticle(feed.id, { url: 'https://example.com/2' })
    markArticleSeen(id1, true)

    const result = JSON.parse(await executeTool('search_articles', { unread: true }))
    expect(result).toHaveLength(1)
  })

  it('sorts by published_at when sort param is specified', async () => {
    const feed = seedFeed()
    seedArticle(feed.id, { url: 'https://example.com/old', title: 'Old', published_at: '2025-01-01T00:00:00Z' })
    seedArticle(feed.id, { url: 'https://example.com/new', title: 'New', published_at: '2025-06-01T00:00:00Z' })

    const result = JSON.parse(await executeTool('search_articles', { sort: 'published_at' }))
    expect(result).toHaveLength(2)
    expect(result[0].title).toBe('New')
    expect(result[1].title).toBe('Old')
  })

  it('sorts by score when sort param is specified', async () => {
    const feed = seedFeed()
    seedArticle(feed.id, { url: 'https://example.com/low', title: 'Low Score', published_at: '2025-01-01T00:00:00Z' })
    const id = seedArticle(feed.id, { url: 'https://example.com/high', title: 'High Score', published_at: '2025-01-02T00:00:00Z' })
    // Like article 2 to boost its score
    markArticleSeen(id, true)
    const { markArticleLiked } = await import('../db.js')
    markArticleLiked(id, true)

    const result = JSON.parse(await executeTool('search_articles', { sort: 'score' }))
    expect(result).toHaveLength(2)
    // The liked article should come first when sorting by score
    expect(result[0].title).toBe('High Score')
  })

  it('truncates summary to 200 characters', async () => {
    const feed = seedFeed()
    const longSummary = 'A'.repeat(300)
    seedArticle(feed.id, { summary: longSummary })

    const result = JSON.parse(await executeTool('search_articles', {}))
    expect(result[0].summary).toHaveLength(200)
    expect(result[0].summary).toBe('A'.repeat(200))
  })
})

describe('get_article', () => {
  it('returns article details', async () => {
    const feed = seedFeed()
    const id = seedArticle(feed.id, {
      title: 'Detail Test',
      full_text: 'Full text content',
      summary: 'A summary',
    })

    const result = JSON.parse(await executeTool('get_article', { article_id: id }))
    expect(result.title).toBe('Detail Test')
    expect(result.full_text).toBe('Full text content')
    expect(result.summary).toBe('A summary')
  })

  it('returns error for non-existent article', async () => {
    const result = JSON.parse(await executeTool('get_article', { article_id: 9999 }))
    expect(result.error).toBe('Article not found')
  })
})

describe('get_feeds', () => {
  it('returns feed list', async () => {
    seedFeed({ name: 'Feed A', url: 'https://a.com' })
    seedFeed({ name: 'Feed B', url: 'https://b.com' })

    const result = JSON.parse(await executeTool('get_feeds', {}))
    expect(result).toHaveLength(2)
    expect(result[0]).toHaveProperty('name')
    expect(result[0]).toHaveProperty('article_count')
    expect(result[0]).toHaveProperty('unread_count')
  })
})

describe('get_categories', () => {
  it('returns categories', async () => {
    createCategory('Tech')
    createCategory('News')

    const result = JSON.parse(await executeTool('get_categories', {}))
    expect(result).toHaveLength(2)
  })
})

describe('get_reading_stats', () => {
  it('returns reading statistics', async () => {
    const feed = seedFeed()
    const id1 = seedArticle(feed.id, { url: 'https://example.com/1' })
    seedArticle(feed.id, { url: 'https://example.com/2' })
    markArticleSeen(id1, true)

    const result = JSON.parse(await executeTool('get_reading_stats', {}))
    expect(result.total).toBe(2)
    expect(result.read).toBe(1)
    expect(result.unread).toBe(1)
    expect(result.by_feed).toHaveLength(1)
  })
})

describe('mark_as_read', () => {
  it('marks article as read', async () => {
    const feed = seedFeed()
    const id = seedArticle(feed.id)

    const result = JSON.parse(await executeTool('mark_as_read', { article_id: id }))
    expect(result.success).toBe(true)

    const article = getArticleById(id)!
    expect(article.seen_at).not.toBeNull()
  })

  it('returns error for non-existent article', async () => {
    const result = JSON.parse(await executeTool('mark_as_read', { article_id: 9999 }))
    expect(result.error).toBe('Article not found')
  })
})

describe('mark_articles_as_read', () => {
  it('marks multiple articles as read', async () => {
    const feed = seedFeed()
    const id1 = seedArticle(feed.id, { url: 'https://example.com/m1' })
    const id2 = seedArticle(feed.id, { url: 'https://example.com/m2' })

    const result = JSON.parse(await executeTool('mark_articles_as_read', { article_ids: [id1, id2] }))
    expect(result.success).toBe(true)
    expect(result.count).toBe(2)

    expect(getArticleById(id1)!.seen_at).not.toBeNull()
    expect(getArticleById(id2)!.seen_at).not.toBeNull()
  })

  it('handles empty array', async () => {
    const result = JSON.parse(await executeTool('mark_articles_as_read', { article_ids: [] }))
    expect(result.success).toBe(true)
    expect(result.count).toBe(0)
  })
})

describe('toggle_like', () => {
  it('likes an article', async () => {
    const feed = seedFeed()
    const id = seedArticle(feed.id)

    const result = JSON.parse(await executeTool('toggle_like', { article_id: id }))
    expect(result.liked).toBe(true)
    expect(result.liked_at).not.toBeNull()
  })

  it('unlikes a liked article', async () => {
    const feed = seedFeed()
    const id = seedArticle(feed.id)
    const { markArticleLiked } = await import('../db.js')
    markArticleLiked(id, true)

    const result = JSON.parse(await executeTool('toggle_like', { article_id: id }))
    expect(result.liked).toBe(false)
  })

  it('returns error for non-existent article', async () => {
    const result = JSON.parse(await executeTool('toggle_like', { article_id: 9999 }))
    expect(result.error).toBe('Article not found')
  })
})

describe('toggle_bookmark', () => {
  it('bookmarks an article', async () => {
    const feed = seedFeed()
    const id = seedArticle(feed.id)

    const result = JSON.parse(await executeTool('toggle_bookmark', { article_id: id }))
    expect(result.bookmarked).toBe(true)
    expect(result.bookmarked_at).not.toBeNull()
  })

  it('unbookmarks a bookmarked article', async () => {
    const feed = seedFeed()
    const id = seedArticle(feed.id)
    const { markArticleBookmarked } = await import('../db.js')
    markArticleBookmarked(id, true)

    const result = JSON.parse(await executeTool('toggle_bookmark', { article_id: id }))
    expect(result.bookmarked).toBe(false)
  })

  it('returns error for non-existent article', async () => {
    const result = JSON.parse(await executeTool('toggle_bookmark', { article_id: 9999 }))
    expect(result.error).toBe('Article not found')
  })
})

describe('get_article fetch_status', () => {
  it('labels a body that is really a bot-check page', async () => {
    const feed = seedFeed()
    const id = seedArticle(feed.id, {
      full_text: articleBody('Sign in to confirm you\u2019re not a bot'),
    })

    const result = JSON.parse(await executeTool('get_article', { article_id: id }))
    expect(result.fetch_status).toBe('bot_check')
    expect(result.fetch_status_detail).toMatch(/not article content/)
  })

  it('has no fetch_status for a genuine body', async () => {
    const feed = seedFeed()
    const id = seedArticle(feed.id, { full_text: articleBody() })

    const result = JSON.parse(await executeTool('get_article', { article_id: id }))
    expect(result.fetch_status).toBeUndefined()
  })
})

describe('summarize_article', () => {
  it('returns cached summary if available', async () => {
    const feed = seedFeed()
    const id = seedArticle(feed.id, { full_text: articleBody(), summary: 'Existing summary' })

    const result = JSON.parse(await executeTool('summarize_article', { article_id: id }))
    expect(result.summary).toBe('Existing summary')
    expect(result.cached).toBe(true)
  })

  it('generates summary when not cached', async () => {
    const feed = seedFeed()
    const id = seedArticle(feed.id, { full_text: articleBody() })

    const result = JSON.parse(await executeTool('summarize_article', { article_id: id }))
    expect(result.summary).toBe('Mocked summary')

    // Verify it was persisted
    const article = getArticleById(id)!
    expect(article.summary).toBe('Mocked summary')
  })

  it('returns error when no full_text', async () => {
    const feed = seedFeed()
    const id = seedArticle(feed.id, { full_text: undefined })

    const result = JSON.parse(await executeTool('summarize_article', { article_id: id }))
    expect(result.error).toBe('No full text available')
  })

  it('refuses to summarize a bot-check page instead of describing it', async () => {
    const feed = seedFeed()
    const id = seedArticle(feed.id, {
      full_text: articleBody('Our systems have detected unusual traffic from your computer network.'),
    })

    const result = JSON.parse(await executeTool('summarize_article', { article_id: id }))
    expect(result.summary).toBeUndefined()
    expect(result.fetch_status).toBe('bot_check')
    expect(result.error).toMatch(/bot-check page/)
    // Nothing is persisted, so a later refetch can still produce a real summary
    expect(getArticleById(id)!.summary).toBeNull()
  })

  it('refuses a summary that was cached from a bot-check page', async () => {
    const feed = seedFeed()
    const id = seedArticle(feed.id, {
      full_text: articleBody('Before you continue to YouTube'),
      summary: 'An article about YouTube detecting unusual traffic.',
    })

    const result = JSON.parse(await executeTool('summarize_article', { article_id: id }))
    expect(result.summary).toBeUndefined()
    expect(result.fetch_status).toBe('consent_wall')
  })

  it('refuses a body too short to summarize', async () => {
    const feed = seedFeed()
    const id = seedArticle(feed.id, { full_text: 'Sorry.' })

    const result = JSON.parse(await executeTool('summarize_article', { article_id: id }))
    expect(result.summary).toBeUndefined()
    expect(result.fetch_status).toBe('too_short')
  })
})

describe('summarize_articles', () => {
  it('returns cached and new summaries', async () => {
    const feed = seedFeed()
    const id1 = seedArticle(feed.id, { url: 'https://example.com/s1', full_text: articleBody('Text 1.'), summary: 'Cached 1' })
    const id2 = seedArticle(feed.id, { url: 'https://example.com/s2', full_text: articleBody('Text 2.') })

    const result = JSON.parse(await executeTool('summarize_articles', { article_ids: [id1, id2] }))
    expect(result).toHaveLength(2)
    expect(result.find((r: any) => r.id === id1).summary).toBe('Cached 1')
    expect(result.find((r: any) => r.id === id1).cached).toBe(true)
    expect(result.find((r: any) => r.id === id2).summary).toBe('Mocked summary')
  })

  it('reports blocked articles per id without summarizing them', async () => {
    const feed = seedFeed()
    const ok = seedArticle(feed.id, { url: 'https://example.com/ok', full_text: articleBody('Real post.') })
    const blocked = seedArticle(feed.id, {
      url: 'https://example.com/blocked',
      full_text: articleBody('Our systems have detected unusual traffic from your computer network.'),
    })

    const result = JSON.parse(await executeTool('summarize_articles', { article_ids: [ok, blocked] }))
    expect(result.find((r: any) => r.id === ok).summary).toBe('Mocked summary')
    const blockedResult = result.find((r: any) => r.id === blocked)
    expect(blockedResult.summary).toBeUndefined()
    expect(blockedResult.fetch_status).toBe('bot_check')
  })

  it('handles empty array', async () => {
    const result = JSON.parse(await executeTool('summarize_articles', { article_ids: [] }))
    expect(result).toEqual([])
  })
})

describe('translate_article', () => {
  it('refuses to translate a bot-check page', async () => {
    const feed = seedFeed()
    const id = seedArticle(feed.id, {
      full_text: articleBody('Our systems have detected unusual traffic from your computer network.'),
      lang: 'en',
    })

    const result = JSON.parse(await executeTool('translate_article', { article_id: id }))
    expect(result.full_text_translated).toBeUndefined()
    expect(result.fetch_status).toBe('bot_check')
  })

  it('translates a short body — no length floor applies', async () => {
    const feed = seedFeed()
    const id = seedArticle(feed.id, { full_text: 'Texte court.', lang: 'fr' })

    const result = JSON.parse(await executeTool('translate_article', { article_id: id }))
    expect(result.full_text_translated).toBe('モック翻訳テキスト')
  })

  it('returns cached translation if available', async () => {
    const feed = seedFeed()
    const id = seedArticle(feed.id, { full_text: 'text', lang: 'en' })
    updateArticleContent(id, { full_text_translated: 'Existing translation', translated_lang: 'en' })

    const result = JSON.parse(await executeTool('translate_article', { article_id: id }))
    expect(result.full_text_translated).toBe('Existing translation')
    expect(result.cached).toBe(true)
  })

  it('does not cache when translated_lang differs from user language', async () => {
    const feed = seedFeed()
    const id = seedArticle(feed.id, { full_text: 'French text', lang: 'fr' })
    // translated_lang='ja' but user language defaults to 'en' → stale
    updateArticleContent(id, { full_text_translated: 'Old Japanese translation', translated_lang: 'ja' })

    const result = JSON.parse(await executeTool('translate_article', { article_id: id }))
    // Should re-translate, not return cached
    expect(result.cached).toBeUndefined()
    expect(result.full_text_translated).toBe('モック翻訳テキスト')
  })

  it('does not cache when translated_lang is null', async () => {
    const feed = seedFeed()
    const id = seedArticle(feed.id, { full_text: 'French text', lang: 'fr' })
    updateArticleContent(id, { full_text_translated: 'Legacy translation' })

    const result = JSON.parse(await executeTool('translate_article', { article_id: id }))
    expect(result.cached).toBeUndefined()
    expect(result.full_text_translated).toBe('モック翻訳テキスト')
  })

  it('generates translation when not cached', async () => {
    const feed = seedFeed()
    const id = seedArticle(feed.id, { full_text: 'Artículo en español', lang: 'es' })

    const result = JSON.parse(await executeTool('translate_article', { article_id: id }))
    expect(result.full_text_translated).toBe('モック翻訳テキスト')
  })

  it('returns error when article is already in user language', async () => {
    const feed = seedFeed()
    // Default user language is 'en'
    const id = seedArticle(feed.id, { full_text: 'English text', lang: 'en' })

    const result = JSON.parse(await executeTool('translate_article', { article_id: id }))
    expect(result.error).toBe('Article is already in en')
  })
})

describe('get_user_preferences', () => {
  it('truncates recent_likes summary to 200 characters', async () => {
    const feed = seedFeed()
    const longSummary = 'B'.repeat(300)
    const id = seedArticle(feed.id, { summary: longSummary })
    const { markArticleLiked } = await import('../db.js')
    markArticleLiked(id, true)

    const result = JSON.parse(await executeTool('get_user_preferences', {}))
    expect(result.recent_likes).toHaveLength(1)
    expect(result.recent_likes[0].summary).toHaveLength(200)
    expect(result.recent_likes[0].summary).toBe('B'.repeat(200))
  })

  it('returns category_read_rates and ignored_feeds fields', async () => {
    const { createCategory } = await import('../db.js')
    const cat = createCategory('Tech')
    const feed = seedFeed({ category_id: cat.id })
    // Create articles within last 30 days
    const now = new Date().toISOString()
    seedArticle(feed.id, { url: 'https://example.com/p1', published_at: now })
    seedArticle(feed.id, { url: 'https://example.com/p2', published_at: now })

    const result = JSON.parse(await executeTool('get_user_preferences', {}))
    expect(result).toHaveProperty('category_read_rates')
    expect(result).toHaveProperty('ignored_feeds')
    expect(Array.isArray(result.category_read_rates)).toBe(true)
    expect(Array.isArray(result.ignored_feeds)).toBe(true)
    // Tech category should appear with read_rate 0 (no reads)
    const tech = result.category_read_rates.find((c: any) => c.name === 'Tech')
    expect(tech).toBeDefined()
    expect(tech.total).toBe(2)
    expect(tech.read_rate).toBe(0)
  })

  it('excludes an article on the 30-day cutoff\'s calendar date but chronologically outside the window (PCO-34)', async () => {
    // Regression test for a format mismatch: `published_at` is stored as
    // `new Date().toISOString()` (`T` separator, milliseconds, `Z` suffix), while
    // `datetime('now', '-30 days')` produces a plain `YYYY-MM-DD HH:MM:SS` string. A naive
    // TEXT comparison is byte-order sensitive to that formatting difference whenever both
    // timestamps fall on the same calendar date — 'T' (0x54) always sorts after ' ' (0x20)
    // once the date portion matches, so the comparison ignores the actual time of day.
    //
    // This article is published at 00:00:00.000Z on the cutoff's calendar date — i.e.
    // genuinely older than 30 days, since midnight is earlier than the cutoff's
    // time-of-day for any test run not started at exactly midnight UTC. The old
    // byte-comparison always counted such an article as "within the last 30 days" purely
    // because of the separator; julianday()-based comparison correctly excludes it.
    const { createCategory, getDb } = await import('../db.js')
    const cat = createCategory('Tech')
    const feed = seedFeed({ category_id: cat.id })

    const { d: cutoffDate } = getDb().prepare("SELECT date('now', '-30 days') AS d").get() as { d: string }
    seedArticle(feed.id, { url: 'https://example.com/boundary-outside', published_at: `${cutoffDate}T00:00:00.000Z` })
    // Control article, unambiguously inside the window
    seedArticle(feed.id, { url: 'https://example.com/boundary-inside', published_at: new Date().toISOString() })

    const result = JSON.parse(await executeTool('get_user_preferences', {}))
    const tech = result.category_read_rates.find((c: any) => c.name === 'Tech')
    expect(tech).toBeDefined()
    expect(tech.total).toBe(1)
  })
})

describe('get_recent_activity', () => {
  it('returns all activity types by default', async () => {
    const feed = seedFeed()
    const id1 = seedArticle(feed.id, { url: 'https://example.com/r1', title: 'Read Article' })
    const id2 = seedArticle(feed.id, { url: 'https://example.com/r2', title: 'Liked Article' })
    markArticleSeen(id1, true)
    const { markArticleLiked } = await import('../db.js')
    markArticleLiked(id2, true)

    const result = JSON.parse(await executeTool('get_recent_activity', {}))
    expect(result.length).toBeGreaterThanOrEqual(2)
    const types = result.map((r: any) => r.activity_type)
    expect(types).toContain('read')
    expect(types).toContain('liked')
  })

  it('filters by activity type', async () => {
    const feed = seedFeed()
    const id1 = seedArticle(feed.id, { url: 'https://example.com/f1', title: 'Read Only' })
    const id2 = seedArticle(feed.id, { url: 'https://example.com/f2', title: 'Liked Only' })
    markArticleSeen(id1, true)
    const { markArticleLiked } = await import('../db.js')
    markArticleLiked(id2, true)

    const result = JSON.parse(await executeTool('get_recent_activity', { type: 'liked' }))
    expect(result).toHaveLength(1)
    expect(result[0].activity_type).toBe('liked')
    expect(result[0].title).toBe('Liked Only')
  })

  it('respects limit parameter', async () => {
    const feed = seedFeed()
    for (let i = 0; i < 5; i++) {
      const id = seedArticle(feed.id, { url: `https://example.com/lim${i}` })
      markArticleSeen(id, true)
    }

    const result = JSON.parse(await executeTool('get_recent_activity', { limit: 2 }))
    expect(result).toHaveLength(2)
  })

  it('returns app-internal URLs', async () => {
    const feed = seedFeed()
    const id = seedArticle(feed.id, { url: 'https://example.com/internal-test' })
    markArticleSeen(id, true)

    const result = JSON.parse(await executeTool('get_recent_activity', { type: 'read' }))
    expect(result[0].url).toBe('/example.com/internal-test')
  })

  it('truncates summary to 200 characters', async () => {
    const feed = seedFeed()
    const id = seedArticle(feed.id, { url: 'https://example.com/trunc', summary: 'C'.repeat(300) })
    markArticleSeen(id, true)

    const result = JSON.parse(await executeTool('get_recent_activity', { type: 'read' }))
    expect(result[0].summary).toHaveLength(200)
  })
})

describe('get_similar_articles', () => {
  it('returns error when search is not ready', async () => {
    const feed = seedFeed()
    const id = seedArticle(feed.id, { title: 'Test Article', summary: 'Test summary' })

    const result = JSON.parse(await executeTool('get_similar_articles', { article_id: id }))
    expect(result.error).toBe('Search index is building')
  })

  it('returns error for non-existent article', async () => {
    // Mock search as ready
    const syncModule = await import('../search/sync.js')
    vi.spyOn(syncModule, 'isSearchReady').mockReturnValue(true)

    const result = JSON.parse(await executeTool('get_similar_articles', { article_id: 9999 }))
    expect(result.error).toBe('Article not found')

    vi.restoreAllMocks()
  })
})
