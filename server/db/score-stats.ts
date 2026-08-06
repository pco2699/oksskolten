import { getDb } from './connection.js'
import {
  SCORED_ARTICLES_WHERE,
  SCORE_DECAY_FACTOR,
  engagementExpr,
  daysSinceActivityExpr,
  decayExpr,
  scoreExpr,
} from './articles.js'

/**
 * Read-only measurement of the engagement score as it is actually distributed
 * in a live database.
 *
 * Nothing here writes, and nothing here changes how scores are produced. The
 * point is to capture the shape of the current score *before* any behavioural
 * change, so a later change has something to be compared against. Recommendation
 * quality has no ground truth, so the pre-change distribution is the only
 * reference point available.
 *
 * Every metric below exists to answer one of three questions:
 *   1. How much of the corpus does the score fail to rank at all (score = 0)?
 *   2. How much spread does the decay curve actually produce among the rest?
 *   3. How stale is the stored `score` column relative to a fresh computation?
 */

/** Percentiles reported for every distribution. */
const PERCENTILES = [10, 25, 50, 75, 90, 99] as const

/** Upper bounds of the fixed score histogram buckets. The last bucket is open-ended. */
const SCORE_BUCKET_BOUNDS = [0.5, 1, 2, 4, 8, 16] as const

/** Trailing windows measured as stand-ins for a future recommendation candidate set. */
const CANDIDATE_WINDOW_HOURS = [24, 168, 720] as const

/** A stored score is counted as drifted once it is off by more than this fraction. */
const DRIFT_TOLERANCE = 0.01

export interface Distribution {
  count: number
  min: number | null
  max: number | null
  mean: number | null
  p10: number | null
  p25: number | null
  p50: number | null
  p75: number | null
  p90: number | null
  p99: number | null
}

export interface CorpusCounts {
  total: number
  unread: number
  unseen: number
  liked: number
  bookmarked: number
  translated: number
  /** Articles with at least one engagement signal — the only ones the score can rank. */
  engaged: number
}

export interface ScoreBucket {
  /** Inclusive lower bound. `0` is reported as its own exact-match bucket. */
  from: number
  /** Exclusive upper bound, or `null` for the open-ended top bucket. */
  to: number | null
  articles: number
  share: number
}

export interface ScoreShape {
  zero: number
  zero_share: number
  nonzero: number
  /** Unengaged articles (engagement = 0) that carry a non-zero stored score. */
  unengaged_nonzero: number
  distinct_values: number
  buckets: ScoreBucket[]
  /** Distribution over non-zero scores only — zeros would swamp the percentiles. */
  nonzero_distribution: Distribution
}

export interface EngagementBucket {
  /** Raw engagement value, before decay. */
  engagement: number
  articles: number
  share: number
}

export interface CandidateWindow {
  /** Trailing window measured, in hours. */
  hours: number
  articles: number
  unread: number
  /** Articles in the window whose score is 0 — indistinguishable by rank. */
  zero_score: number
  zero_score_share: number
  /** Number of distinct score values in the window, including the zero bucket. */
  distinct_scores: number
}

export interface DriftStats {
  /** Articles compared (the same set `recalculateScores()` touches). */
  articles: number
  mean_abs: number
  max_abs: number
  /** Articles whose stored score is off by more than DRIFT_TOLERANCE, relatively. */
  over_tolerance: number
}

export interface ScoreBaseline {
  generated_at: string
  decay_factor: number
  corpus: CorpusCounts
  score: ScoreShape
  engagement: EngagementBucket[]
  days_since_activity: Distribution
  decay: Distribution
  candidate_windows: CandidateWindow[]
  drift: DriftStats
}

const ENGAGEMENT = engagementExpr('')
const STORED_SCORE = 'COALESCE(score, 0)'

function share(part: number, whole: number): number {
  return whole === 0 ? 0 : part / whole
}

/**
 * Single-pass count/min/max/mean/percentiles for an expression over `active_articles`.
 *
 * Percentiles use nearest-rank (index = floor((n - 1) * p) + 1) rather than
 * interpolation: the report is read as "the article at this rank scores X",
 * and an interpolated value would name a score no article actually has.
 */
function distribution(valueExpr: string, where: string): Distribution {
  const rank = (p: number) => `CAST((n - 1) * ${p / 100} AS INTEGER) + 1`
  const picks = PERCENTILES.map(p => `MAX(CASE WHEN rn = ${rank(p)} THEN v END) AS p${p}`).join(',\n      ')
  const row = getDb().prepare(`
    WITH vals AS (
      SELECT ${valueExpr} AS v FROM active_articles WHERE ${where}
    ), ranked AS (
      SELECT v, ROW_NUMBER() OVER (ORDER BY v) AS rn, COUNT(*) OVER () AS n FROM vals
    )
    SELECT
      (SELECT COUNT(*) FROM vals) AS count,
      (SELECT MIN(v) FROM vals) AS min,
      (SELECT MAX(v) FROM vals) AS max,
      (SELECT AVG(v) FROM vals) AS mean,
      ${picks}
    FROM ranked
  `).get() as Distribution
  return row
}

function collectCorpus(): CorpusCounts {
  return getDb().prepare(`
    SELECT
      COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN read_at IS NULL THEN 1 ELSE 0 END), 0) AS unread,
      COALESCE(SUM(CASE WHEN seen_at IS NULL THEN 1 ELSE 0 END), 0) AS unseen,
      COALESCE(SUM(CASE WHEN liked_at IS NOT NULL THEN 1 ELSE 0 END), 0) AS liked,
      COALESCE(SUM(CASE WHEN bookmarked_at IS NOT NULL THEN 1 ELSE 0 END), 0) AS bookmarked,
      COALESCE(SUM(CASE WHEN full_text_translated IS NOT NULL THEN 1 ELSE 0 END), 0) AS translated,
      COALESCE(SUM(CASE WHEN ${ENGAGEMENT} > 0 THEN 1 ELSE 0 END), 0) AS engaged
    FROM active_articles
  `).get() as CorpusCounts
}

/** CASE arms mapping a score to a fixed histogram bucket index (0 = exactly zero). */
function scoreBucketIndexExpr(): string {
  const arms = SCORE_BUCKET_BOUNDS.map(
    (bound, i) => `WHEN ${STORED_SCORE} < ${bound} THEN ${i + 1}`,
  ).join(' ')
  return `CASE WHEN ${STORED_SCORE} <= 0 THEN 0 ${arms} ELSE ${SCORE_BUCKET_BOUNDS.length + 1} END`
}

function collectScoreShape(total: number): ScoreShape {
  const counts = getDb().prepare(`
    SELECT
      SUM(CASE WHEN ${STORED_SCORE} <= 0 THEN 1 ELSE 0 END) AS zero,
      SUM(CASE WHEN ${STORED_SCORE} > 0 THEN 1 ELSE 0 END) AS nonzero,
      SUM(CASE WHEN ${ENGAGEMENT} = 0 AND ${STORED_SCORE} > 0 THEN 1 ELSE 0 END) AS unengaged_nonzero,
      COUNT(DISTINCT ${STORED_SCORE}) AS distinct_values
    FROM active_articles
  `).get() as { zero: number; nonzero: number; unengaged_nonzero: number; distinct_values: number }

  const rows = getDb().prepare(`
    SELECT ${scoreBucketIndexExpr()} AS bucket, COUNT(*) AS articles
    FROM active_articles
    GROUP BY bucket
  `).all() as { bucket: number; articles: number }[]
  const byIndex = new Map(rows.map(r => [r.bucket, r.articles]))

  const bounds: (number | null)[] = [0, ...SCORE_BUCKET_BOUNDS, null]
  const buckets: ScoreBucket[] = bounds.map((to, i) => {
    const articles = byIndex.get(i) ?? 0
    return {
      from: i === 0 ? 0 : (bounds[i - 1] as number),
      to: i === 0 ? 0 : to,
      articles,
      share: share(articles, total),
    }
  })

  return {
    zero: counts.zero ?? 0,
    zero_share: share(counts.zero ?? 0, total),
    nonzero: counts.nonzero ?? 0,
    unengaged_nonzero: counts.unengaged_nonzero ?? 0,
    distinct_values: counts.distinct_values ?? 0,
    buckets,
    nonzero_distribution: distribution(STORED_SCORE, `${STORED_SCORE} > 0`),
  }
}

function collectEngagement(total: number): EngagementBucket[] {
  const rows = getDb().prepare(`
    SELECT ${ENGAGEMENT} AS engagement, COUNT(*) AS articles
    FROM active_articles
    GROUP BY engagement
    ORDER BY engagement
  `).all() as { engagement: number; articles: number }[]
  return rows.map(r => ({ ...r, share: share(r.articles, total) }))
}

function collectCandidateWindows(): CandidateWindow[] {
  const stmt = getDb().prepare(`
    SELECT
      COUNT(*) AS articles,
      SUM(CASE WHEN read_at IS NULL THEN 1 ELSE 0 END) AS unread,
      SUM(CASE WHEN ${STORED_SCORE} <= 0 THEN 1 ELSE 0 END) AS zero_score,
      COUNT(DISTINCT ${STORED_SCORE}) AS distinct_scores
    FROM active_articles
    WHERE COALESCE(published_at, fetched_at) >= datetime('now', ?)
  `)
  return CANDIDATE_WINDOW_HOURS.map(hours => {
    const row = stmt.get(`-${hours} hours`) as Omit<CandidateWindow, 'hours' | 'zero_score_share'>
    return {
      hours,
      articles: row.articles,
      unread: row.unread ?? 0,
      zero_score: row.zero_score ?? 0,
      zero_score_share: share(row.zero_score ?? 0, row.articles),
      distinct_scores: row.distinct_scores ?? 0,
    }
  })
}

function collectDrift(): DriftStats {
  const fresh = scoreExpr('')
  const row = getDb().prepare(`
    SELECT
      COUNT(*) AS articles,
      AVG(ABS(${STORED_SCORE} - ${fresh})) AS mean_abs,
      MAX(ABS(${STORED_SCORE} - ${fresh})) AS max_abs,
      SUM(CASE WHEN ABS(${STORED_SCORE} - ${fresh}) > ${DRIFT_TOLERANCE} * ${fresh} THEN 1 ELSE 0 END) AS over_tolerance
    FROM active_articles
    WHERE ${SCORED_ARTICLES_WHERE}
  `).get() as DriftStats
  return {
    articles: row.articles,
    mean_abs: row.mean_abs ?? 0,
    max_abs: row.max_abs ?? 0,
    over_tolerance: row.over_tolerance ?? 0,
  }
}

/**
 * Snapshot the current score distribution. Reads only — safe to run against a
 * database the server is holding open.
 */
export function collectScoreBaseline(): ScoreBaseline {
  const corpus = collectCorpus()
  return {
    generated_at: new Date().toISOString(),
    decay_factor: SCORE_DECAY_FACTOR,
    corpus,
    score: collectScoreShape(corpus.total),
    engagement: collectEngagement(corpus.total),
    days_since_activity: distribution(daysSinceActivityExpr(''), '1=1'),
    decay: distribution(decayExpr(''), '1=1'),
    candidate_windows: collectCandidateWindows(),
    drift: collectDrift(),
  }
}
