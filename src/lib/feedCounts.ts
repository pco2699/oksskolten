import type { ScopedMutator } from 'swr'
import type { FeedWithCounts } from '../../shared/types'

/** SWR key the sidebar reads its feed list and unread badges from. */
export const FEEDS_KEY = '/api/feeds'

interface FeedsCache {
  feeds: FeedWithCounts[]
}

/**
 * Apply a read/unread change to the sidebar unread badges.
 *
 * A plain revalidation is not enough on its own: when an article is opened as a
 * full page the sidebar is unmounted, so nothing is subscribed to `/api/feeds`
 * and SWR has no revalidator to run — the request never goes out and the cached
 * counts stay stale. Writing the delta into the cache keeps the badge correct in
 * that case, and the revalidation still runs whenever the sidebar is mounted
 * (overlay mode, in-list toggles) so the exact server value wins.
 *
 * @param delta -1 when an article became read, +1 when it became unread again
 */
export function adjustFeedUnread(mutate: ScopedMutator, feedId: number, delta: number): void {
  if (delta === 0) return
  void mutate(
    FEEDS_KEY,
    (curr: FeedsCache | undefined) => curr?.feeds
      ? {
          ...curr,
          feeds: curr.feeds.map(f =>
            f.id === feedId ? { ...f, unread_count: Math.max(0, f.unread_count + delta) } : f),
        }
      : curr,
    { revalidate: true },
  )
}
