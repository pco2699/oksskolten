-- Index for the per-feed "stale body" check the feed sweep runs on every feed
-- it fetches (countStaleArticlesByFeed / getArticlesNeedingRefresh).
--
-- That check filters on length(coalesce(trim(full_text), '')), which can only be
-- computed by loading every article's body, and since full_text sits early in
-- the row, its overflow chain has to be walked as well. Each sweep therefore read
-- most of the ~350 MB table, synchronously on the event loop. Against a cold page
-- cache (the norm on a small host where Meilisearch's mmap competes for memory)
-- that froze the whole server for 10-25 s every 5 minutes, so an article-list
-- request landing in that window hung for just as long.
--
-- With the length stored in an index, the check reads only the index plus the
-- handful of rows that really are stale. The queries must keep the exact
-- expression `length(coalesce(trim(full_text), ''))` and the `purged_at IS NULL`
-- term, or the planner can no longer use this index.
CREATE INDEX IF NOT EXISTS idx_articles_stale_body
  ON articles(feed_id, length(coalesce(trim(full_text), '')))
  WHERE purged_at IS NULL;
