-- Covering indexes for the article list behind GET /api/articles.
--
-- Same problem 0014 fixed for /api/feeds: the list filters and sorts on
-- seen_at / published_at / read_at / liked_at / score / purged_at, which sit
-- after full_text / full_text_translated / summary in the row. Without an index
-- that holds all of them, `getArticles()` reads every active article's overflow
-- pages just to decide which 20 to return — effectively a scan of the whole
-- table (~330 MB with ~30k articles). That cost 5-10 s on the first list load
-- against a cold page cache (~150-200 ms warm), blocking the event loop the
-- whole time because libsql is synchronous.
--
-- `getArticles()` now picks the page's ids in a subquery that only references
-- indexed columns and fetches the full rows for those ids alone. These indexes
-- make that subquery (and the COUNT(*) queries next to it) a COVERING INDEX
-- scan for every list view: all / unread / category / feed / bookmarks / likes
-- / history / score sort.
--
-- The category index replaces idx_articles_category_published. Without
-- ANALYZE stats the planner prefers it for category views (equality on
-- category_id plus ORDER BY published_at), so it has to be covering itself.
CREATE INDEX IF NOT EXISTS idx_articles_active_list
  ON articles(purged_at, published_at, seen_at, read_at, bookmarked_at, liked_at, score, feed_id, category_id);

DROP INDEX IF EXISTS idx_articles_category_published;
CREATE INDEX IF NOT EXISTS idx_articles_category_list
  ON articles(category_id, published_at DESC, purged_at, seen_at, read_at, bookmarked_at, liked_at, score, feed_id);
