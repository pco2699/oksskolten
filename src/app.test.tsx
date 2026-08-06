import { describe, it, expect } from 'vitest'
import { getPageType } from './app'

// getPageType and <Routes> are derived from one APP_ROUTES table. These cases
// guard the property that made splitting them worthwhile: every declared route
// animates as a list, and only unmatched paths fall through to 'detail'.
describe('getPageType', () => {
  it.each([
    '/',
    '/all',
    '/inbox',
    '/bookmarks',
    '/likes',
    '/history',
    '/clips',
    '/feeds/12',
    '/categories/3',
    '/settings',
    '/settings/general',
    '/chat',
    '/chat/abc-123',
  ])('treats %s as a list page', (pathname) => {
    expect(getPageType(pathname)).toBe('list')
  })

  it.each([
    '/example.com/some-article',
    '/http/example.com/some-article',
    '/example.com/a/b/c.md',
  ])('treats %s as a detail page', (pathname) => {
    expect(getPageType(pathname)).toBe('detail')
  })
})
