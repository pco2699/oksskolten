import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockSafeFetch } = vi.hoisted(() => ({ mockSafeFetch: vi.fn() }))

vi.mock('./ssrf.js', () => ({ safeFetch: mockSafeFetch }))

import {
  parseYouTubeVideoId,
  pickCaptionTrack,
  parseJson3Transcript,
  parseTimedTextXml,
  formatTimestamp,
  formatTranscript,
  buildYouTubeBody,
  fetchPlayerMetadata,
  fetchTranscript,
  fetchOEmbed,
  fetchYouTubeContent,
  MAX_TRANSCRIPT_CHARS,
  type YouTubeCaptionTrack,
} from './youtube.js'

/** Minimal stand-in for the parts of Response that decodeResponse touches. */
function jsonResponse(body: unknown, init?: { ok?: boolean; status?: number }): Response {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  return {
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    arrayBuffer: async () => new TextEncoder().encode(text).buffer,
  } as unknown as Response
}

const PLAYER_RESPONSE = {
  playabilityStatus: { status: 'OK' },
  videoDetails: {
    title: 'Never Gonna Give You Up',
    author: 'Rick Astley',
    shortDescription: 'The official video for the song.',
    thumbnail: {
      thumbnails: [
        { url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/default.jpg', width: 120 },
        { url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg', width: 1280 },
      ],
    },
  },
  captions: {
    playerCaptionsTracklistRenderer: {
      captionTracks: [
        { baseUrl: 'https://www.youtube.com/api/timedtext?v=dQw4w9WgXcQ&lang=en', languageCode: 'en', name: { simpleText: 'English' } },
      ],
    },
  },
}

const JSON3_BODY = {
  events: [
    { tStartMs: 0, dDurationMs: 2000, segs: [{ utf8: 'Never gonna' }, { utf8: ' give you up' }] },
    { tStartMs: 2000, dDurationMs: 2000, segs: [{ utf8: 'never gonna let you down' }] },
    // Styling event with no text — must be skipped, not rendered as a blank line.
    { tStartMs: 4000, dDurationMs: 0 },
  ],
}

beforeEach(() => {
  mockSafeFetch.mockReset()
})

describe('parseYouTubeVideoId', () => {
  it.each([
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s', 'dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ?si=abc', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/shorts/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/embed/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/live/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://m.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
  ])('extracts the id from %s', (url, expected) => {
    expect(parseYouTubeVideoId(url)).toBe(expected)
  })

  it.each([
    'https://www.youtube.com/@RickAstleyYT',
    'https://www.youtube.com/playlist?list=PL1234567890',
    'https://www.youtube.com/',
    'https://example.com/watch?v=dQw4w9WgXcQ',
    'not a url',
    // An 11-character id is the whole format — a longer path segment is something else.
    'https://www.youtube.com/watch?v=tooLongToBeAVideoId',
  ])('returns null for %s', (url) => {
    expect(parseYouTubeVideoId(url)).toBeNull()
  })
})

describe('pickCaptionTrack', () => {
  const manualEn: YouTubeCaptionTrack = { baseUrl: 'a', languageCode: 'en' }
  const asrEn: YouTubeCaptionTrack = { baseUrl: 'b', languageCode: 'en', kind: 'asr' }
  const manualJa: YouTubeCaptionTrack = { baseUrl: 'c', languageCode: 'ja' }
  const asrJa: YouTubeCaptionTrack = { baseUrl: 'd', languageCode: 'ja', kind: 'asr' }

  it('prefers a human-written track in a preferred language', () => {
    expect(pickCaptionTrack([asrJa, manualJa, manualEn], ['ja'])).toBe(manualJa)
  })

  it('falls back to an automatic track in a preferred language', () => {
    expect(pickCaptionTrack([manualEn, asrJa], ['ja'])).toBe(asrJa)
  })

  it('prefers human-written captions in another language over none', () => {
    expect(pickCaptionTrack([asrEn, manualEn], ['ja'])).toBe(manualEn)
  })

  it('matches regional variants of a preferred language', () => {
    const ptBr: YouTubeCaptionTrack = { baseUrl: 'e', languageCode: 'pt-BR' }
    expect(pickCaptionTrack([asrEn, ptBr], ['pt'])).toBe(ptBr)
  })

  it('returns null when there are no tracks', () => {
    expect(pickCaptionTrack([], ['en'])).toBeNull()
  })
})

describe('parseJson3Transcript', () => {
  it('joins segments into timestamped lines and skips styling events', () => {
    expect(parseJson3Transcript(JSON.stringify(JSON3_BODY))).toEqual([
      { startSeconds: 0, text: 'Never gonna give you up' },
      { startSeconds: 2, text: 'never gonna let you down' },
    ])
  })

  it('returns an empty list for a body that is not JSON', () => {
    expect(parseJson3Transcript('<html>nope</html>')).toEqual([])
  })
})

describe('parseTimedTextXml', () => {
  it('parses the legacy transcript format', () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?><transcript>` +
      `<text start="0" dur="2">Never gonna give you up</text>` +
      `<text start="2.5" dur="2">never gonna let you down</text>` +
      `</transcript>`
    expect(parseTimedTextXml(xml)).toEqual([
      { startSeconds: 0, text: 'Never gonna give you up' },
      { startSeconds: 2, text: 'never gonna let you down' },
    ])
  })

  it('decodes the double-escaped entities timed text uses', () => {
    const xml = `<transcript><text start="0" dur="1">it&amp;#39;s a &amp;quot;test&amp;quot; &amp;amp; more</text></transcript>`
    expect(parseTimedTextXml(xml)[0].text).toBe('it\'s a "test" & more')
  })
})

describe('formatTimestamp', () => {
  it.each([
    [0, '0:00'],
    [63, '1:03'],
    [599, '9:59'],
    [3661, '1:01:01'],
  ])('formats %i seconds as %s', (seconds, expected) => {
    expect(formatTimestamp(seconds)).toBe(expected)
  })
})

describe('formatTranscript', () => {
  it('groups segments into timestamped paragraphs', () => {
    const segments = Array.from({ length: 40 }, (_, i) => ({
      startSeconds: i * 5,
      text: 'a fairly wordy caption line goes here',
    }))
    const out = formatTranscript(segments)
    const paragraphs = out.split('\n\n')
    expect(paragraphs.length).toBeGreaterThan(1)
    expect(paragraphs[0]).toMatch(/^\[0:00\] /)
    expect(paragraphs[1]).toMatch(/^\[\d+:\d\d\] /)
  })

  it('caps very long transcripts and says so', () => {
    const segments = Array.from({ length: 5000 }, (_, i) => ({
      startSeconds: i * 3,
      text: 'x'.repeat(100),
    }))
    const out = formatTranscript(segments)
    expect(out.length).toBeLessThan(MAX_TRANSCRIPT_CHARS + 2000)
    expect(out).toContain('… (transcript truncated)')
  })

  it('returns an empty string for no segments', () => {
    expect(formatTranscript([])).toBe('')
  })
})

describe('buildYouTubeBody', () => {
  it('includes both sections when both are present', () => {
    const body = buildYouTubeBody({
      description: 'Video description.',
      transcript: '[0:00] hello',
      transcriptLabel: 'en, auto-generated',
    })
    expect(body).toBe('## Description\n\nVideo description.\n\n## Transcript (en, auto-generated)\n\n[0:00] hello')
  })

  it('omits the transcript section when there are no captions', () => {
    const body = buildYouTubeBody({ description: 'Only a description.', transcript: '', transcriptLabel: null })
    expect(body).toBe('## Description\n\nOnly a description.')
  })

  it('omits the description section when the video has none', () => {
    const body = buildYouTubeBody({ description: null, transcript: '[0:00] hello', transcriptLabel: 'en' })
    expect(body).toBe('## Transcript (en)\n\n[0:00] hello')
  })
})

describe('fetchPlayerMetadata', () => {
  it('reads description, thumbnail, and caption tracks', async () => {
    mockSafeFetch.mockResolvedValueOnce(jsonResponse(PLAYER_RESPONSE))

    const meta = await fetchPlayerMetadata('dQw4w9WgXcQ')
    expect(meta?.description).toBe('The official video for the song.')
    expect(meta?.title).toBe('Never Gonna Give You Up')
    expect(meta?.thumbnail).toBe('https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg')
    expect(meta?.captionTracks).toHaveLength(1)
    expect(meta?.captionTracks[0].languageCode).toBe('en')

    const [, init] = mockSafeFetch.mock.calls[0]
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body).videoId).toBe('dQw4w9WgXcQ')
  })

  it('falls through to the next client when one is refused', async () => {
    mockSafeFetch
      .mockResolvedValueOnce(jsonResponse({}, { ok: false, status: 403 }))
      .mockResolvedValueOnce(jsonResponse(PLAYER_RESPONSE))

    const meta = await fetchPlayerMetadata('dQw4w9WgXcQ')
    expect(meta?.title).toBe('Never Gonna Give You Up')
    expect(mockSafeFetch).toHaveBeenCalledTimes(2)
  })

  it('skips a client that reports the video as not playable', async () => {
    mockSafeFetch
      .mockResolvedValueOnce(jsonResponse({ playabilityStatus: { status: 'LOGIN_REQUIRED', reason: 'Sign in' } }))
      .mockResolvedValueOnce(jsonResponse(PLAYER_RESPONSE))

    const meta = await fetchPlayerMetadata('dQw4w9WgXcQ')
    expect(meta?.title).toBe('Never Gonna Give You Up')
  })

  it('returns null when every client fails', async () => {
    mockSafeFetch.mockRejectedValue(new Error('network down'))
    expect(await fetchPlayerMetadata('dQw4w9WgXcQ')).toBeNull()
  })
})

describe('fetchTranscript', () => {
  it('requests json3 and parses the response', async () => {
    mockSafeFetch.mockResolvedValueOnce(jsonResponse(JSON3_BODY))

    const segments = await fetchTranscript({ baseUrl: 'https://www.youtube.com/api/timedtext?v=x', languageCode: 'en' })
    expect(segments).toHaveLength(2)
    expect(mockSafeFetch.mock.calls[0][0]).toContain('fmt=json3')
  })

  it('parses the legacy XML when a track answers with it anyway', async () => {
    mockSafeFetch.mockResolvedValueOnce(jsonResponse('<transcript><text start="0" dur="1">hi there</text></transcript>'))

    const segments = await fetchTranscript({ baseUrl: 'https://www.youtube.com/api/timedtext?v=x', languageCode: 'en' })
    expect(segments).toEqual([{ startSeconds: 0, text: 'hi there' }])
  })

  it('returns an empty list when the track cannot be fetched', async () => {
    mockSafeFetch.mockResolvedValueOnce(jsonResponse('', { ok: false, status: 404 }))
    expect(await fetchTranscript({ baseUrl: 'https://x/y', languageCode: 'en' })).toEqual([])
  })
})

describe('fetchOEmbed', () => {
  it('returns title, author, and thumbnail', async () => {
    mockSafeFetch.mockResolvedValueOnce(jsonResponse({
      title: 'Never Gonna Give You Up',
      author_name: 'Rick Astley',
      thumbnail_url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
    }))

    const meta = await fetchOEmbed('dQw4w9WgXcQ')
    expect(meta).toEqual({
      title: 'Never Gonna Give You Up',
      author: 'Rick Astley',
      thumbnail: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
    })
  })

  it('returns null when oEmbed refuses', async () => {
    mockSafeFetch.mockResolvedValueOnce(jsonResponse('', { ok: false, status: 401 }))
    expect(await fetchOEmbed('dQw4w9WgXcQ')).toBeNull()
  })
})

describe('fetchYouTubeContent', () => {
  it('builds a body from the description and the transcript', async () => {
    mockSafeFetch.mockImplementation(async (url: string) => {
      if (url.includes('/youtubei/v1/player')) return jsonResponse(PLAYER_RESPONSE)
      if (url.includes('/oembed')) return jsonResponse({ title: 'oEmbed title' })
      return jsonResponse(JSON3_BODY)
    })

    const content = await fetchYouTubeContent('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
    expect(content?.fullText).toContain('## Description')
    expect(content?.fullText).toContain('The official video for the song.')
    expect(content?.fullText).toContain('## Transcript (en)')
    expect(content?.fullText).toContain('[0:00] Never gonna give you up')
    // The player's own title wins over oEmbed's when both are available.
    expect(content?.title).toBe('Never Gonna Give You Up')
    expect(content?.transcriptLanguage).toBe('en')
  })

  it('still returns the description when the captions cannot be fetched', async () => {
    mockSafeFetch.mockImplementation(async (url: string) => {
      if (url.includes('/youtubei/v1/player')) return jsonResponse(PLAYER_RESPONSE)
      if (url.includes('/oembed')) return jsonResponse({ title: 'oEmbed title' })
      return jsonResponse('', { ok: false, status: 429 })
    })

    const content = await fetchYouTubeContent('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
    expect(content?.fullText).toBe('## Description\n\nThe official video for the song.')
    expect(content?.transcriptLanguage).toBeNull()
  })

  it('returns a null body, not a failure, when the video has neither a description nor captions', async () => {
    mockSafeFetch.mockImplementation(async (url: string) => {
      if (url.includes('/youtubei/v1/player')) {
        return jsonResponse({ playabilityStatus: { status: 'OK' }, videoDetails: { title: 'Silent' } })
      }
      return jsonResponse({ title: 'oEmbed title' })
    })

    // Distinct from null: the fetch succeeded and the answer is "no text".
    // The caller relies on this to keep the article out of the retry queue,
    // and the title and thumbnail are still usable.
    const content = await fetchYouTubeContent('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
    expect(content).not.toBeNull()
    expect(content?.fullText).toBeNull()
    expect(content?.title).toBe('Silent')
    expect(content?.ogImage).toBe('https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg')
  })

  it('returns null when the video metadata cannot be retrieved at all', async () => {
    // A refused player is a fault, so this stays a retryable error rather
    // than a settled "no text" result.
    mockSafeFetch.mockImplementation(async () => jsonResponse('', { ok: false, status: 503 }))

    expect(await fetchYouTubeContent('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBeNull()
  })

  it('reports a refused player as a failure even when oEmbed answers', async () => {
    // The real-world shape of a bot-gated fetch: the ANDROID client is turned
    // away with HTTP 400, the WEB client returns LOGIN_REQUIRED, and oEmbed
    // still serves a title. oEmbed has no description field, so it cannot show
    // the video is textless — treating this as "no text" would permanently
    // write off videos that do have descriptions and captions.
    mockSafeFetch.mockImplementation(async (url: string) => {
      if (url.includes('/youtubei/v1/player')) {
        return jsonResponse({ playabilityStatus: { status: 'LOGIN_REQUIRED', reason: "Sign in to confirm you're not a bot" } })
      }
      return jsonResponse({ title: 'oEmbed title', thumbnail_url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg' })
    })

    expect(await fetchYouTubeContent('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBeNull()
  })

  it('prefers a transcript in the requested language', async () => {
    mockSafeFetch.mockImplementation(async (url: string) => {
      if (url.includes('/youtubei/v1/player')) {
        return jsonResponse({
          ...PLAYER_RESPONSE,
          captions: {
            playerCaptionsTracklistRenderer: {
              captionTracks: [
                { baseUrl: 'https://t/en', languageCode: 'en' },
                { baseUrl: 'https://t/ja', languageCode: 'ja' },
              ],
            },
          },
        })
      }
      if (url.includes('/oembed')) return jsonResponse({})
      return jsonResponse(JSON3_BODY)
    })

    const content = await fetchYouTubeContent('https://www.youtube.com/watch?v=dQw4w9WgXcQ', { preferredLanguages: ['ja', 'en'] })
    expect(content?.transcriptLanguage).toBe('ja')
    expect(mockSafeFetch.mock.calls.some(call => String(call[0]).startsWith('https://t/ja'))).toBe(true)
  })

  it('returns null for a URL that is not a video', async () => {
    expect(await fetchYouTubeContent('https://www.youtube.com/@RickAstleyYT')).toBeNull()
    expect(mockSafeFetch).not.toHaveBeenCalled()
  })
})
