import { describe, it, expect, beforeEach } from 'vitest'
import { setupTestDb } from '../__tests__/helpers/testDb.js'
import {
  createFeed,
  getDb,
  insertArticle,
  markArticleBookmarked,
  markArticleLiked,
  recalculateScores,
  recordArticleRead,
} from '../db.js'
import { collectScoreBaseline } from './score-stats.js'

beforeEach(() => {
  setupTestDb()
})

let seq = 0

function seedFeed() {
  return createFeed({ name: 'Test Feed', url: 'https://example.com' })
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString()
}

function seedArticle(feedId: number, overrides: Partial<Parameters<typeof insertArticle>[0]> = {}) {
  seq += 1
  return insertArticle({
    feed_id: feedId,
    title: `Article ${seq}`,
    url: `https://example.com/article/${seq}`,
    published_at: daysAgo(1),
    ...overrides,
  })
}

describe('collectScoreBaseline corpus and coverage', () => {
  it('reports every unengaged article as score 0', () => {
    const feed = seedFeed()
    seedArticle(feed.id)
    seedArticle(feed.id)
    seedArticle(feed.id)
    const liked = seedArticle(feed.id)
    markArticleLiked(liked, true)

    const b = collectScoreBaseline()

    expect(b.corpus.total).toBe(4)
    expect(b.corpus.engaged).toBe(1)
    expect(b.corpus.liked).toBe(1)
    expect(b.score.zero).toBe(3)
    expect(b.score.zero_share).toBeCloseTo(0.75, 5)
    expect(b.score.nonzero).toBe(1)
    expect(b.score.unengaged_nonzero).toBe(0)
  })

  it('counts articles whose stored score outlived their engagement', () => {
    const feed = seedFeed()
    const id = seedArticle(feed.id)
    markArticleLiked(id, true)
    // Drop the engagement without recomputing — what a stale recalc cron leaves behind.
    getDb().prepare('UPDATE articles SET liked_at = NULL WHERE id = ?').run(id)

    const b = collectScoreBaseline()

    expect(b.corpus.engaged).toBe(0)
    expect(b.score.unengaged_nonzero).toBe(1)
  })

  it('excludes purged articles', () => {
    const feed = seedFeed()
    seedArticle(feed.id)
    const purged = seedArticle(feed.id)
    getDb().prepare("UPDATE articles SET purged_at = datetime('now') WHERE id = ?").run(purged)

    expect(collectScoreBaseline().corpus.total).toBe(1)
  })

  it('places scores into fixed histogram buckets', () => {
    const feed = seedFeed()
    seedArticle(feed.id)
    const liked = seedArticle(feed.id)
    markArticleLiked(liked, true)
    recalculateScores()

    const b = collectScoreBaseline()
    const zeroBucket = b.score.buckets[0]
    const topBucket = b.score.buckets[b.score.buckets.length - 1]

    expect(zeroBucket.to).toBe(0)
    expect(zeroBucket.articles).toBe(1)
    // A like on a day-old article scores ~9.5, landing in the 8–16 bucket.
    expect(topBucket.to).toBeNull()
    expect(topBucket.articles).toBe(0)
    expect(b.score.buckets.find(bk => bk.from === 8)?.articles).toBe(1)
    expect(b.score.buckets.reduce((sum, bk) => sum + bk.articles, 0)).toBe(2)
  })
})

describe('collectScoreBaseline engagement buckets', () => {
  it('groups articles by raw engagement value', () => {
    const feed = seedFeed()
    seedArticle(feed.id)
    const read = seedArticle(feed.id)
    recordArticleRead(read)
    const both = seedArticle(feed.id)
    markArticleLiked(both, true)
    markArticleBookmarked(both, true)

    const b = collectScoreBaseline()
    const byValue = new Map(b.engagement.map(e => [e.engagement, e.articles]))

    expect(byValue.get(0)).toBe(1)
    expect(byValue.get(2)).toBe(1)   // read
    expect(byValue.get(15)).toBe(1)  // liked + bookmarked
    expect(b.engagement.map(e => e.engagement)).toEqual([0, 2, 15])
  })
})

describe('collectScoreBaseline distributions', () => {
  it('computes nearest-rank percentiles over article age', () => {
    const feed = seedFeed()
    for (let i = 0; i < 10; i++) seedArticle(feed.id, { published_at: daysAgo(i) })

    const d = collectScoreBaseline().days_since_activity

    expect(d.count).toBe(10)
    expect(d.min).toBeCloseTo(0, 1)
    expect(d.max).toBeCloseTo(9, 1)
    // n = 10 → p50 is the 5th smallest value (index floor(9 * 0.5) + 1)
    expect(d.p50).toBeCloseTo(4, 1)
    expect(d.p90).toBeCloseTo(8, 1)
    expect(d.mean).toBeCloseTo(4.5, 1)
  })

  it('reports the decay factor actually applied', () => {
    const feed = seedFeed()
    seedArticle(feed.id, { published_at: daysAgo(0) })
    seedArticle(feed.id, { published_at: daysAgo(20) })

    const b = collectScoreBaseline()

    expect(b.decay_factor).toBe(0.05)
    expect(b.decay.max).toBeCloseTo(1, 2)          // brand new
    expect(b.decay.min).toBeCloseTo(0.5, 2)        // 1 / (1 + 20 * 0.05)
  })

  it('returns empty distributions on an empty corpus', () => {
    const b = collectScoreBaseline()

    expect(b.corpus.total).toBe(0)
    expect(b.score.zero_share).toBe(0)
    expect(b.days_since_activity.count).toBe(0)
    expect(b.days_since_activity.p50).toBeNull()
    expect(b.engagement).toEqual([])
  })
})

describe('collectScoreBaseline candidate windows', () => {
  it('counts articles per trailing window', () => {
    const feed = seedFeed()
    seedArticle(feed.id, { published_at: daysAgo(0) })
    seedArticle(feed.id, { published_at: daysAgo(3) })
    seedArticle(feed.id, { published_at: daysAgo(20) })
    seedArticle(feed.id, { published_at: daysAgo(60) })

    const windows = collectScoreBaseline().candidate_windows
    const byHours = new Map(windows.map(w => [w.hours, w]))

    expect(byHours.get(24)?.articles).toBe(1)
    expect(byHours.get(168)?.articles).toBe(2)
    expect(byHours.get(720)?.articles).toBe(3)
  })

  it('reports how much of a window is unrankable', () => {
    const feed = seedFeed()
    seedArticle(feed.id, { published_at: daysAgo(0) })
    seedArticle(feed.id, { published_at: daysAgo(0) })
    const liked = seedArticle(feed.id, { published_at: daysAgo(0) })
    markArticleLiked(liked, true)

    const today = collectScoreBaseline().candidate_windows.find(w => w.hours === 24)!

    expect(today.articles).toBe(3)
    expect(today.unread).toBe(3)
    expect(today.zero_score).toBe(2)
    expect(today.zero_score_share).toBeCloseTo(2 / 3, 5)
    // One shared zero plus the liked article's own value.
    expect(today.distinct_scores).toBe(2)
  })
})

describe('collectScoreBaseline drift', () => {
  it('measures stored scores against a fresh computation', () => {
    const feed = seedFeed()
    const id = seedArticle(feed.id)
    markArticleLiked(id, true)
    recalculateScores()

    expect(collectScoreBaseline().drift.over_tolerance).toBe(0)

    getDb().prepare('UPDATE articles SET score = 1.0 WHERE id = ?').run(id)
    const drift = collectScoreBaseline().drift

    expect(drift.articles).toBe(1)
    expect(drift.over_tolerance).toBe(1)
    expect(drift.max_abs).toBeGreaterThan(8)
  })
})
