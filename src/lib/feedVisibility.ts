import type { FeedWithCounts } from '../../shared/types'

export interface FeedVisibilityOptions {
  /** `reading.hide_zero_unread_feeds` resolved to a boolean. */
  hideZeroUnread: boolean
  /** Feed currently open in the reader, if any. */
  selectedFeedId: number | null
}

/**
 * Whether a feed should appear in the sidebar feed list.
 *
 * With `hideZeroUnread` on, a feed with nothing left to read drops out of the
 * list. Two exceptions keep the list from moving under the reader's hands:
 *
 * - The selected feed stays put. Reading its last unread article takes its
 *   count to 0, and removing the entry the reader is standing on — while the
 *   article list next to it still shows that feed — is the surprising outcome.
 *   It disappears on the next navigation, once it is no longer selected.
 * - Disabled feeds stay visible. They carry no unread count by definition, and
 *   hiding them would leave no way to re-enable or delete them from the sidebar.
 */
export function isFeedVisible(feed: FeedWithCounts, options: FeedVisibilityOptions): boolean {
  if (!options.hideZeroUnread) return true
  if (feed.id === options.selectedFeedId) return true
  if (feed.disabled) return true
  return feed.unread_count > 0
}

/** `isFeedVisible` applied over a list, preserving order. */
export function filterVisibleFeeds(feeds: FeedWithCounts[], options: FeedVisibilityOptions): FeedWithCounts[] {
  if (!options.hideZeroUnread) return feeds
  return feeds.filter(feed => isFeedVisible(feed, options))
}
