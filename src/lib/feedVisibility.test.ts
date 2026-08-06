import { describe, it, expect } from 'vitest'
import { isFeedVisible, filterVisibleFeeds } from './feedVisibility'
import { PREFERENCE_SCHEMA } from '../../shared/preferences'
import type { FeedWithCounts } from '../../shared/types'

function makeFeed(overrides: Partial<FeedWithCounts> = {}): FeedWithCounts {
  return {
    id: 1,
    name: 'Test Feed',
    url: 'https://example.com',
    rss_url: null,
    rss_bridge_url: null,
    category_id: null,
    last_error: null,
    error_count: 0,
    disabled: 0,
    requires_js_challenge: 0,
    skip_full_text_fetch: 0,
    type: 'rss',
    etag: null,
    last_modified: null,
    last_content_hash: null,
    next_check_at: null,
    check_interval: null,
    created_at: '2024-01-01',
    category_name: null,
    article_count: 10,
    unread_count: 3,
    articles_per_week: 2,
    latest_published_at: '2026-03-01T00:00:00Z',
    ...overrides,
  }
}

describe('reading.hide_zero_unread_feeds schema', () => {
  it('accepts only on/off', () => {
    expect(PREFERENCE_SCHEMA['reading.hide_zero_unread_feeds']).toEqual(['on', 'off'])
  })
})

describe('isFeedVisible', () => {
  it('keeps every feed when the setting is off', () => {
    const feed = makeFeed({ unread_count: 0 })
    expect(isFeedVisible(feed, { hideZeroUnread: false, selectedFeedId: null })).toBe(true)
  })

  it('hides a feed with no unread articles when the setting is on', () => {
    const feed = makeFeed({ unread_count: 0 })
    expect(isFeedVisible(feed, { hideZeroUnread: true, selectedFeedId: null })).toBe(false)
  })

  it('keeps a feed with unread articles when the setting is on', () => {
    const feed = makeFeed({ unread_count: 1 })
    expect(isFeedVisible(feed, { hideZeroUnread: true, selectedFeedId: null })).toBe(true)
  })

  it('keeps the selected feed even after its unread count drops to zero', () => {
    const feed = makeFeed({ id: 7, unread_count: 0 })
    expect(isFeedVisible(feed, { hideZeroUnread: true, selectedFeedId: 7 })).toBe(true)
  })

  it('keeps disabled feeds so they can still be re-enabled', () => {
    const feed = makeFeed({ unread_count: 0, disabled: 1 })
    expect(isFeedVisible(feed, { hideZeroUnread: true, selectedFeedId: null })).toBe(true)
  })
})

describe('filterVisibleFeeds', () => {
  const feeds = [
    makeFeed({ id: 1, name: 'Unread', unread_count: 2 }),
    makeFeed({ id: 2, name: 'Read', unread_count: 0 }),
    makeFeed({ id: 3, name: 'Selected', unread_count: 0 }),
  ]

  it('returns the list untouched when the setting is off', () => {
    expect(filterVisibleFeeds(feeds, { hideZeroUnread: false, selectedFeedId: null })).toBe(feeds)
  })

  it('drops zero-unread feeds and preserves order', () => {
    const result = filterVisibleFeeds(feeds, { hideZeroUnread: true, selectedFeedId: 3 })
    expect(result.map(f => f.name)).toEqual(['Unread', 'Selected'])
  })
})
