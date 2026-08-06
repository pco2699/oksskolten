/**
 * Build an article body for YouTube videos from captions and the description
 * box, instead of scraping the watch page.
 *
 * Scraping a watch page is useless twice over: the DOM carries no prose (the
 * player is JS), and from a server IP YouTube usually answers with its
 * "unusual traffic" interstitial, which Readability happily extracts as if it
 * were the article. What a video actually contains in text form is its
 * captions plus its description, and both are reachable without scraping:
 *
 * - InnerTube's `player` endpoint returns `shortDescription` and the caption
 *   track list. It is the same API the web player uses.
 * - Each caption track has a signed `baseUrl` that serves the timed text.
 * - oEmbed returns title / channel / thumbnail and is not bot-gated, so it
 *   backfills metadata whenever the player call is refused.
 *
 * Every step degrades instead of failing hard: no captions still yields the
 * description, and a refused player call still yields oEmbed metadata. When
 * nothing at all comes back the caller gets `null` and the article keeps an
 * empty body — an honest "no full text" beats a summary of an interstitial.
 */
import { safeFetch } from './ssrf.js'
import { decodeResponse, USER_AGENT } from './http.js'
import { logger } from '../logger.js'

const log = logger.child('youtube')

const REQUEST_TIMEOUT_MS = 15_000

/**
 * Transcripts of multi-hour videos run to hundreds of thousands of characters.
 * Summarization sends the body to the model in one shot, so cap it — the head
 * of a transcript carries the topic, and the cap keeps one long stream from
 * dominating a batch summarize call.
 */
export const MAX_TRANSCRIPT_CHARS = 60_000

/** Characters per transcript paragraph before a new timestamped block starts. */
const PARAGRAPH_CHARS = 600

export interface YouTubeCaptionTrack {
  baseUrl: string
  languageCode: string
  /** YouTube marks automatic speech recognition tracks with kind === 'asr'. */
  kind?: string
  name?: string
}

export interface TranscriptSegment {
  /** Offset from the start of the video, in seconds. */
  startSeconds: number
  text: string
}

export interface YouTubeContent {
  fullText: string
  title: string | null
  ogImage: string | null
  /** Language of the transcript that was used, if any. */
  transcriptLanguage: string | null
}

/**
 * Extract the video id from any of the URL shapes YouTube hands out.
 * Returns null for non-video YouTube URLs (channels, playlists, the home page).
 */
export function parseYouTubeVideoId(rawUrl: string): string | null {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return null
  }

  const host = url.hostname.replace(/^www\./, '').toLowerCase()
  const isYouTubeHost = host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com'

  if (host === 'youtu.be') return validVideoId(url.pathname.slice(1).split('/')[0])

  if (!isYouTubeHost) return null

  if (url.pathname === '/watch') return validVideoId(url.searchParams.get('v') ?? '')

  // /shorts/<id>, /embed/<id>, /live/<id>, /v/<id>
  const match = url.pathname.match(/^\/(?:shorts|embed|live|v)\/([^/?#]+)/)
  if (match) return validVideoId(match[1])

  return null
}

/** YouTube ids are 11 URL-safe base64 characters — anything else is a different kind of link. */
function validVideoId(candidate: string): string | null {
  return /^[A-Za-z0-9_-]{11}$/.test(candidate) ? candidate : null
}

/**
 * InnerTube clients, tried in order. YouTube refuses these unevenly depending on
 * the caller's IP reputation, and which client is accepted shifts over time, so
 * a refusal moves on to the next one rather than aborting.
 */
const INNERTUBE_CLIENTS = [
  {
    clientName: 'ANDROID',
    clientVersion: '19.09.37',
    clientNameId: '3',
    apiKey: 'AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w',
    userAgent: 'com.google.android.youtube/19.09.37 (Linux; U; Android 11) gzip',
    extraContext: { androidSdkVersion: 30 } as Record<string, unknown>,
  },
  {
    clientName: 'WEB',
    clientVersion: '2.20240304.00.00',
    clientNameId: '1',
    apiKey: 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8',
    userAgent: USER_AGENT,
    extraContext: {} as Record<string, unknown>,
  },
]

interface PlayerResponse {
  playabilityStatus?: { status?: string; reason?: string }
  videoDetails?: {
    title?: string
    author?: string
    shortDescription?: string
    thumbnail?: { thumbnails?: { url?: string; width?: number }[] }
  }
  captions?: {
    playerCaptionsTracklistRenderer?: {
      captionTracks?: {
        baseUrl?: string
        languageCode?: string
        kind?: string
        name?: { simpleText?: string; runs?: { text?: string }[] }
      }[]
    }
  }
}

export interface YouTubeVideoMetadata {
  title: string | null
  author: string | null
  description: string | null
  thumbnail: string | null
  captionTracks: YouTubeCaptionTrack[]
}

/**
 * Ask InnerTube for the description and caption track list.
 * Returns null when every client is refused or the video is not playable
 * (private, members-only, region-locked) — there is no body to build then.
 */
export async function fetchPlayerMetadata(videoId: string): Promise<YouTubeVideoMetadata | null> {
  for (const client of INNERTUBE_CLIENTS) {
    try {
      const res = await safeFetch(
        `https://www.youtube.com/youtubei/v1/player?key=${client.apiKey}&prettyPrint=false`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': client.userAgent,
            'X-YouTube-Client-Name': client.clientNameId,
            'X-YouTube-Client-Version': client.clientVersion,
            Origin: 'https://www.youtube.com',
          },
          body: JSON.stringify({
            videoId,
            context: {
              client: {
                clientName: client.clientName,
                clientVersion: client.clientVersion,
                hl: 'en',
                gl: 'US',
                ...client.extraContext,
              },
            },
            // Age-gated and "may be inappropriate" videos still return their
            // description and captions when the checks are acknowledged.
            contentCheckOk: true,
            racyCheckOk: true,
          }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
      )
      if (!res.ok) {
        log.debug(`player request refused for ${videoId} (${client.clientName}): HTTP ${res.status}`)
        continue
      }

      const player = JSON.parse(await decodeResponse(res)) as PlayerResponse
      const status = player.playabilityStatus?.status
      if (status && status !== 'OK') {
        log.debug(`video ${videoId} not playable (${client.clientName}): ${status}`)
        continue
      }

      return {
        title: player.videoDetails?.title ?? null,
        author: player.videoDetails?.author ?? null,
        description: player.videoDetails?.shortDescription?.trim() || null,
        thumbnail: pickThumbnail(player),
        captionTracks: readCaptionTracks(player),
      }
    } catch (err) {
      log.debug(`player request failed for ${videoId} (${client.clientName}): ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return null
}

function pickThumbnail(player: PlayerResponse): string | null {
  const thumbnails = player.videoDetails?.thumbnail?.thumbnails ?? []
  const widest = thumbnails.reduce<{ url?: string; width?: number } | null>(
    (best, t) => (t.url && (!best || (t.width ?? 0) > (best.width ?? 0)) ? t : best),
    null,
  )
  return widest?.url ?? null
}

function readCaptionTracks(player: PlayerResponse): YouTubeCaptionTrack[] {
  const tracks = player.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? []
  return tracks
    .filter((t): t is typeof t & { baseUrl: string } => typeof t.baseUrl === 'string' && t.baseUrl.length > 0)
    .map(t => ({
      baseUrl: t.baseUrl,
      languageCode: t.languageCode ?? '',
      kind: t.kind,
      name: t.name?.simpleText ?? t.name?.runs?.map(r => r.text ?? '').join('') ?? undefined,
    }))
}

/**
 * Choose which caption track to transcribe.
 *
 * Languages are tried in the order given — the first preference is exhausted
 * (human-written, then automatic) before the second is considered, so a reader
 * whose language the video captions never gets a track they cannot read while
 * one they can is available. Human-written captions are punctuated and
 * speaker-attributed, which is worth more to a summarizer than ASR of the same
 * language. Falling off the end still returns a track: any captions beat none.
 */
export function pickCaptionTrack(
  tracks: YouTubeCaptionTrack[],
  preferredLanguages: string[],
): YouTubeCaptionTrack | null {
  if (tracks.length === 0) return null

  const isManual = (t: YouTubeCaptionTrack) => t.kind !== 'asr'
  const inLanguage = (t: YouTubeCaptionTrack, lang: string) => {
    const code = t.languageCode.toLowerCase()
    return code === lang || code.startsWith(`${lang}-`)
  }

  for (const preference of preferredLanguages.map(l => l.toLowerCase())) {
    const manual = tracks.find(t => inLanguage(t, preference) && isManual(t))
    if (manual) return manual
    const automatic = tracks.find(t => inLanguage(t, preference))
    if (automatic) return automatic
  }

  return tracks.find(isManual) ?? tracks[0]
}

interface Json3Transcript {
  events?: { tStartMs?: number; segs?: { utf8?: string }[] }[]
}

/** Parse the `fmt=json3` timed-text payload. */
export function parseJson3Transcript(body: string): TranscriptSegment[] {
  let parsed: Json3Transcript
  try {
    parsed = JSON.parse(body) as Json3Transcript
  } catch {
    return []
  }

  const segments: TranscriptSegment[] = []
  for (const event of parsed.events ?? []) {
    // Events without `segs` carry window/pen styling, not words.
    const text = (event.segs ?? []).map(s => s.utf8 ?? '').join('').replace(/\s+/g, ' ').trim()
    if (!text) continue
    segments.push({ startSeconds: Math.floor((event.tStartMs ?? 0) / 1000), text })
  }
  return segments
}

/** Parse the legacy `<transcript><text start dur>` timed-text payload. */
export function parseTimedTextXml(body: string): TranscriptSegment[] {
  const segments: TranscriptSegment[] = []
  const re = /<text\b([^>]*)>([\s\S]*?)<\/text>/g
  let match: RegExpExecArray | null
  while ((match = re.exec(body))) {
    const start = Number(match[1].match(/\bstart="([\d.]+)"/)?.[1] ?? '0')
    // Timed text is entity-escaped twice: once for the XML, once for the text
    // itself, so `&amp;#39;` is an apostrophe.
    const text = decodeEntities(decodeEntities(match[2])).replace(/\s+/g, ' ').trim()
    if (!text) continue
    segments.push({ startSeconds: Math.floor(Number.isFinite(start) ? start : 0), text })
  }
  return segments
}

function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&')
}

/** Fetch and parse one caption track. Returns an empty list if it cannot be read. */
export async function fetchTranscript(track: YouTubeCaptionTrack): Promise<TranscriptSegment[]> {
  const url = track.baseUrl.includes('fmt=') ? track.baseUrl : `${track.baseUrl}&fmt=json3`
  try {
    const res = await safeFetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!res.ok) {
      log.debug(`caption fetch failed: HTTP ${res.status}`)
      return []
    }
    const body = await decodeResponse(res)
    // json3 is what we asked for, but a track can still answer with the legacy
    // XML — pick the parser by what actually came back.
    return body.trimStart().startsWith('{') ? parseJson3Transcript(body) : parseTimedTextXml(body)
  } catch (err) {
    log.debug(`caption fetch failed: ${err instanceof Error ? err.message : String(err)}`)
    return []
  }
}

/** oEmbed metadata — not bot-gated, so it backfills a refused player call. */
export async function fetchOEmbed(videoId: string): Promise<{ title: string | null; author: string | null; thumbnail: string | null } | null> {
  const target = `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`
  try {
    const res = await safeFetch(target, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!res.ok) return null
    const data = JSON.parse(await decodeResponse(res)) as { title?: string; author_name?: string; thumbnail_url?: string }
    return {
      title: data.title ?? null,
      author: data.author_name ?? null,
      thumbnail: data.thumbnail_url ?? null,
    }
  } catch {
    return null
  }
}

/** Render `123` seconds as `2:03`, or `3661` as `1:01:01`. */
export function formatTimestamp(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const mm = hours > 0 ? String(minutes).padStart(2, '0') : String(minutes)
  return `${hours > 0 ? `${hours}:` : ''}${mm}:${String(seconds).padStart(2, '0')}`
}

/**
 * Group caption segments into timestamped paragraphs.
 *
 * Raw captions arrive as a few words per line, which reads as noise and wastes
 * tokens. Paragraphs of roughly `PARAGRAPH_CHARS` keep the text readable while
 * the leading timestamp still points back into the video.
 */
export function formatTranscript(segments: TranscriptSegment[], maxChars = MAX_TRANSCRIPT_CHARS): string {
  const paragraphs: string[] = []
  let current: string[] = []
  let currentStart = 0
  let currentLength = 0
  let total = 0
  let truncated = false

  const flush = () => {
    if (current.length === 0) return
    paragraphs.push(`[${formatTimestamp(currentStart)}] ${current.join(' ')}`)
    current = []
    currentLength = 0
  }

  for (const segment of segments) {
    if (total + segment.text.length > maxChars) {
      truncated = true
      break
    }
    if (current.length === 0) currentStart = segment.startSeconds
    current.push(segment.text)
    currentLength += segment.text.length + 1
    total += segment.text.length + 1
    if (currentLength >= PARAGRAPH_CHARS) flush()
  }
  flush()

  if (truncated) paragraphs.push('… (transcript truncated)')
  return paragraphs.join('\n\n')
}

/** Compose the stored article body from the description and the transcript. */
export function buildYouTubeBody(parts: {
  description: string | null
  transcript: string
  transcriptLabel: string | null
}): string {
  const sections: string[] = []
  if (parts.description) sections.push(`## Description\n\n${parts.description}`)
  if (parts.transcript) sections.push(`## Transcript${parts.transcriptLabel ? ` (${parts.transcriptLabel})` : ''}\n\n${parts.transcript}`)
  return sections.join('\n\n')
}

/** Human-readable label for the transcript section heading, e.g. `en, auto-generated`. */
function transcriptLabel(track: YouTubeCaptionTrack): string {
  const language = track.languageCode || track.name || 'unknown'
  return track.kind === 'asr' ? `${language}, auto-generated` : language
}

/**
 * Build an article body for a YouTube video URL.
 * Returns null when neither a description nor captions could be retrieved.
 */
export async function fetchYouTubeContent(
  url: string,
  options?: { preferredLanguages?: string[] },
): Promise<YouTubeContent | null> {
  const videoId = parseYouTubeVideoId(url)
  if (!videoId) return null

  const [player, oembed] = await Promise.all([fetchPlayerMetadata(videoId), fetchOEmbed(videoId)])
  if (!player && !oembed) return null

  const preferredLanguages = options?.preferredLanguages?.length ? options.preferredLanguages : ['en']
  const track = pickCaptionTrack(player?.captionTracks ?? [], preferredLanguages)
  const segments = track ? await fetchTranscript(track) : []
  const transcript = formatTranscript(segments)

  const description = player?.description ?? null
  if (!description && !transcript) {
    log.info(`no description or captions available for ${videoId}`)
    return null
  }

  return {
    fullText: buildYouTubeBody({
      description,
      transcript,
      transcriptLabel: track && transcript ? transcriptLabel(track) : null,
    }),
    title: player?.title ?? oembed?.title ?? null,
    ogImage: player?.thumbnail ?? oembed?.thumbnail ?? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    transcriptLanguage: track && transcript ? track.languageCode : null,
  }
}
