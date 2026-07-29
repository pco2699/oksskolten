/**
 * Extracts a YouTube video ID from an article URL, if the article is a YouTube video.
 *
 * Supports two families of URLs:
 * 1. Canonical YouTube hosts (youtube.com, www.youtube.com, m.youtube.com, music.youtube.com,
 *    youtu.be) with the usual watch/shorts/embed/live path shapes.
 * 2. Any other host where the path is exactly `/watch` and a `v` query parameter holds a
 *    valid-looking video ID. This covers RSS proxy / invidious-style mirrors (e.g.
 *    `yt.chocolatemoo53.com/watch?v=<id>`) that re-expose YouTube videos under their own domain.
 *
 * The `/shorts/:id`, `/embed/:id`, `/live/:id` path shapes are only recognized on canonical
 * YouTube hosts to avoid false positives on unrelated sites that happen to use those paths.
 */

// YouTube video IDs are exactly 11 characters from this alphabet.
const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/

const CANONICAL_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
])

function isValidVideoId(id: string | null | undefined): id is string {
  return !!id && VIDEO_ID_PATTERN.test(id)
}

export function extractYouTubeVideoId(url: string | null | undefined): string | null {
  if (!url) return null

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }

  const host = parsed.hostname.toLowerCase()
  const path = parsed.pathname

  // youtu.be/<id>
  if (host === 'youtu.be') {
    const id = path.split('/').filter(Boolean)[0]
    return isValidVideoId(id) ? id : null
  }

  if (CANONICAL_HOSTS.has(host)) {
    const segments = path.split('/').filter(Boolean)

    if (segments[0] === 'watch') {
      const id = parsed.searchParams.get('v')
      return isValidVideoId(id) ? id : null
    }

    if ((segments[0] === 'shorts' || segments[0] === 'embed' || segments[0] === 'live') && segments.length >= 2) {
      const id = segments[1]
      return isValidVideoId(id) ? id : null
    }

    return null
  }

  // Proxy / invidious-style hosts: only trust an exact `/watch` path with a valid `v` param.
  if (path === '/watch') {
    const id = parsed.searchParams.get('v')
    return isValidVideoId(id) ? id : null
  }

  return null
}
