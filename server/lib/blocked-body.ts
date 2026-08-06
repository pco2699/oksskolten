/**
 * Detection for fetch-failure pages that ended up stored as an article body.
 *
 * When a page fetch is intercepted by a bot check, a cookie-consent screen, or
 * a login wall, Readability still extracts *something* — the interstitial's own
 * prose. Stored in `full_text` it is indistinguishable from a real article, so
 * the summarizer happily produces a confident summary of "a page explaining
 * that unusual traffic was detected". The caller cannot tell that apart from a
 * successful fetch, which is the dangerous part: a plausible lie is worse than
 * an error. Anything matched here must be refused, not summarized/translated.
 */

/** Why a stored body is a fetch failure rather than article content. */
export type BlockedBodyReason =
  | 'bot_check'
  | 'consent_wall'
  | 'login_wall'
  | 'error_page'
  | 'too_short'

/**
 * Bodies shorter than this are failed extractions, not articles — the fetcher
 * uses the same number as its quality gate (`MIN_EXTRACTED_LENGTH` in
 * `server/fetcher/content.ts`, which re-exports it) and keeps retrying them.
 *
 * Only summarization applies it: there is nothing to summarize in a body that
 * is shorter than the summary would be, so any output is invention. Translation
 * has no such floor — a short body translates fine, and feeds that skip the
 * page fetch entirely (Reddit, X) legitimately store bodies this short.
 */
export const MIN_ARTICLE_BODY_LENGTH = 200

/**
 * Only the head of the body is scanned for markers. Interstitials put their
 * message first and are short; scanning the whole text would flag a genuine
 * article that merely quotes a CAPTCHA page (a Fireship video transcript about
 * bot detection, say) somewhere in the middle.
 */
const MARKER_SCAN_LENGTH = 2000

/**
 * A marker is either one phrase, or a set of phrases that must all appear —
 * used where a single phrase is too common to stand on its own ("why did this
 * happen?" is ordinary prose, but not next to "about this page").
 */
type Marker = string | string[]

const MARKERS: { reason: BlockedBodyReason; marker: Marker }[] = [
  // Google / YouTube interstitial ("Our systems have detected unusual traffic
  // from your computer network"), which is what YouTube serves to datacenter IPs.
  { reason: 'bot_check', marker: 'unusual traffic from your computer network' },
  { reason: 'bot_check', marker: 'our systems have detected unusual traffic' },
  { reason: 'bot_check', marker: "this page checks to see if it's really you sending the requests" },
  { reason: 'bot_check', marker: ['about this page', 'why did this happen'] },
  // YouTube's newer "not a bot" gate.
  { reason: 'bot_check', marker: "sign in to confirm you're not a bot" },
  { reason: 'bot_check', marker: 'confirm you are not a robot' },
  // Cloudflare and friends.
  { reason: 'bot_check', marker: 'verify you are a human' },
  { reason: 'bot_check', marker: 'checking your browser' },
  { reason: 'bot_check', marker: 'enable javascript and cookies' },
  { reason: 'bot_check', marker: 'just a moment' },
  { reason: 'bot_check', marker: 'attention required' },
  { reason: 'bot_check', marker: 'access denied' },
  // Google consent screen shown before the real page.
  { reason: 'consent_wall', marker: 'before you continue to youtube' },
  { reason: 'consent_wall', marker: 'before you continue to google' },
  // Login / age walls.
  { reason: 'login_wall', marker: 'sign in to confirm your age' },
  { reason: 'login_wall', marker: 'sign in to continue' },
  { reason: 'login_wall', marker: 'log in to continue' },
  { reason: 'login_wall', marker: 'you must be logged in to view' },
  // Form-submission shells that Readability mistakes for content.
  { reason: 'error_page', marker: 'your submission has been received' },
  { reason: 'error_page', marker: 'something went wrong while submitting' },
]

const REASON_MESSAGES: Record<BlockedBodyReason, string> = {
  bot_check: 'Stored body is a bot-check page, not article content',
  consent_wall: 'Stored body is a cookie-consent page, not article content',
  login_wall: 'Stored body is a login wall, not article content',
  error_page: 'Stored body is an error page, not article content',
  too_short: 'Stored body is too short to be article content',
}

/**
 * Lowercase and fold typographic apostrophes, so a marker written with `'`
 * matches a page that renders `’` ("Sign in to confirm you’re not a bot").
 */
function normalize(text: string): string {
  return text.slice(0, MARKER_SCAN_LENGTH).toLowerCase().replace(/[’‘‛`]/g, "'")
}

function matches(haystack: string, marker: Marker): boolean {
  return Array.isArray(marker)
    ? marker.every(m => haystack.includes(m))
    : haystack.includes(marker)
}

export interface BlockedBody {
  reason: BlockedBodyReason
  message: string
}

export interface DetectBlockedBodyOptions {
  /**
   * Report bodies shorter than this as `too_short`. Omitted by default, so the
   * check is markers-only — pass `MIN_ARTICLE_BODY_LENGTH` from summarization,
   * which is the one caller a short body is useless for.
   */
  minLength?: number
}

/**
 * Classify a stored article body as a fetch failure, or `null` if it looks like
 * real content.
 *
 * An absent body is *not* reported here: callers already treat "no full text"
 * as its own condition, and reporting it as blocked would mask the difference.
 */
export function detectBlockedBody(
  text: string | null | undefined,
  options?: DetectBlockedBodyOptions,
): BlockedBody | null {
  if (!text) return null

  const haystack = normalize(text)
  const hit = MARKERS.find(({ marker }) => matches(haystack, marker))
  if (hit) return { reason: hit.reason, message: REASON_MESSAGES[hit.reason] }

  const minLength = options?.minLength ?? 0
  if (minLength > 0 && text.replace(/\s+/g, ' ').trim().length < minLength) {
    return { reason: 'too_short', message: REASON_MESSAGES.too_short }
  }

  return null
}

/**
 * Marker-only check used by the fetch pipeline, where "too short" is already
 * handled separately by the `MIN_EXTRACTED_LENGTH` quality gate.
 */
export function isBotBlockPage(text: string): boolean {
  const haystack = normalize(text)
  return MARKERS.some(({ marker }) => matches(haystack, marker))
}
