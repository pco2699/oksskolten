import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { LocaleContext } from '../../lib/i18n'

let mockContextValue: any = {
  articleIds: ['1', '2', '3'],
  articleUrls: {
    '1': 'https://example.com/1',
    '2': 'https://example.com/2',
    '3': 'https://example.com/3',
  },
}
vi.mock('../../contexts/keyboard-navigation-context', () => ({
  useKeyboardNavigationContext: () => mockContextValue,
}))

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

import { ArticleNavArrows } from './article-nav-arrows'

function renderArrows(props: Partial<React.ComponentProps<typeof ArticleNavArrows>> = {}) {
  return render(
    <MemoryRouter>
      <LocaleContext.Provider value={{ locale: 'en', setLocale: vi.fn() }}>
        <ArticleNavArrows currentArticleUrl="https://example.com/2" {...props} />
      </LocaleContext.Provider>
    </MemoryRouter>,
  )
}

describe('ArticleNavArrows', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockContextValue = {
      articleIds: ['1', '2', '3'],
      articleUrls: {
        '1': 'https://example.com/1',
        '2': 'https://example.com/2',
        '3': 'https://example.com/3',
      },
    }
  })

  it('renders nothing when the current article is not in the list', () => {
    renderArrows({ currentArticleUrl: 'https://example.com/unknown' })
    expect(screen.queryByLabelText('Previous article')).toBeNull()
  })

  it('renders nothing when the list is empty', () => {
    mockContextValue = { articleIds: [], articleUrls: {} }
    renderArrows()
    expect(screen.queryByLabelText('Previous article')).toBeNull()
  })

  it('disables the prev button at the start of the list', () => {
    renderArrows({ currentArticleUrl: 'https://example.com/1' })
    expect((screen.getByLabelText('Previous article') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByLabelText('Next article') as HTMLButtonElement).disabled).toBe(false)
  })

  it('disables the next button at the end of the list', () => {
    renderArrows({ currentArticleUrl: 'https://example.com/3' })
    expect((screen.getByLabelText('Next article') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByLabelText('Previous article') as HTMLButtonElement).disabled).toBe(false)
  })

  it('navigates via react-router in page mode (no onNavigate provided)', () => {
    renderArrows()
    screen.getByLabelText('Next article').click()
    expect(mockNavigate).toHaveBeenCalledWith('/example.com/3')
  })

  it('calls onNavigate instead of the router when provided (overlay mode)', () => {
    const onNavigate = vi.fn()
    renderArrows({ onNavigate, variant: 'overlay' })
    screen.getByLabelText('Previous article').click()
    expect(onNavigate).toHaveBeenCalledWith('https://example.com/1')
    expect(mockNavigate).not.toHaveBeenCalled()
  })
})
