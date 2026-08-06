import { describe, it, expect } from 'vitest'
import { detectBlockedBody, isBotBlockPage, MIN_ARTICLE_BODY_LENGTH } from './blocked-body.js'

/** A body long enough to clear the "too short" check, so markers are what decide. */
function padded(text: string): string {
  return text + ' ' + 'The quick brown fox jumps over the lazy dog. '.repeat(20)
}

describe('isBotBlockPage', () => {
  it.each([
    'Your submission has been received',
    'Something went wrong while submitting the form',
    'Please verify you are a human',
    'Checking your browser before accessing',
    'Enable JavaScript and cookies to continue',
    'Just a moment...',
    'Attention Required! | Cloudflare',
    'Access Denied - You do not have permission',
  ])('detects bot-block pattern: %s', (text) => {
    expect(isBotBlockPage(text)).toBe(true)
  })

  it('is case-insensitive', () => {
    expect(isBotBlockPage('CHECKING YOUR BROWSER')).toBe(true)
    expect(isBotBlockPage('access DENIED')).toBe(true)
  })

  it('returns false for normal article text', () => {
    expect(isBotBlockPage('This is a normal blog post about JavaScript frameworks.')).toBe(false)
  })

  it('returns false for empty string', () => {
    expect(isBotBlockPage('')).toBe(false)
  })

  it('detects pattern embedded in larger HTML text', () => {
    const html = '<div class="wrapper"><h1>Security Check</h1><p>Please verify you are a human to continue browsing.</p></div>'
    expect(isBotBlockPage(html)).toBe(true)
  })

  it('ignores length — a short real body is not a block page', () => {
    expect(isBotBlockPage('Short but genuine note.')).toBe(false)
  })
})

describe('detectBlockedBody', () => {
  it('detects the Google/YouTube unusual-traffic page', () => {
    const text = padded(
      'About this page\n\nOur systems have detected unusual traffic from your computer network. ' +
      'This page checks to see if it\'s really you sending the requests, and not a robot. Why did this happen?',
    )
    expect(detectBlockedBody(text)).toEqual({
      reason: 'bot_check',
      message: 'Stored body is a bot-check page, not article content',
    })
  })

  it('detects "About this page" + "Why did this happen?" together', () => {
    expect(detectBlockedBody(padded('About this page. Why did this happen?'))?.reason).toBe('bot_check')
  })

  it('does not flag "Why did this happen?" on its own', () => {
    expect(detectBlockedBody(padded('The deploy failed at midnight. Why did this happen?'))).toBeNull()
  })

  it('matches the YouTube bot gate written with a typographic apostrophe', () => {
    expect(detectBlockedBody(padded('Sign in to confirm you’re not a bot'))?.reason).toBe('bot_check')
  })

  it('detects the Google consent screen', () => {
    expect(detectBlockedBody(padded('Before you continue to YouTube'))?.reason).toBe('consent_wall')
  })

  it('detects a login wall', () => {
    expect(detectBlockedBody(padded('Sign in to confirm your age'))?.reason).toBe('login_wall')
  })

  it('reports a body shorter than the requested minimum', () => {
    const result = detectBlockedBody('Enable cookies.', { minLength: MIN_ARTICLE_BODY_LENGTH })
    expect(result?.reason).toBe('too_short')
    expect(result?.message).toBe('Stored body is too short to be article content')
  })

  it('applies no length floor by default', () => {
    expect(detectBlockedBody('Enable cookies.')).toBeNull()
  })

  it('measures length with whitespace collapsed', () => {
    const opts = { minLength: MIN_ARTICLE_BODY_LENGTH }
    expect(detectBlockedBody('word '.repeat(60), opts)).toBeNull()
    expect(detectBlockedBody(' '.repeat(MIN_ARTICLE_BODY_LENGTH) + 'short', opts)?.reason).toBe('too_short')
  })

  it('returns null for a genuine article body', () => {
    expect(detectBlockedBody(padded('A post about shipping a Rust CLI.'))).toBeNull()
  })

  it('returns null for a missing body, so callers keep their own no-full-text error', () => {
    expect(detectBlockedBody(null)).toBeNull()
    expect(detectBlockedBody(undefined)).toBeNull()
    expect(detectBlockedBody('')).toBeNull()
  })

  it('ignores a marker quoted deep inside a long article', () => {
    const article = 'An essay on scraping. '.repeat(200) + 'The page said: unusual traffic from your computer network.'
    expect(detectBlockedBody(article)).toBeNull()
  })
})
