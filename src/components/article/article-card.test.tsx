import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { LocaleContext } from '../../lib/i18n'
import { ArticleCard, type ArticleDisplayConfig } from './article-card'
import type { ArticleListItem } from '../../../shared/types'

const mockNavigate = vi.fn()

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

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

const defaultDisplayConfig: ArticleDisplayConfig = {
  dateMode: 'relative',
  indicatorStyle: 'dot',
  showUnreadIndicator: true,
  showThumbnails: false,
}

function renderListCard(props: Partial<React.ComponentProps<typeof ArticleCard>> = {}) {
  return render(
    <MemoryRouter>
      <LocaleContext.Provider value={{ locale: 'en', setLocale: vi.fn() }}>
        <ArticleCard
          article={makeArticle()}
          layout="list"
          {...defaultDisplayConfig}
          onToggleBookmark={vi.fn()}
          onToggleLike={vi.fn()}
          {...props}
        />
      </LocaleContext.Provider>
    </MemoryRouter>,
  )
}

describe('ArticleCard list layout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockNavigate.mockClear()
  })

  describe('bookmark button', () => {
    it('calls onToggleBookmark and does not navigate', () => {
      const onToggleBookmark = vi.fn()
      renderListCard({ onToggleBookmark })

      const btn = screen.getByLabelText('Read later')
      fireEvent.click(btn)

      expect(onToggleBookmark).toHaveBeenCalledOnce()
      expect(mockNavigate).not.toHaveBeenCalled()
    })

    it('has correct aria states and tooltip when not bookmarked', () => {
      renderListCard({
        article: makeArticle({ bookmarked_at: null }),
      })

      const btn = screen.getByLabelText('Read later')
      expect(btn.getAttribute('aria-pressed')).toBe('false')
      expect(btn.getAttribute('title')).toBe('Read later')
      expect(btn.getAttribute('aria-label')).toBe('Read later')
    })

    it('has correct aria states and tooltip when bookmarked', () => {
      renderListCard({
        article: makeArticle({ bookmarked_at: '2026-01-02T00:00:00Z' }),
      })

      const btn = screen.getByLabelText('Remove from read later')
      expect(btn.getAttribute('aria-pressed')).toBe('true')
      expect(btn.getAttribute('title')).toBe('Remove from read later')
      expect(btn.getAttribute('aria-label')).toBe('Remove from read later')
    })
  })

  describe('like button', () => {
    it('calls onToggleLike and does not navigate', () => {
      const onToggleLike = vi.fn()
      renderListCard({ onToggleLike })

      const btn = screen.getByLabelText('Like')
      fireEvent.click(btn)

      expect(onToggleLike).toHaveBeenCalledOnce()
      expect(mockNavigate).not.toHaveBeenCalled()
    })

    it('has correct aria states and tooltip when not liked', () => {
      renderListCard({
        article: makeArticle({ liked_at: null }),
      })

      const btn = screen.getByLabelText('Like')
      expect(btn.getAttribute('aria-pressed')).toBe('false')
      expect(btn.getAttribute('title')).toBe('Like')
      expect(btn.getAttribute('aria-label')).toBe('Like')
    })

    it('has correct aria states and tooltip when liked', () => {
      renderListCard({
        article: makeArticle({ liked_at: '2026-01-02T00:00:00Z' }),
      })

      const btn = screen.getByLabelText('Unlike')
      expect(btn.getAttribute('aria-pressed')).toBe('true')
      expect(btn.getAttribute('title')).toBe('Unlike')
      expect(btn.getAttribute('aria-label')).toBe('Unlike')
    })
  })

  it('does not render bookmark/like buttons when callbacks are omitted', () => {
    renderListCard({ onToggleBookmark: undefined, onToggleLike: undefined })

    expect(screen.queryByRole('button', { name: /read later/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /like/i })).toBeNull()
  })

  it('navigates when the card is clicked outside buttons', () => {
    renderListCard()

    const link = screen.getByRole('link')
    fireEvent.click(link)

    expect(mockNavigate).toHaveBeenCalledOnce()
  })

  it('uses japanese labels when locale is ja', () => {
    const { rerender } = render(
      <MemoryRouter>
        <LocaleContext.Provider value={{ locale: 'ja', setLocale: vi.fn() }}>
          <ArticleCard
            article={makeArticle({ bookmarked_at: null, liked_at: null })}
            layout="list"
            {...defaultDisplayConfig}
            onToggleBookmark={vi.fn()}
            onToggleLike={vi.fn()}
          />
        </LocaleContext.Provider>
      </MemoryRouter>,
    )

    expect(screen.getByLabelText('後で読む')).toBeTruthy()
    expect(screen.getByLabelText('いいね')).toBeTruthy()

    rerender(
      <MemoryRouter>
        <LocaleContext.Provider value={{ locale: 'ja', setLocale: vi.fn() }}>
          <ArticleCard
            article={makeArticle({ bookmarked_at: '2026-01-02T00:00:00Z', liked_at: '2026-01-02T00:00:00Z' })}
            layout="list"
            {...defaultDisplayConfig}
            onToggleBookmark={vi.fn()}
            onToggleLike={vi.fn()}
          />
        </LocaleContext.Provider>
      </MemoryRouter>,
    )

    expect(screen.getByLabelText('後で読むを解除')).toBeTruthy()
    expect(screen.getByLabelText('いいねを解除')).toBeTruthy()
  })
})
