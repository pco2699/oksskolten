import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route, Outlet } from 'react-router-dom'
import { LocaleContext } from '../../lib/i18n'
import { KeyboardNavigationProvider } from '../../contexts/keyboard-navigation-context'
import { TooltipProvider } from '../ui/tooltip'
import type { ArticleListItem } from '../../../shared/types'

// --- Mocks ---

// Control useSWRInfinite return value per test
let swrInfiniteReturn: any = {
  data: undefined,
  error: undefined,
  size: 1,
  setSize: vi.fn(),
  isLoading: true,
  isValidating: false,
  mutate: vi.fn(),
}

// Control useSWR return value for /api/feeds
let swrFeedsData: any = undefined

// Captures the key builder so tests can inspect the request URL per page
type GetKey = (pageIndex: number, previousPageData: unknown) => string | null
let lastGetKey: GetKey | undefined

vi.mock('swr/infinite', () => ({
  default: (getKey: GetKey) => {
    lastGetKey = getKey
    return swrInfiniteReturn
  },
}))

vi.mock('swr', async () => {
  const actual = await vi.importActual<typeof import('swr')>('swr')
  return {
    ...actual,
    default: (key: string) => {
      if (key === '/api/feeds') return { data: swrFeedsData }
      return { data: undefined }
    },
    useSWRConfig: () => ({ mutate: vi.fn() }),
  }
})

vi.mock('../feed/feed-metrics-bar', () => ({
  FeedMetricsBar: ({ feed }: any) => <div data-testid="metrics-bar">{feed.name}</div>,
}))

vi.mock('../../lib/fetcher', () => ({
  fetcher: vi.fn(),
  apiPatch: vi.fn(() => Promise.resolve()),
}))

vi.mock('../../lib/markSeenWithQueue', () => ({
  markSeenOnServer: vi.fn(() => Promise.resolve()),
}))

vi.mock('../../lib/readTracker', () => ({
  trackRead: vi.fn(),
  isReadInSession: vi.fn(() => false),
}))

vi.mock('../../hooks/use-is-touch-device', () => ({
  useIsTouchDevice: vi.fn(() => false),
}))

vi.mock('../../hooks/use-clip-feed-id', () => ({
  useClipFeedId: vi.fn(() => null),
}))

vi.mock('../layout/pull-to-refresh', () => ({
  PullToRefresh: () => null,
}))

vi.mock('../../contexts/fetch-progress-context', () => ({
  useFetchProgressContext: () => ({
    progress: new Map(),
    startFeedFetch: vi.fn(() => Promise.resolve({ totalNew: 0 })),
    subscribeFeedFetch: vi.fn(),
  }),
}))


vi.mock('../ui/mascot', () => ({
  Mascot: () => <div data-testid="mascot" />,
}))

vi.mock('./swipeable-article-card', () => ({
  SwipeableArticleCard: ({ article }: { article: ArticleListItem }) => (
    <div data-testid={`swipeable-${article.id}`}>{article.title}</div>
  ),
}))

vi.mock('./article-card', () => ({
  ArticleCard: ({ article }: { article: ArticleListItem }) => (
    <div data-testid={`article-${article.id}`}>{article.title}</div>
  ),
}))

vi.mock('./article-overlay', () => ({
  ArticleOverlay: ({ articleUrl }: { articleUrl: string | null }) =>
    articleUrl ? <div data-testid="overlay">{articleUrl}</div> : null,
}))

vi.mock('./article-detail', () => ({
  ArticleDetail: ({ articleUrl }: { articleUrl: string }) => (
    <div data-testid="article-detail-preview">{articleUrl}</div>
  ),
}))

vi.mock('../feed/feed-error-banner', () => ({
  FeedErrorBanner: () => null,
}))

vi.mock('../ui/skeleton', () => ({
  Skeleton: ({ className }: { className?: string }) => <div data-testid="skeleton" className={`animate-pulse ${className ?? ''}`} />,
}))

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}))

import { ArticleList } from './article-list'

function makeArticle(overrides: Partial<ArticleListItem> = {}): ArticleListItem {
  return {
    id: 1,
    feed_id: 1,
    feed_name: 'Test Feed',
    title: 'Test Article',
    url: 'https://example.com/1',
    published_at: '2026-01-01T00:00:00Z',
    lang: 'en',
    summary: null,
    excerpt: 'Excerpt text',
    og_image: null,
    seen_at: null,
    read_at: null,
    bookmarked_at: null,
    liked_at: null,
    ...overrides,
  }
}

const mockSettings = {
  colorMode: 'system' as const,
  setColorMode: vi.fn(),
  themeName: 'default',
  setTheme: vi.fn(),
  themes: [{ name: 'default', label: 'Default' }],
  dateMode: 'relative' as const,
  setDateMode: vi.fn(),
  autoMarkRead: 'off' as const,
  setAutoMarkRead: vi.fn(),
  showUnreadIndicator: 'on' as const,
  setShowUnreadIndicator: vi.fn(),
  indicatorStyle: 'dot' as const,
  internalLinks: 'on' as const,
  setInternalLinks: vi.fn(),
  showThumbnails: 'on' as const,
  setShowThumbnails: vi.fn(),
  showFeedActivity: 'on' as const,
  setShowFeedActivity: vi.fn(),
  highlightTheme: 'github-dark' as const,
  setHighlightTheme: vi.fn(),
  articleFont: 'sans' as const,
  setArticleFont: vi.fn(),
  layout: 'list' as const,
  articleOpenMode: 'page' as const,
  keyboardNavigation: 'off' as const,
  keybindings: undefined,
  categoryUnreadOnly: 'off' as const,
  setCategoryUnreadOnly: vi.fn(),
  save: vi.fn(),
}

function OutletWrapper() {
  return (
    <KeyboardNavigationProvider>
      <Outlet context={{ settings: mockSettings, sidebarOpen: false, setSidebarOpen: vi.fn() }} />
    </KeyboardNavigationProvider>
  )
}

function renderArticleList(initialPath = '/all') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <LocaleContext.Provider value={{ locale: 'en', setLocale: vi.fn() }}>
        <TooltipProvider>
          <Routes>
            <Route element={<OutletWrapper />}>
              <Route path="feeds/:feedId" element={<ArticleList />} />
              <Route path="*" element={<ArticleList />} />
            </Route>
          </Routes>
        </TooltipProvider>
      </LocaleContext.Provider>
    </MemoryRouter>,
  )
}

describe('ArticleList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    swrFeedsData = undefined
    lastGetKey = undefined
    mockSettings.categoryUnreadOnly = 'off' as any
    mockSettings.autoMarkRead = 'off' as any
    mockSettings.layout = 'list' as any
    mockSettings.articleOpenMode = 'page' as any
    mockSettings.keyboardNavigation = 'off' as any
    mockSettings.keybindings = undefined as any
    // Stub IntersectionObserver for tests that enable autoMarkRead
    vi.stubGlobal('IntersectionObserver', class {
      constructor() {}
      observe = vi.fn()
      unobserve = vi.fn()
      disconnect = vi.fn()
    })
    // Reset to loading state
    swrInfiniteReturn = {
      data: undefined,
      error: undefined,
      size: 1,
      setSize: vi.fn(),
      isLoading: true,
      isValidating: false,
      mutate: vi.fn(),
    }
  })

  it('shows skeleton when loading', () => {
    renderArticleList()
    // Skeleton renders divs with animate-pulse class
    const pulses = document.querySelectorAll('.animate-pulse')
    expect(pulses.length).toBeGreaterThan(0)
  })

  it('shows empty state when no articles', () => {
    swrInfiniteReturn = {
      data: [{ articles: [], total: 0, has_more: false }],
      error: undefined,
      size: 1,
      setSize: vi.fn(),
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
    }
    renderArticleList()
    expect(screen.getByText('No articles')).toBeTruthy()
  })

  it('shows error state with retry button', () => {
    swrInfiniteReturn = {
      data: undefined,
      error: new Error('fetch failed'),
      size: 1,
      setSize: vi.fn(),
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
    }
    renderArticleList()
    expect(screen.getByText('Failed to load')).toBeTruthy()
    expect(screen.getByText('Retry')).toBeTruthy()
  })

  it('renders article cards', () => {
    swrInfiniteReturn = {
      data: [{
        articles: [
          makeArticle({ id: 1, title: 'First Article' }),
          makeArticle({ id: 2, title: 'Second Article' }),
        ],
        total: 2,
        has_more: false,
      }],
      error: undefined,
      size: 1,
      setSize: vi.fn(),
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
    }
    renderArticleList()
    expect(screen.getByText('First Article')).toBeTruthy()
    expect(screen.getByText('Second Article')).toBeTruthy()
  })

  it('shows mascot at end of feed', () => {
    mockSettings.autoMarkRead = 'on' as any
    swrInfiniteReturn = {
      data: [{ articles: [makeArticle({ id: 1 })], total: 1, has_more: false }],
      error: undefined,
      size: 1,
      setSize: vi.fn(),
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
    }
    renderArticleList()
    expect(screen.getByTestId('mascot')).toBeTruthy()
    expect(screen.getByText("You're all caught up!")).toBeTruthy()
  })

  it('does not show mascot when article list is empty', () => {
    swrInfiniteReturn = {
      data: [{ articles: [], total: 0, has_more: false }],
      error: undefined,
      size: 1,
      setSize: vi.fn(),
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
    }
    renderArticleList()
    expect(screen.queryByTestId('mascot')).toBeNull()
  })

  it('uses ArticleCard on non-touch devices', () => {
    swrInfiniteReturn = {
      data: [{ articles: [makeArticle({ id: 10, title: 'Desktop Article' })], total: 1, has_more: false }],
      error: undefined,
      size: 1,
      setSize: vi.fn(),
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
    }
    renderArticleList()
    expect(screen.getByTestId('article-10')).toBeTruthy()
  })

  it('uses SwipeableArticleCard on touch devices', async () => {
    const { useIsTouchDevice } = await import('../../hooks/use-is-touch-device')
    vi.mocked(useIsTouchDevice).mockReturnValue(true)

    swrInfiniteReturn = {
      data: [{ articles: [makeArticle({ id: 20, title: 'Mobile Article' })], total: 1, has_more: false }],
      error: undefined,
      size: 1,
      setSize: vi.fn(),
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
    }
    renderArticleList()
    expect(screen.getByTestId('swipeable-20')).toBeTruthy()
  })

  it('does not show mascot when still loading', () => {
    renderArticleList()
    expect(screen.queryByTestId('mascot')).toBeNull()
  })

  it('renders multiple pages of articles', () => {
    swrInfiniteReturn = {
      data: [
        { articles: [makeArticle({ id: 1, title: 'Page 1' })], total: 2, has_more: true },
        { articles: [makeArticle({ id: 2, title: 'Page 2' })], total: 2, has_more: false },
      ],
      error: undefined,
      size: 2,
      setSize: vi.fn(),
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
    }
    renderArticleList()
    expect(screen.getByText('Page 1')).toBeTruthy()
    expect(screen.getByText('Page 2')).toBeTruthy()
  })

  it('renders FeedMetricsBar for current feed', () => {
    swrFeedsData = {
      feeds: [
        { id: 1, name: 'My Feed', type: 'rss', unread_count: 5, total_count: 10 },
      ],
    }
    swrInfiniteReturn = {
      data: [{ articles: [makeArticle({ id: 1, feed_id: 1 })], total: 1, has_more: false }],
      error: undefined,
      size: 1,
      setSize: vi.fn(),
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
    }
    renderArticleList('/feeds/1')
    expect(screen.getByTestId('metrics-bar')).toBeTruthy()
    expect(screen.getByText('My Feed')).toBeTruthy()
  })

  it('does not render FeedMetricsBar for clip feed', () => {
    swrFeedsData = {
      feeds: [
        { id: 1, name: 'Clip Feed', type: 'clip', unread_count: 0, total_count: 3 },
      ],
    }
    swrInfiniteReturn = {
      data: [{ articles: [makeArticle({ id: 1, feed_id: 1 })], total: 1, has_more: false }],
      error: undefined,
      size: 1,
      setSize: vi.fn(),
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
    }
    renderArticleList('/feeds/1')
    expect(screen.queryByTestId('metrics-bar')).toBeNull()
  })

  it('retry button resets pagination', () => {
    const mockSetSize = vi.fn()
    swrInfiniteReturn = {
      data: undefined,
      error: new Error('fetch failed'),
      size: 3,
      setSize: mockSetSize,
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
    }
    renderArticleList()
    screen.getByText('Retry').click()
    expect(mockSetSize).toHaveBeenCalledWith(1)
  })

  it('skeleton respects showThumbnails=off', () => {
    mockSettings.showThumbnails = 'off' as any
    swrInfiniteReturn = {
      data: undefined,
      error: undefined,
      size: 1,
      setSize: vi.fn(),
      isLoading: true,
      isValidating: false,
      mutate: vi.fn(),
    }
    renderArticleList()
    // When showThumbnails is off, the 16x16 thumbnail placeholder should not be rendered
    const skeletonThumbnails = document.querySelectorAll('.w-16.h-16')
    expect(skeletonThumbnails.length).toBe(0)
    // Restore default
    mockSettings.showThumbnails = 'on' as any
  })

  it('data-article-unread attribute is set correctly', () => {
    swrInfiniteReturn = {
      data: [{
        articles: [
          makeArticle({ id: 1, title: 'Unread', seen_at: null }),
          makeArticle({ id: 2, title: 'Read', seen_at: '2026-01-01' }),
        ],
        total: 2,
        has_more: false,
      }],
      error: undefined,
      size: 1,
      setSize: vi.fn(),
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
    }
    renderArticleList()
    const unreadEl = document.querySelector('[data-article-id="1"]')
    const readEl = document.querySelector('[data-article-id="2"]')
    expect(unreadEl?.getAttribute('data-article-unread')).toBe('1')
    expect(readEl?.getAttribute('data-article-unread')).toBe('0')
  })

  it('validating state shows skeleton in sentinel', () => {
    // Stub IntersectionObserver for this test since sentinel ref callback uses it
    const observeMock = vi.fn()
    const disconnectMock = vi.fn()
    vi.stubGlobal('IntersectionObserver', class {
      constructor() {}
      observe = observeMock
      unobserve = vi.fn()
      disconnect = disconnectMock
    })

    swrInfiniteReturn = {
      data: [{ articles: [makeArticle({ id: 1 })], total: 2, has_more: true }],
      error: undefined,
      size: 1,
      setSize: vi.fn(),
      isLoading: false,
      isValidating: true,
      mutate: vi.fn(),
    }
    renderArticleList()
    // Sentinel area should contain skeleton loading indicators (animate-pulse)
    const pulses = document.querySelectorAll('.animate-pulse')
    expect(pulses.length).toBeGreaterThan(0)

    vi.unstubAllGlobals()
  })

  describe('keyboard navigation in overlay mode', () => {
    function setUpOverlayModeArticles() {
      mockSettings.articleOpenMode = 'overlay' as any
      mockSettings.keyboardNavigation = 'on' as any
      swrInfiniteReturn = {
        data: [{
          articles: [
            makeArticle({ id: 1, title: 'First Article', url: 'https://example.com/1' }),
            makeArticle({ id: 2, title: 'Second Article', url: 'https://example.com/2' }),
          ],
          total: 2,
          has_more: false,
        }],
        error: undefined,
        size: 1,
        setSize: vi.fn(),
        isLoading: false,
        isValidating: false,
        mutate: vi.fn(),
      }
    }

    it('j moves focus only and does not open the overlay when it is closed', () => {
      setUpOverlayModeArticles()
      renderArticleList()

      fireEvent.keyDown(document, { key: 'j' })

      // Focus moved to the first article...
      const focusedEl = document.querySelector('[data-article-id="1"]')
      expect(focusedEl?.getAttribute('aria-selected')).toBe('true')
      // ...but the overlay must not have opened.
      expect(screen.queryByTestId('overlay')).toBeNull()
    })

    it('Enter opens the focused article in the overlay', () => {
      setUpOverlayModeArticles()
      renderArticleList()

      // First, move focus onto the first article (overlay stays closed).
      fireEvent.keyDown(document, { key: 'j' })
      expect(screen.queryByTestId('overlay')).toBeNull()

      // Enter opens it in the overlay.
      fireEvent.keyDown(document, { key: 'Enter' })
      expect(screen.getByTestId('overlay').textContent).toBe('https://example.com/1')
    })

    it('o opens the focused article in the overlay', () => {
      setUpOverlayModeArticles()
      renderArticleList()

      fireEvent.keyDown(document, { key: 'j' })
      fireEvent.keyDown(document, { key: 'o' })
      expect(screen.getByTestId('overlay').textContent).toBe('https://example.com/1')
    })

    it('j swaps the article shown in the overlay once it is already open', () => {
      setUpOverlayModeArticles()
      renderArticleList()

      // Focus + open the first article.
      fireEvent.keyDown(document, { key: 'j' })
      fireEvent.keyDown(document, { key: 'Enter' })
      expect(screen.getByTestId('overlay').textContent).toBe('https://example.com/1')

      // With the overlay open, j swaps to the next article in place.
      fireEvent.keyDown(document, { key: 'j' })
      expect(screen.getByTestId('overlay').textContent).toBe('https://example.com/2')
      const focusedEl = document.querySelector('[data-article-id="2"]')
      expect(focusedEl?.getAttribute('aria-selected')).toBe('true')
    })
  })

  describe('auto-mark-read on keyboard advance (j/k)', () => {
    function setUpKeyboardNavArticles() {
      mockSettings.articleOpenMode = 'page' as any
      mockSettings.keyboardNavigation = 'on' as any
      swrInfiniteReturn = {
        data: [{
          articles: [
            makeArticle({ id: 1, title: 'First Article', url: 'https://example.com/1', seen_at: null }),
            makeArticle({ id: 2, title: 'Second Article', url: 'https://example.com/2', seen_at: null }),
            makeArticle({ id: 3, title: 'Third Article', url: 'https://example.com/3', seen_at: null }),
          ],
          total: 3,
          has_more: false,
        }],
        error: undefined,
        size: 1,
        setSize: vi.fn(),
        isLoading: false,
        isValidating: false,
        mutate: vi.fn(),
      }
    }

    function unreadFlag(id: number) {
      return document.querySelector(`[data-article-id="${id}"]`)?.getAttribute('data-article-unread')
    }

    it('j advance marks the previously focused article read when autoMarkRead is on', () => {
      mockSettings.autoMarkRead = 'on' as any
      setUpKeyboardNavArticles()
      renderArticleList()

      // First j: no previous focus yet, nothing is marked.
      fireEvent.keyDown(document, { key: 'j' })
      expect(unreadFlag(1)).toBe('1')

      // Second j: advances from article 1 to article 2 — article 1 is now read.
      fireEvent.keyDown(document, { key: 'j' })
      expect(unreadFlag(1)).toBe('0')
      expect(unreadFlag(2)).toBe('1')
    })

    it('k backward move does not mark anything read', () => {
      mockSettings.autoMarkRead = 'on' as any
      setUpKeyboardNavArticles()
      renderArticleList()

      // Move forward to article 3 (marking 1 and 2 read along the way).
      fireEvent.keyDown(document, { key: 'j' })
      fireEvent.keyDown(document, { key: 'j' })
      fireEvent.keyDown(document, { key: 'j' })
      expect(unreadFlag(1)).toBe('0')
      expect(unreadFlag(2)).toBe('0')
      expect(unreadFlag(3)).toBe('1')

      // Moving backward from article 3 to article 2 must not mark article 3 read.
      fireEvent.keyDown(document, { key: 'k' })
      expect(unreadFlag(3)).toBe('1')
    })

    it('does not mark anything read when autoMarkRead is off', () => {
      mockSettings.autoMarkRead = 'off' as any
      setUpKeyboardNavArticles()
      renderArticleList()

      fireEvent.keyDown(document, { key: 'j' })
      fireEvent.keyDown(document, { key: 'j' })
      expect(unreadFlag(1)).toBe('1')
      expect(unreadFlag(2)).toBe('1')
    })
  })

  describe('unread-only toggle', () => {
    function keyFor(pageIndex: number) {
      return lastGetKey!(pageIndex, null)!
    }

    it('is offered on feed views', () => {
      renderArticleList('/feeds/1')
      expect(screen.getByRole('button', { name: 'Unread only' })).toBeTruthy()
    })

    it('is hidden on collection views', () => {
      renderArticleList('/bookmarks')
      expect(screen.queryByRole('button', { name: 'Unread only' })).toBeNull()
    })

    it('does not filter while the setting is off', () => {
      renderArticleList('/feeds/1')
      expect(keyFor(0)).not.toContain('unread=1')
      expect(screen.getByRole('button', { name: 'Unread only' }).getAttribute('aria-pressed')).toBe('false')
    })

    it('filters on the unread flag with a stable anchor while the setting is on', () => {
      mockSettings.categoryUnreadOnly = 'on' as any
      renderArticleList('/feeds/1')

      const page0 = new URL(keyFor(0), 'http://x')
      const page1 = new URL(keyFor(1), 'http://x')
      expect(page0.searchParams.get('unread')).toBe('1')
      // The same anchor on every page is what keeps OFFSET paging from skipping
      // articles as they get marked read
      const anchor = page0.searchParams.get('unread_since')
      expect(anchor).toBeTruthy()
      expect(page1.searchParams.get('unread_since')).toBe(anchor)
      expect(page1.searchParams.get('offset')).toBe('20')
      expect(screen.getByRole('button', { name: 'Unread only' }).getAttribute('aria-pressed')).toBe('true')
    })

    it('turns the persisted setting on when clicked while off', () => {
      renderArticleList('/feeds/1')
      fireEvent.click(screen.getByRole('button', { name: 'Unread only' }))
      expect(mockSettings.setCategoryUnreadOnly).toHaveBeenCalledWith('on')
    })

    it('turns the persisted setting off when clicked while on', () => {
      mockSettings.categoryUnreadOnly = 'on' as any
      renderArticleList('/feeds/1')
      fireEvent.click(screen.getByRole('button', { name: 'Unread only' }))
      expect(mockSettings.setCategoryUnreadOnly).toHaveBeenCalledWith('off')
    })
  })
})
