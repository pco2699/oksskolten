-- Covering index for the per-feed aggregates behind GET /api/feeds.
--
-- `getFeeds()` groups every active article by feed to compute article_count,
-- unread_count, articles_per_week and latest_published_at, and the same
-- endpoint also runs `getBookmarkCount()` / `getLikeCount()`. All of those
-- read columns (seen_at, published_at, fetched_at, bookmarked_at, liked_at)
-- that sit *after* full_text / full_text_translated / summary in the row, so
-- SQLite had to walk each article's overflow pages just to reach them. With
-- ~30k articles averaging ~11 KB that is effectively a scan of the whole
-- table (~330 MB) on every sidebar refresh: 6-9 s against a cold page cache,
-- and since libsql is synchronous, the event loop stalled for all of it.
--
-- With every referenced column in the index, all three queries become a
-- COVERING INDEX search on purged_at and never touch the table (~10 ms).
-- The index itself is ~2 MB.
CREATE INDEX IF NOT EXISTS idx_articles_active_feed_stats
  ON articles(purged_at, feed_id, seen_at, published_at, fetched_at, bookmarked_at, liked_at);
