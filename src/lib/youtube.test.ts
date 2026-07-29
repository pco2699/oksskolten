import { describe, it, expect } from 'vitest'
import { extractYouTubeVideoId } from './youtube'

describe('extractYouTubeVideoId', () => {
  it('returns null for null/undefined/empty input', () => {
    expect(extractYouTubeVideoId(null)).toBeNull()
    expect(extractYouTubeVideoId(undefined)).toBeNull()
    expect(extractYouTubeVideoId('')).toBeNull()
  })

  it('returns null for an unparseable URL', () => {
    expect(extractYouTubeVideoId('not a url')).toBeNull()
  })

  describe('canonical youtube.com hosts', () => {
    it('extracts from youtube.com/watch?v=', () => {
      expect(extractYouTubeVideoId('https://youtube.com/watch?v=bjFDAEeywi0')).toBe('bjFDAEeywi0')
    })

    it('extracts from www.youtube.com/watch?v=', () => {
      expect(extractYouTubeVideoId('https://www.youtube.com/watch?v=bjFDAEeywi0')).toBe('bjFDAEeywi0')
    })

    it('extracts from m.youtube.com/watch?v=', () => {
      expect(extractYouTubeVideoId('https://m.youtube.com/watch?v=bjFDAEeywi0')).toBe('bjFDAEeywi0')
    })

    it('extracts from music.youtube.com/watch?v=', () => {
      expect(extractYouTubeVideoId('https://music.youtube.com/watch?v=bjFDAEeywi0')).toBe('bjFDAEeywi0')
    })

    it('ignores extra query params', () => {
      expect(extractYouTubeVideoId('https://www.youtube.com/watch?v=bjFDAEeywi0&t=42s&list=PL123')).toBe('bjFDAEeywi0')
    })

    it('extracts from /shorts/:id', () => {
      expect(extractYouTubeVideoId('https://www.youtube.com/shorts/bjFDAEeywi0')).toBe('bjFDAEeywi0')
    })

    it('extracts from /embed/:id', () => {
      expect(extractYouTubeVideoId('https://www.youtube.com/embed/bjFDAEeywi0')).toBe('bjFDAEeywi0')
    })

    it('extracts from /live/:id', () => {
      expect(extractYouTubeVideoId('https://www.youtube.com/live/bjFDAEeywi0')).toBe('bjFDAEeywi0')
    })

    it('returns null for /watch with no v param', () => {
      expect(extractYouTubeVideoId('https://www.youtube.com/watch?list=PL123')).toBeNull()
    })

    it('returns null for a non-11-char id', () => {
      expect(extractYouTubeVideoId('https://www.youtube.com/watch?v=short')).toBeNull()
      expect(extractYouTubeVideoId('https://www.youtube.com/watch?v=wayTooLongOfAnId')).toBeNull()
    })

    it('returns null for unrelated paths', () => {
      expect(extractYouTubeVideoId('https://www.youtube.com/channel/UC123456789')).toBeNull()
      expect(extractYouTubeVideoId('https://www.youtube.com/')).toBeNull()
    })
  })

  describe('youtu.be', () => {
    it('extracts from youtu.be/:id', () => {
      expect(extractYouTubeVideoId('https://youtu.be/bjFDAEeywi0')).toBe('bjFDAEeywi0')
    })

    it('extracts from youtu.be/:id with query params', () => {
      expect(extractYouTubeVideoId('https://youtu.be/bjFDAEeywi0?t=10')).toBe('bjFDAEeywi0')
    })

    it('returns null for non-11-char id', () => {
      expect(extractYouTubeVideoId('https://youtu.be/short')).toBeNull()
    })
  })

  describe('proxy / invidious-style hosts', () => {
    it('extracts from an arbitrary host with /watch?v=', () => {
      expect(extractYouTubeVideoId('https://yt.chocolatemoo53.com/watch?v=bjFDAEeywi0')).toBe('bjFDAEeywi0')
    })

    it('extracts regardless of scheme/port', () => {
      expect(extractYouTubeVideoId('http://invidious.example.org:8443/watch?v=bjFDAEeywi0')).toBe('bjFDAEeywi0')
    })

    it('returns null when v param is not a valid 11-char id', () => {
      expect(extractYouTubeVideoId('https://yt.chocolatemoo53.com/watch?v=abc')).toBeNull()
    })

    it('returns null for /watch without a v param on a random host', () => {
      expect(extractYouTubeVideoId('https://yt.chocolatemoo53.com/watch')).toBeNull()
    })

    it('does not recognize /shorts/:id on a random host', () => {
      expect(extractYouTubeVideoId('https://yt.chocolatemoo53.com/shorts/bjFDAEeywi0')).toBeNull()
    })

    it('returns null for random hosts with unrelated paths', () => {
      expect(extractYouTubeVideoId('https://example.com/blog/some-article')).toBeNull()
      expect(extractYouTubeVideoId('https://news.example.com/2026/07/29/story')).toBeNull()
    })
  })
})
