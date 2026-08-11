import { getDb, runNamed, getNamed, allNamed } from './connection.js'
import type { Article, ArticleListItem, ArticleDetail } from './types.js'
import type { MeiliArticleDoc } from '../search/client.js'
import { syncArticleToSearch, deleteArticleFromSearch, deleteArticlesFromSearch, syncArticleScoreToSearch, syncArticleFiltersToSearch } from '../search/sync.js'
import { RETRY_MAX_ATTEMPTS, RETRY_BATCH_LIMIT } from '../fetcher/util.js'
import { deleteArticleImages } from '../fetcher/article-images.js'
import { logger } from '../logger.js'

const log = logger.child('retention')

/**
 * Normalize a URL so that raw-Unicode and percent-encoded forms compare equal.
 *
 * Every write path must normalize before storing and every read path must
 * normalize before comparing — `new URL().href` also lowercases the host,
 * appends a root "/" to bare origins and drops default ports, so a stored raw
 * URL and a normalized lookup would otherwise never match.
 * See `backfillNormalizedArticleUrls` for the one-time repair of rows written
 * before this invariant held.
 */
export function normalizeUrl(raw: string): string {
  try { return new URL(raw).href } catch { return raw }
}

function buildMeiliDoc(id: number): MeiliArticleDoc | null {
  const row = getDb().prepare(`
    SELECT id, feed_id, category_id, title,
           COALESCE(full_text, '') AS full_text,
           COALESCE(full_text_translated, '') AS full_text_translated,
           lang,
           COALESCE(CAST(strftime('%s', published_at) AS INTEGER), 0) AS published_at,
           COALESCE(score, 0) AS score,
           (seen_at IS NULL) AS is_unread,
           (liked_at IS NOT NULL) AS is_liked,
           (bookmarked_at IS NOT NULL) AS is_bookmarked
    FROM articles WHERE id = ?
  `).get(id) as MeiliArticleDoc | undefined
  return row ?? null
}

// --- Score computation ---

export const SCORE_DECAY_FACTOR = 0.05
const SEARCH_BOOST_FACTOR = 5.0

/**
 * Build the engagement half of the score expression (the sum of action weights).
 * Exported so measurement code can observe it in isolation without restating the weights.
 */
export function engagementExpr(prefix: string): string {
  const p = prefix
  return `(
    (CASE WHEN ${p}liked_at IS NOT NULL THEN 10 ELSE 0 END)
    + (CASE WHEN ${p}bookmarked_at IS NOT NULL THEN 5 ELSE 0 END)
    + (CASE WHEN ${p}full_text_translated IS NOT NULL THEN 3 ELSE 0 END)
    + (CASE WHEN ${p}read_at IS NOT NULL THEN 2 ELSE 0 END)
  )`
}

/** Days elapsed since the article's last activity — the input to the decay curve. */
export function daysSinceActivityExpr(prefix: string): string {
  const p = prefix
  return `(julianday('now') - julianday(
    COALESCE(${p}read_at, ${p}published_at, ${p}fetched_at)
  ))`
}

/** Build the time-decay half of the score expression. */
export function decayExpr(prefix: string): string {
  return `(1.0 / (1.0 + ${daysSinceActivityExpr(prefix)} * ${SCORE_DECAY_FACTOR}))`
}

/**
 * Build the engagement × decay score SQL expression.
 * @param prefix - table alias (e.g. 'a.') for JOIN queries, or '' for single-table UPDATE
 */
export function scoreExpr(prefix: string, opts?: { searchBoost?: boolean }): string {
  const boost = opts?.searchBoost ? ` * ${SEARCH_BOOST_FACTOR}` : ''
  return `(${engagementExpr(prefix)} * ${decayExpr(prefix)}${boost})`
}

/** WHERE clause for articles that have engagement or a non-zero score. Shared with search sync. */
export const SCORED_ARTICLES_WHERE = `(
  liked_at IS NOT NULL
  OR bookmarked_at IS NOT NULL
  OR read_at IS NOT NULL
  OR full_text_translated IS NOT NULL
  OR score > 0
)`

/** Update score in DB and sync to search. Call within a transaction for atomicity. */
function updateScoreDb(id: number): void {
  getDb().prepare(`UPDATE articles SET score = (${scoreExpr('')}) WHERE id = ?`).run(id)
}

function syncScoreToSearch(id: number): void {
  const row = getDb().prepare('SELECT score FROM articles WHERE id = ?').get(id) as { score: number } | undefined
  if (row) syncArticleScoreToSearch(id, row.score)
}

export function updateScore(id: number): void {
  updateScoreDb(id)
  syncScoreToSearch(id)
}

export function recalculateScores(): { updated: number } {
  const result = getDb().prepare(`
    UPDATE articles SET score = (${scoreExpr('')})
    WHERE id IN (SELECT id FROM active_articles) AND ${SCORED_ARTICLES_WHERE}
  `).run()
  return { updated: result.changes }
}

// --- Article list queries ---

/** Longest window the unread anchor may reach back (see resolveUnreadAnchor). */
const MAX_UNREAD_ANCHOR_HOURS = 24

/**
 * Clamp a client-supplied unread anchor to [now - MAX_UNREAD_ANCHOR_HOURS, now]
 * and normalize it to the `YYYY-MM-DD HH:MM:SS` shape `seen_at` is stored in,
 * so the two can be compared as plain strings.
 *
 * Clamping is done in SQLite rather than JS so the comparison never depends on
 * the browser's clock being in sync with the server's.
 */
function resolveUnreadAnchor(isoTimestamp: string): string | null {
  const row = getNamed<{ anchor: string | null }>(`
    SELECT MAX(
      datetime('now', '-${MAX_UNREAD_ANCHOR_HOURS} hours'),
      MIN(datetime(@since), datetime('now'))
    ) AS anchor
  `, { since: isoTimestamp })
  return row?.anchor ?? null
}

export function getArticles(opts: {
  feedId?: number
  categoryId?: number
  unread?: boolean
  /**
   * ISO timestamp marking when the list view was opened. Articles marked read
   * at or after it stay in the unread result set, keeping OFFSET pagination
   * stable while the reader works through the list — without it, every article
   * marked read shifts the remaining ones forward and the next page skips as
   * many articles as were read. Only meaningful together with `unread`.
   */
  unreadSince?: string
  bookmarked?: boolean
  liked?: boolean
  read?: boolean
  sort?: 'score'
  limit: number
  offset: number
  smartFloor?: boolean
}): { articles: ArticleListItem[]; total: number; totalWithoutFloor?: number } {
  const conditions: string[] = []
  const params: Record<string, unknown> = {}

  if (opts.feedId) {
    conditions.push('a.feed_id = @feedId')
    params.feedId = opts.feedId
  }
  if (opts.categoryId) {
    conditions.push('a.category_id = @categoryId')
    params.categoryId = opts.categoryId
  }
  if (opts.unread) {
    const anchor = opts.unreadSince ? resolveUnreadAnchor(opts.unreadSince) : null
    if (anchor) {
      conditions.push('(a.seen_at IS NULL OR a.seen_at >= @unreadAnchor)')
      params.unreadAnchor = anchor
    } else {
      conditions.push('a.seen_at IS NULL')
    }
  }
  if (opts.bookmarked) {
    conditions.push('a.bookmarked_at IS NOT NULL')
  }
  if (opts.liked) {
    conditions.push('a.liked_at IS NOT NULL')
  }
  if (opts.read) {
    conditions.push('a.read_at IS NOT NULL')
  }

  // Smart floor: limit the displayed range to keep lists manageable.
  // Pick the floor that yields the MOST articles (= earliest date) among:
  //   1. SMART_FLOOR_DAYS ago
  //   2. SMART_FLOOR_MIN_ARTICLES-th newest article's date
  //   3. Oldest unread article's date (if any)
  const SMART_FLOOR_DAYS = 7
  const SMART_FLOOR_MIN_ARTICLES = 20

  let floorApplied = false

  if (opts.smartFloor) {
    const scopeWhere = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : ''

    // Candidate 1: SMART_FLOOR_DAYS ago
    const floorAgo = new Date(Date.now() - SMART_FLOOR_DAYS * 24 * 60 * 60 * 1000).toISOString()

    // Candidate 2: SMART_FLOOR_MIN_ARTICLES-th newest article's date
    const top20Row = getNamed<{ floor: string | null }>(`
      SELECT a.published_at AS floor FROM active_articles a
      ${scopeWhere}
      ORDER BY a.published_at DESC
      LIMIT 1 OFFSET ${SMART_FLOOR_MIN_ARTICLES - 1}
    `, params)

    // Candidate 3: oldest unread article's date
    const unreadRow = getNamed<{ floor: string | null }>(`
      SELECT MIN(a.published_at) AS floor FROM active_articles a
      ${scopeWhere ? scopeWhere + ' AND' : 'WHERE'} a.seen_at IS NULL AND a.published_at IS NOT NULL
    `, params)

    // If fewer than SMART_FLOOR_MIN_ARTICLES exist, skip the floor entirely — show all
    if (!top20Row?.floor) {
      // no-op: don't add a date condition
    } else {
      // Pick the earliest (= shows the most articles)
      const candidates: string[] = [floorAgo, top20Row.floor]
      if (unreadRow?.floor) candidates.push(unreadRow.floor)
      const smartFloorDate = candidates.sort()[0]

      conditions.push('(a.published_at IS NULL OR a.published_at >= @smartFloorDate)')
      params.smartFloorDate = smartFloorDate
      floorApplied = true
    }
  }

  // Count without floor for "show more" UI
  const baseWhere = floorApplied
    ? (() => {
        const baseConditions = conditions.filter(c => !c.includes('@smartFloorDate'))
        return baseConditions.length > 0 ? 'WHERE ' + baseConditions.join(' AND ') : ''
      })()
    : undefined

  const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : ''
  const orderBy = opts.sort === 'score'
    ? 'a.score DESC, a.published_at DESC'
    : opts.liked ? 'a.liked_at DESC' : opts.read ? 'a.read_at DESC' : 'a.published_at DESC'

  const totalRow = getNamed<{ cnt: number }>(`
    SELECT COUNT(*) AS cnt FROM active_articles a ${where}
  `, params)
  const total = totalRow.cnt

  const totalWithoutFloor = baseWhere != null
    ? getNamed<{ cnt: number }>(`SELECT COUNT(*) AS cnt FROM active_articles a ${baseWhere}`, params).cnt
    : undefined

  const articles = allNamed<ArticleListItem>(`
    SELECT a.id, a.feed_id, f.name AS feed_name,
           a.title, a.url, a.published_at, a.lang, a.summary, a.excerpt, a.og_image, a.seen_at, a.read_at, a.bookmarked_at, a.liked_at,
           a.score,
           (SELECT COUNT(*) FROM article_similarities WHERE article_id = a.id) AS similar_count
    FROM active_articles a
    JOIN feeds f ON a.feed_id = f.id
    ${where}
    ORDER BY ${orderBy}
    LIMIT @_limit OFFSET @_offset
  `, { ...params, _limit: Number(opts.limit), _offset: Number(opts.offset) })

  return { articles, total, ...(totalWithoutFloor != null && totalWithoutFloor > total ? { totalWithoutFloor } : {}) }
}

export function getArticleByUrl(url: string): ArticleDetail | undefined {
  const db = getDb()
  const normalized = normalizeUrl(url)
  const stmt = db.prepare(`
    SELECT a.id, a.feed_id, f.name AS feed_name, f.type AS feed_type,
           a.title, a.url, a.published_at, a.lang, a.summary, a.excerpt, a.og_image,
           a.full_text, a.full_text_translated, a.translated_lang, a.seen_at, a.read_at, a.bookmarked_at, a.liked_at,
           a.images_archived_at,
           (SELECT COUNT(*) FROM article_similarities WHERE article_id = a.id) AS similar_count
    FROM active_articles a
    JOIN feeds f ON a.feed_id = f.id
    WHERE a.url = ?
  `)

  const article = stmt.get(normalized) as ArticleDetail | undefined
  if (article) return article

  // Protocol fallback: handle articles stored under one protocol when the
  // request arrives with the other. This covers the transition period where
  // some articles were saved before http:// feed registration was allowed.
  let fallbackUrl: string | null = null
  if (normalized.startsWith('https://')) {
    fallbackUrl = 'http://' + normalized.slice(8)
  } else if (normalized.startsWith('http://')) {
    fallbackUrl = 'https://' + normalized.slice(7)
  }
  if (fallbackUrl) {
    return stmt.get(fallbackUrl) as ArticleDetail | undefined
  }

  return undefined
}

export function getArticleById(id: number): ArticleDetail | undefined {
  return getDb().prepare(`
    SELECT a.id, a.feed_id, f.name AS feed_name, f.type AS feed_type,
           a.title, a.url, a.published_at, a.lang, a.summary, a.excerpt, a.og_image,
           a.full_text, a.full_text_translated, a.translated_lang, a.seen_at, a.read_at, a.bookmarked_at, a.liked_at,
           a.images_archived_at,
           (SELECT COUNT(*) FROM article_similarities WHERE article_id = a.id) AS similar_count
    FROM active_articles a
    JOIN feeds f ON a.feed_id = f.id
    WHERE a.id = ?
  `).get(id) as ArticleDetail | undefined
}

export function markArticleSeen(
  id: number,
  seen: boolean,
): { seen_at: string | null; read_at: string | null } | undefined {
  const row = getDb().transaction(() => {
    if (seen) {
      getDb().prepare("UPDATE articles SET seen_at = datetime('now') WHERE id = ? AND seen_at IS NULL").run(id)
    } else {
      getDb().prepare('UPDATE articles SET seen_at = NULL, read_at = NULL WHERE id = ?').run(id)
      updateScoreDb(id)
    }
    return getDb().prepare('SELECT seen_at, read_at FROM articles WHERE id = ?').get(id) as { seen_at: string | null; read_at: string | null } | undefined
  })()
  if (!seen) syncScoreToSearch(id)
  syncArticleFiltersToSearch([{ id, is_unread: !seen }])
  if (!row) return undefined
  return { seen_at: row.seen_at, read_at: row.read_at }
}

export function markArticlesSeen(ids: number[]): { updated: number } {
  if (ids.length === 0) return { updated: 0 }
  const placeholders = ids.map(() => '?').join(',')
  const result = getDb().prepare(
    `UPDATE articles SET seen_at = datetime('now') WHERE id IN (${placeholders}) AND seen_at IS NULL`,
  ).run(...ids)
  if (result.changes > 0) {
    syncArticleFiltersToSearch(ids.map(id => ({ id, is_unread: false })))
  }
  return { updated: result.changes }
}

/**
 * Mark unread articles in a feed as seen.
 *
 * When `olderThanHours` is given, only articles published at least that many
 * hours ago are affected; articles with no `published_at` are never matched
 * by an age filter since their age is unknown. Omitting it preserves the
 * original "mark everything unread" behavior.
 */
export function markAllSeenByFeed(feedId: number, olderThanHours?: number): { updated: number } {
  const cutoffClause = olderThanHours !== undefined
    ? `AND published_at IS NOT NULL AND published_at <= datetime('now', ?)`
    : ''
  const cutoffParams = olderThanHours !== undefined ? [`-${olderThanHours} hours`] : []

  // Collect affected IDs before update for search sync
  const affectedIds = (getDb().prepare(
    `SELECT id FROM active_articles WHERE feed_id = ? AND seen_at IS NULL ${cutoffClause}`,
  ).all(feedId, ...cutoffParams) as { id: number }[]).map(r => r.id)
  const result = getDb().prepare(
    `UPDATE articles SET seen_at = datetime('now') WHERE feed_id = ? AND seen_at IS NULL AND purged_at IS NULL ${cutoffClause}`,
  ).run(feedId, ...cutoffParams)
  if (affectedIds.length > 0) {
    syncArticleFiltersToSearch(affectedIds.map(id => ({ id, is_unread: false })))
  }
  return { updated: result.changes }
}

export function markArticleLiked(
  id: number,
  liked: boolean,
): { liked_at: string | null } | undefined {
  const row = getDb().transaction(() => {
    if (liked) {
      getDb().prepare("UPDATE articles SET liked_at = datetime('now') WHERE id = ? AND liked_at IS NULL").run(id)
    } else {
      getDb().prepare('UPDATE articles SET liked_at = NULL WHERE id = ?').run(id)
    }
    updateScoreDb(id)
    return getDb().prepare('SELECT liked_at FROM articles WHERE id = ?').get(id) as { liked_at: string | null } | undefined
  })()
  syncScoreToSearch(id)
  syncArticleFiltersToSearch([{ id, is_liked: liked }])
  if (!row) return undefined
  return { liked_at: row.liked_at }
}

export function getLikeCount(): number {
  const row = getDb().prepare('SELECT COUNT(*) AS cnt FROM active_articles WHERE liked_at IS NOT NULL').get() as { cnt: number }
  return row.cnt
}

export function markArticleBookmarked(
  id: number,
  bookmarked: boolean,
): { bookmarked_at: string | null } | undefined {
  const row = getDb().transaction(() => {
    if (bookmarked) {
      getDb().prepare("UPDATE articles SET bookmarked_at = datetime('now') WHERE id = ? AND bookmarked_at IS NULL").run(id)
    } else {
      getDb().prepare('UPDATE articles SET bookmarked_at = NULL WHERE id = ?').run(id)
    }
    updateScoreDb(id)
    return getDb().prepare('SELECT bookmarked_at FROM articles WHERE id = ?').get(id) as { bookmarked_at: string | null } | undefined
  })()
  syncScoreToSearch(id)
  syncArticleFiltersToSearch([{ id, is_bookmarked: bookmarked }])
  if (!row) return undefined
  return { bookmarked_at: row.bookmarked_at }
}

export function getBookmarkCount(): number {
  const row = getDb().prepare('SELECT COUNT(*) AS cnt FROM active_articles WHERE bookmarked_at IS NOT NULL').get() as { cnt: number }
  return row.cnt
}

export function recordArticleRead(
  id: number,
): { seen_at: string | null; read_at: string | null } | undefined {
  const row = getDb().transaction(() => {
    getDb().prepare(
      "UPDATE articles SET read_at = datetime('now'), seen_at = COALESCE(seen_at, datetime('now')) WHERE id = ?",
    ).run(id)
    updateScoreDb(id)
    return getDb().prepare('SELECT seen_at, read_at FROM articles WHERE id = ?').get(id) as { seen_at: string | null; read_at: string | null } | undefined
  })()
  syncScoreToSearch(id)
  syncArticleFiltersToSearch([{ id, is_unread: false }])
  return row ? { seen_at: row.seen_at, read_at: row.read_at } : undefined
}

export function insertArticle(data: {
  feed_id: number
  title: string
  url: string
  published_at: string | null
  lang?: string | null
  full_text?: string | null
  full_text_translated?: string | null
  translated_lang?: string | null
  summary?: string | null
  excerpt?: string | null
  og_image?: string | null
  last_error?: string | null
}): number {
  const info = runNamed(`
    INSERT INTO articles (feed_id, category_id, title, url, published_at, lang, full_text, full_text_translated, translated_lang, summary, excerpt, og_image, last_error)
    VALUES (@feed_id, (SELECT category_id FROM feeds WHERE id = @feed_id), @title, @url, @published_at, @lang, @full_text, @full_text_translated, @translated_lang, @summary, @excerpt, @og_image, @last_error)
  `, {
    feed_id: data.feed_id,
    title: data.title,
    // Normalized on write so `getArticleByUrl` / `getExistingArticleUrls`,
    // which both normalize before comparing, can find the row again.
    url: normalizeUrl(data.url),
    published_at: data.published_at,
    lang: data.lang ?? null,
    full_text: data.full_text ?? null,
    full_text_translated: data.full_text_translated ?? null,
    translated_lang: data.translated_lang ?? null,
    summary: data.summary ?? null,
    excerpt: data.excerpt ?? null,
    og_image: data.og_image ?? null,
    last_error: data.last_error ?? null,
  })
  const articleId = info.lastInsertRowid as number
  const doc = buildMeiliDoc(articleId)
  if (doc) syncArticleToSearch(doc)
  return articleId
}

/**
 * Mark the refresh attempt timestamp without touching content or triggering
 * a Meilisearch resync. Used by the fetcher to record "we tried to repair
 * this stale article but couldn't improve it" so the backoff window kicks
 * in and we don't keep bypassing the RSS HTTP cache forever.
 */
export function markArticleRefreshAttempted(articleId: number, when: string): void {
  runNamed('UPDATE articles SET last_refresh_attempt_at = @when WHERE id = @id', { id: articleId, when })
}

export function updateArticleContent(
  articleId: number,
  data: {
    lang?: string | null
    full_text?: string | null
    full_text_translated?: string | null
    translated_lang?: string | null
    summary?: string | null
    excerpt?: string | null
    og_image?: string | null
    last_error?: string | null
    retry_count?: number
    last_retry_at?: string | null
    last_refresh_attempt_at?: string | null
  },
): void {
  const fields: string[] = []
  const params: Record<string, unknown> = { id: articleId }

  for (const [key, val] of Object.entries(data)) {
    if (val !== undefined) {
      fields.push(`${key} = @${key}`)
      params[key] = val
    }
  }
  if (fields.length === 0) return
  runNamed(`UPDATE articles SET ${fields.join(', ')} WHERE id = @id`, params)
  const doc = buildMeiliDoc(articleId)
  if (doc) syncArticleToSearch(doc)
}

/**
 * Return id + full_text for active articles in the given feed that have a
 * stored body. Used when a feed switches to skip_full_text_fetch so the
 * caller can identify bodies that are actually bot-block pages and drop them.
 */
export function getArticleBodiesByFeed(feedId: number): { id: number; full_text: string }[] {
  return getDb().prepare(`
    SELECT id, full_text
    FROM active_articles
    WHERE feed_id = ? AND full_text IS NOT NULL AND trim(full_text) != ''
  `).all(feedId) as { id: number; full_text: string }[]
}

/**
 * One-day backoff window between refresh attempts. After we try to repair
 * a stale article and fail (e.g. RSS has no description, the body is
 * legitimately short, or the item dropped out of the current feed), the
 * article is excluded from refresh queries for this long so we don't
 * bypass the RSS HTTP cache on every fetch tick forever.
 */
const REFRESH_ATTEMPT_BACKOFF = "datetime('now', '-1 day')"

/**
 * Return id + url + full_text for active articles in the given feed whose
 * stored full_text trimmed length is below the threshold and that have not
 * been attempted within the backoff window. Used by the fetcher to detect
 * previously-saved articles where extraction returned only a page title
 * (e.g. thin SPA sites) so the RSS excerpt fallback can be retried.
 *
 * Driven by feed_id, not by the current RSS URL list, so articles that
 * have rolled off the live feed still get their backoff timestamp updated
 * — otherwise their stale rows would keep skipCache enabled forever.
 */
export function getArticlesNeedingRefresh(
  feedId: number,
  minLength: number,
): { id: number; url: string; full_text: string | null }[] {
  return getDb().prepare(`
    SELECT id, url, full_text
    FROM articles
    WHERE feed_id = ?
      AND purged_at IS NULL
      AND length(coalesce(trim(full_text), '')) < ?
      AND (last_refresh_attempt_at IS NULL OR datetime(last_refresh_attempt_at) < ${REFRESH_ATTEMPT_BACKOFF})
  `).all(feedId, minLength) as { id: number; url: string; full_text: string | null }[]
}

/**
 * Count active articles for the given feed that are still eligible for a
 * refresh attempt. The fetcher uses a positive count as the signal to
 * bypass the RSS HTTP cache for that feed so the refresh path can run
 * even when the feed XML hasn't changed. Articles inside their backoff
 * window are excluded so unfixable stale rows don't keep the cache
 * disabled forever.
 */
export function countStaleArticlesByFeed(feedId: number, minLength: number): number {
  const row = getDb().prepare(`
    SELECT COUNT(*) AS n
    FROM articles
    WHERE feed_id = ?
      AND purged_at IS NULL
      AND length(coalesce(trim(full_text), '')) < ?
      AND (last_refresh_attempt_at IS NULL OR datetime(last_refresh_attempt_at) < ${REFRESH_ATTEMPT_BACKOFF})
  `).get(feedId, minLength) as { n: number }
  return row.n
}

/**
 * Given a list of candidate URLs, return the subset that already exists.
 *
 * The returned set is keyed by the *caller's* URL strings, not by their
 * normalized forms, so `existing.has(item.url)` works directly on raw feed
 * input. Returning normalized keys instead would silently never match a caller
 * that filters on the original string.
 */
export function getExistingArticleUrls(urls: string[]): Set<string> {
  if (urls.length === 0) return new Set()
  const normalized = urls.map(normalizeUrl)

  // Query both protocol variants so a feed item that arrives as https://
  // is treated as duplicate when we already stored it as http://, and
  // vice versa. This is an intentional design trade-off: sites that serve
  // genuinely different content at http:// vs https:// (extremely rare for
  // RSS feeds) would lose the http version. The alternative — strict
  // per-protocol dedup — causes duplicate articles when the same blog is
  // referenced under both protocols in different feeds.
  const expanded = new Set<string>()
  for (const u of normalized) {
    expanded.add(u)
    if (u.startsWith('https://')) {
      expanded.add('http://' + u.slice(8))
    } else if (u.startsWith('http://')) {
      expanded.add('https://' + u.slice(7))
    }
  }
  const expandedList = [...expanded]
  const placeholders = expandedList.map(() => '?').join(',')
  const rows = getDb().prepare(
    `SELECT url FROM articles WHERE url IN (${placeholders})`,
  ).all(...expandedList) as { url: string }[]

  const dbUrls = new Set(rows.map(r => r.url))
  const existing = new Set<string>()
  urls.forEach((original, i) => {
    const u = normalized[i]
    const found = dbUrls.has(u)
      || (u.startsWith('https://') && dbUrls.has('http://' + u.slice(8)))
      || (u.startsWith('http://') && dbUrls.has('https://' + u.slice(7)))
    // Key by the caller's original string — see the doc comment above.
    if (found) existing.add(original)
  })
  return existing
}

/**
 * One-time repair for articles stored before `insertArticle` normalized URLs.
 *
 * Rows whose stored URL differs from its normalized form are invisible to
 * `getArticleByUrl` and `getExistingArticleUrls`, which means the detail page
 * 404s and the fetcher re-downloads the article on every tick (the insert then
 * fails on the UNIQUE constraint and is swallowed). Rewriting them to the
 * normalized form can collide with an existing row, in which case the lower id
 * wins and the duplicate is deleted.
 */
export function backfillNormalizedArticleUrls(): { updated: number; deduped: number } {
  const rows = getDb().prepare('SELECT id, url FROM articles ORDER BY id').all() as { id: number; url: string }[]

  const canonical = new Map<string, number>()
  const toUpdate: { id: number; url: string }[] = []
  const toDelete: number[] = []

  for (const row of rows) {
    const normalized = normalizeUrl(row.url)
    const claimedBy = canonical.get(normalized)
    if (claimedBy !== undefined) {
      // A lower-id row already owns this normalized URL — drop the duplicate.
      toDelete.push(row.id)
      continue
    }
    canonical.set(normalized, row.id)
    if (normalized !== row.url) toUpdate.push({ id: row.id, url: normalized })
  }

  if (toUpdate.length === 0 && toDelete.length === 0) return { updated: 0, deduped: 0 }

  getDb().transaction(() => {
    const del = getDb().prepare('DELETE FROM articles WHERE id = ?')
    for (const id of toDelete) del.run(id)
    const update = getDb().prepare('UPDATE articles SET url = ? WHERE id = ?')
    for (const row of toUpdate) update.run(row.url, row.id)
  })()

  // Duplicates are gone from SQLite but still indexed; drop them from search too.
  if (toDelete.length > 0) deleteArticlesFromSearch(toDelete)

  log.info(`URL normalization backfill: ${toUpdate.length} updated, ${toDelete.length} duplicates removed`)
  return { updated: toUpdate.length, deduped: toDelete.length }
}

// Backoff deadline: datetime when the article becomes eligible for retry again.
// 30 * 2^retry_count minutes, clamped to 32 hours via MIN(retry_count, 6).
// Takes a table alias prefix so it can be used in joined queries.
const backoffDeadline = (p = '') =>
  `datetime(${p}last_retry_at, '+' || (30 * (1 << MIN(${p}retry_count, 6))) || ' minutes')`

export function getRetryArticles(
  maxAttempts = RETRY_MAX_ATTEMPTS,
  batchLimit = RETRY_BATCH_LIMIT,
): Article[] {
  // Feeds opted out of full-text fetching are excluded: retrying them would
  // re-issue the very request the user disabled, and their bodies come from
  // the RSS payload instead.
  return getDb().prepare(`
    SELECT a.* FROM active_articles a
    JOIN feeds f ON f.id = a.feed_id
    WHERE a.last_error IS NOT NULL
      AND a.full_text IS NULL
      AND f.skip_full_text_fetch = 0
      AND a.retry_count < :max_attempts
      AND (
        a.last_retry_at IS NULL
        OR ${backoffDeadline('a.')} <= datetime('now')
      )
    ORDER BY a.retry_count ASC, a.last_retry_at ASC
    LIMIT :batch_limit
  `).all({ max_attempts: maxAttempts, batch_limit: batchLimit }) as Article[]
}

export interface RetryStats {
  eligible: number
  backoff_waiting: number
  exceeded: number
}

export function getRetryStats(maxAttempts = RETRY_MAX_ATTEMPTS): RetryStats {
  const row = getDb().prepare(`
    SELECT
      SUM(CASE WHEN a.retry_count < :max_attempts AND (
        a.last_retry_at IS NULL
        OR ${backoffDeadline('a.')} <= datetime('now')
      ) THEN 1 ELSE 0 END) AS eligible,
      SUM(CASE WHEN a.retry_count < :max_attempts AND
        a.last_retry_at IS NOT NULL AND
        ${backoffDeadline('a.')} > datetime('now')
      THEN 1 ELSE 0 END) AS backoff_waiting,
      SUM(CASE WHEN a.retry_count >= :max_attempts THEN 1 ELSE 0 END) AS exceeded
    FROM active_articles a
    JOIN feeds f ON f.id = a.feed_id
    WHERE a.last_error IS NOT NULL AND a.full_text IS NULL
      AND f.skip_full_text_fetch = 0
  `).get({ max_attempts: maxAttempts }) as { eligible: number | null; backoff_waiting: number | null; exceeded: number | null }
  return {
    eligible: row.eligible ?? 0,
    backoff_waiting: row.backoff_waiting ?? 0,
    exceeded: row.exceeded ?? 0,
  }
}

// --- Search by IDs (Meilisearch integration) ---

export function getArticlesByIds(
  ids: number[],
  opts?: { unread?: boolean; liked?: boolean; bookmarked?: boolean },
): ArticleListItem[] {
  if (ids.length === 0) return []
  const placeholders = ids.map(() => '?').join(',')
  const orderCase = ids.map((id, i) => `WHEN ${id} THEN ${i}`).join(' ')

  const conditions: string[] = [`a.id IN (${placeholders})`]
  if (opts?.unread !== undefined) {
    conditions.push(opts.unread ? 'a.seen_at IS NULL' : 'a.seen_at IS NOT NULL')
  }
  if (opts?.liked) conditions.push('a.liked_at IS NOT NULL')
  if (opts?.bookmarked) conditions.push('a.bookmarked_at IS NOT NULL')

  const where = 'WHERE ' + conditions.join(' AND ')
  const score = scoreExpr('a.')

  return getDb().prepare(`
    SELECT a.id, a.feed_id, f.name AS feed_name,
           a.title, a.url, a.published_at, a.lang, a.summary, a.excerpt,
           a.og_image, a.seen_at, a.read_at, a.bookmarked_at, a.liked_at,
           ${score} AS score
    FROM active_articles a
    JOIN feeds f ON a.feed_id = f.id
    ${where}
    ORDER BY CASE a.id ${orderCase} END
  `).all(...ids) as ArticleListItem[]
}

// --- Search queries ---

export function searchArticles(opts: {
  query?: string
  feed_id?: number
  category_id?: number
  unread?: boolean
  bookmarked?: boolean
  liked?: boolean
  since?: string
  until?: string
  limit?: number
  sort?: 'published_at' | 'score'
}): ArticleListItem[] {
  const conditions: string[] = []
  const params: Record<string, unknown> = {}

  if (opts.feed_id) {
    conditions.push('a.feed_id = @feed_id')
    params.feed_id = opts.feed_id
  }
  if (opts.category_id) {
    conditions.push('a.category_id = @category_id')
    params.category_id = opts.category_id
  }
  if (opts.unread !== undefined) {
    conditions.push(opts.unread ? 'a.seen_at IS NULL' : 'a.seen_at IS NOT NULL')
  }
  if (opts.bookmarked) {
    conditions.push('a.bookmarked_at IS NOT NULL')
  }
  if (opts.liked) {
    conditions.push('a.liked_at IS NOT NULL')
  }
  if (opts.since) {
    conditions.push('a.published_at >= @since')
    params.since = opts.since
  }
  if (opts.until) {
    conditions.push('a.published_at <= @until')
    params.until = opts.until
  }

  const hasQuery = !!opts.query

  if (hasQuery) {
    const likePattern = `%${opts.query}%`
    conditions.push('(a.title LIKE @likeQuery OR a.full_text LIKE @likeQuery OR a.full_text_translated LIKE @likeQuery)')
    params.likeQuery = likePattern
  }

  const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : ''
  const limit = opts.limit ?? 20
  const score = scoreExpr('a.', { searchBoost: hasQuery })

  let orderBy: string
  if (opts.sort === 'score') {
    orderBy = `${score} DESC, a.published_at DESC`
  } else if (opts.sort === 'published_at') {
    orderBy = 'a.published_at DESC'
  } else {
    orderBy = hasQuery ? `${score} DESC` : 'a.published_at DESC'
  }

  return allNamed<ArticleListItem>(`
    SELECT a.id, a.feed_id, f.name AS feed_name,
           a.title, a.url, a.published_at, a.lang, a.summary, a.excerpt, a.og_image, a.seen_at, a.read_at, a.bookmarked_at, a.liked_at,
           ${score} AS score
    FROM active_articles a
    JOIN feeds f ON a.feed_id = f.id
    ${where}
    ORDER BY ${orderBy}
    LIMIT ${Number(limit)}
  `, params)
}

export function markImagesArchived(articleId: number): void {
  getDb().prepare("UPDATE articles SET images_archived_at = datetime('now') WHERE id = ?").run(articleId)
}

export function clearImagesArchived(articleId: number): void {
  getDb().prepare('UPDATE articles SET images_archived_at = NULL WHERE id = ?').run(articleId)
}

export function deleteArticle(id: number): boolean {
  const result = getDb().prepare('DELETE FROM articles WHERE id = ?').run(id)
  if (result.changes > 0) deleteArticleFromSearch(id)
  return result.changes > 0
}

export function getReadingStats(opts?: {
  since?: string
  until?: string
}): { total: number; read: number; unread: number; by_feed: { feed_id: number; feed_name: string; total: number; read: number; unread: number }[] } {
  const conditions: string[] = []
  const params: Record<string, unknown> = {}

  if (opts?.since) {
    conditions.push('a.published_at >= @since')
    params.since = opts.since
  }
  if (opts?.until) {
    conditions.push('a.published_at <= @until')
    params.until = opts.until
  }

  const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : ''

  const totals = getNamed<{ total: number; read: number; unread: number }>(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN a.seen_at IS NOT NULL THEN 1 ELSE 0 END) AS read,
      SUM(CASE WHEN a.seen_at IS NULL THEN 1 ELSE 0 END) AS unread
    FROM active_articles a
    ${where}
  `, params)

  const byFeed = allNamed<{ feed_id: number; feed_name: string; total: number; read: number; unread: number }>(`
    SELECT
      a.feed_id,
      f.name AS feed_name,
      COUNT(*) AS total,
      SUM(CASE WHEN a.seen_at IS NOT NULL THEN 1 ELSE 0 END) AS read,
      SUM(CASE WHEN a.seen_at IS NULL THEN 1 ELSE 0 END) AS unread
    FROM active_articles a
    JOIN feeds f ON a.feed_id = f.id
    ${where}
    GROUP BY a.feed_id
    ORDER BY total DESC
  `, params)

  return { ...totals, by_feed: byFeed }
}

// --- Retention policy ---

export function getRetentionStats(readDays: number, unreadDays: number): { readEligible: number; unreadEligible: number } {
  const readRow = getDb().prepare(`
    SELECT COUNT(*) AS cnt FROM articles
    WHERE purged_at IS NULL
      AND feed_id NOT IN (SELECT id FROM feeds WHERE type = 'clip')
      AND seen_at IS NOT NULL
      AND seen_at < datetime('now', '-' || ? || ' days')
      AND bookmarked_at IS NULL
      AND liked_at IS NULL
  `).get(readDays) as { cnt: number }

  const unreadRow = getDb().prepare(`
    SELECT COUNT(*) AS cnt FROM articles
    WHERE purged_at IS NULL
      AND feed_id NOT IN (SELECT id FROM feeds WHERE type = 'clip')
      AND seen_at IS NULL
      AND fetched_at < datetime('now', '-' || ? || ' days')
      AND bookmarked_at IS NULL
      AND liked_at IS NULL
  `).get(unreadDays) as { cnt: number }

  return { readEligible: readRow.cnt, unreadEligible: unreadRow.cnt }
}

export function purgeExpiredArticles(readDays: number, unreadDays: number): { purged: number } {
  const db = getDb()

  // Collect IDs to purge — use seen_at for read status (consistent with UI unread indicator)
  const readIds = db.prepare(`
    SELECT id FROM articles
    WHERE purged_at IS NULL
      AND feed_id NOT IN (SELECT id FROM feeds WHERE type = 'clip')
      AND seen_at IS NOT NULL
      AND seen_at < datetime('now', '-' || ? || ' days')
      AND bookmarked_at IS NULL
      AND liked_at IS NULL
  `).all(readDays) as { id: number }[]

  const unreadIds = db.prepare(`
    SELECT id FROM articles
    WHERE purged_at IS NULL
      AND feed_id NOT IN (SELECT id FROM feeds WHERE type = 'clip')
      AND seen_at IS NULL
      AND fetched_at < datetime('now', '-' || ? || ' days')
      AND bookmarked_at IS NULL
      AND liked_at IS NULL
  `).all(unreadDays) as { id: number }[]

  const allIds = [...readIds, ...unreadIds].map(r => r.id)
  if (allIds.length === 0) return { purged: 0 }

  // Process in batches to avoid overly large SQL
  const BATCH = 500
  let purged = 0

  for (let i = 0; i < allIds.length; i += BATCH) {
    const batch = allIds.slice(i, i + BATCH)
    const placeholders = batch.map(() => '?').join(',')

    // Clean up archived images before the transaction (external I/O)
    const articlesWithImages = db.prepare(
      `SELECT id FROM articles WHERE id IN (${placeholders}) AND images_archived_at IS NOT NULL`,
    ).all(...batch) as { id: number }[]

    for (const { id } of articlesWithImages) {
      try {
        deleteArticleImages(id)
      } catch (err) {
        log.warn(`Failed to delete images for article ${id}:`, err)
      }
    }

    // Soft delete + search index removal in a transaction to keep them consistent
    const result = db.transaction(() => {
      const res = db.prepare(`
        UPDATE articles
        SET full_text = NULL,
            full_text_translated = NULL,
            excerpt = NULL,
            summary = NULL,
            og_image = NULL,
            images_archived_at = NULL,
            last_error = NULL,
            retry_count = 0,
            purged_at = datetime('now')
        WHERE id IN (${placeholders})
      `).run(...batch)

      deleteArticlesFromSearch(batch)

      return res
    })()

    purged += result.changes
  }

  return { purged }
}
