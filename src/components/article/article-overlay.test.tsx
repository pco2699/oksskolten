import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { LocaleContext } from '../../lib/i18n'

vi.mock('./article-detail', () => ({
  ArticleDetail: ({ articleUrl }: { articleUrl: string }) => <div data-testid="detail">{articleUrl}</div>,
}))

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

import { ArticleOverlay } from './article-overlay'

function makeTouch(clientX: number, clientY: number): Touch {
  return { identifier: 0, target: document, clientX, clientY } as unknown as Touch
}

function renderOverlay(props: Partial<React.ComponentProps<typeof ArticleOverlay>> = {}) {
  const onClose = props.onClose ?? vi.fn()
  const result = render(
    <MemoryRouter>
      <LocaleContext.Provider value={{ locale: 'en', setLocale: vi.fn() }}>
        <ArticleOverlay articleUrl="https://example.com/2" onClose={onClose} {...props} />
      </LocaleContext.Provider>
    </MemoryRouter>,
  )
  return { ...result, onClose }
}

describe('ArticleOverlay', () => {
  let backSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    history.replaceState({}, '')
    backSpy = vi.spyOn(history, 'back').mockImplementation(() => {})
  })

  afterEach(() => {
    backSpy.mockRestore()
  })

  it('pushes a history entry while open so the back gesture has something to pop', () => {
    renderOverlay()
    expect(history.state).toEqual({ 'article-overlay': true })
  })

  it('does not touch history when closed', () => {
    renderOverlay({ articleUrl: null })
    expect(history.state).toEqual({})
    expect(backSpy).not.toHaveBeenCalled()
  })

  it('closes on the back gesture instead of navigating the page behind it', () => {
    const { onClose } = renderOverlay()

    window.dispatchEvent(new PopStateEvent('popstate'))

    expect(onClose).toHaveBeenCalled()
  })

  it('closes on a horizontal swipe across the panel', () => {
    const { onClose } = renderOverlay()
    const panel = screen.getByTestId('detail').closest('[role="dialog"]')!

    // changedTouches is set too: the scroll-lock side car reads it on every touch event
    fireEvent.touchStart(panel, { touches: [makeTouch(300, 500)], changedTouches: [makeTouch(300, 500)] })
    fireEvent.touchEnd(panel, { changedTouches: [makeTouch(180, 505)] })

    expect(onClose).toHaveBeenCalled()
  })

  it('does not close on a vertical scroll gesture', () => {
    const { onClose } = renderOverlay()
    const panel = screen.getByTestId('detail').closest('[role="dialog"]')!

    // changedTouches is set too: the scroll-lock side car reads it on every touch event
    fireEvent.touchStart(panel, { touches: [makeTouch(300, 500)], changedTouches: [makeTouch(300, 500)] })
    fireEvent.touchEnd(panel, { changedTouches: [makeTouch(290, 200)] })

    expect(onClose).not.toHaveBeenCalled()
  })

  it('renders both the mobile header arrows and the desktop edge arrows', () => {
    renderOverlay()
    // One header-variant pair (md:hidden) + one edge pair (hidden md:flex)
    expect(screen.getAllByLabelText('Previous article')).toHaveLength(2)
    expect(screen.getAllByLabelText('Next article')).toHaveLength(2)
  })

  it('swaps the article in place from the header arrows', () => {
    const onNavigate = vi.fn()
    renderOverlay({ onNavigate })

    const [headerNext] = screen.getAllByLabelText('Next article')
    headerNext.click()

    expect(onNavigate).toHaveBeenCalledWith('https://example.com/3')
  })
})
