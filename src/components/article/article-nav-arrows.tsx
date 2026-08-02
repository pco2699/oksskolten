import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useKeyboardNavigationContext } from '../../contexts/keyboard-navigation-context'
import { useI18n } from '../../lib/i18n'
import { articleUrlToPath } from '../../lib/url'

interface ArticleNavArrowsProps {
  /** URL of the article currently being read */
  currentArticleUrl: string
  /**
   * Overlay mode: swap the article shown inside the dialog instead of
   * navigating with the router. Omit for page mode.
   */
  onNavigate?: (url: string) => void
  /**
   * 'page' anchors the arrows to the viewport edges (fixed positioning).
   * 'overlay' anchors them to the dialog panel's own box (absolute
   * positioning, since the panel establishes its own containing block).
   * 'header' renders them inline as a pair of buttons for a toolbar — the
   * mobile counterpart of the edge chevrons, which are desktop-only.
   */
  variant?: 'page' | 'overlay' | 'header'
}

/**
 * Feedly-style prev/next chevrons pinned to the edges of the reading view.
 * Hidden below the md breakpoint via CSS; touch-capable desktops (e.g.
 * touchscreen laptops report `pointer: coarse`) still get the arrows.
 */
export function ArticleNavArrows({ currentArticleUrl, onNavigate, variant = 'page' }: ArticleNavArrowsProps) {
  const navigate = useNavigate()
  const { articleIds, articleUrls } = useKeyboardNavigationContext()
  const { t } = useI18n()

  if (articleIds.length === 0) return null

  const currentId = Object.keys(articleUrls).find(id => articleUrls[id] === currentArticleUrl)
  const currentIndex = currentId ? articleIds.indexOf(currentId) : -1
  if (currentIndex === -1) return null

  const prevUrl = currentIndex > 0 ? articleUrls[articleIds[currentIndex - 1]] : null
  const nextUrl = currentIndex < articleIds.length - 1 ? articleUrls[articleIds[currentIndex + 1]] : null

  const goTo = (url: string | null) => {
    if (!url) return
    if (onNavigate) onNavigate(url)
    else void navigate(articleUrlToPath(url))
  }

  if (variant === 'header') {
    // Inline pair, mobile only — desktop keeps the edge chevrons.
    // Disabled ends stay visible (dimmed) so the buttons don't shift around.
    const headerButtonClass = 'flex h-8 w-8 items-center justify-center rounded-full hover:bg-hover transition-colors disabled:opacity-30 disabled:pointer-events-none'
    return (
      <div className="flex items-center gap-1 ml-auto md:hidden">
        <button
          type="button"
          onClick={() => goTo(prevUrl)}
          disabled={!prevUrl}
          aria-label={t('article.prevArticle')}
          className={headerButtonClass}
        >
          <ChevronLeft className="w-5 h-5 text-muted" />
        </button>
        <button
          type="button"
          onClick={() => goTo(nextUrl)}
          disabled={!nextUrl}
          aria-label={t('article.nextArticle')}
          className={headerButtonClass}
        >
          <ChevronRight className="w-5 h-5 text-muted" />
        </button>
      </div>
    )
  }

  const positionClass = variant === 'overlay' ? 'absolute' : 'fixed'
  const zIndexClass = variant === 'overlay' ? 'z-[80]' : 'z-30'
  const baseButtonClass = `hidden md:flex ${positionClass} top-1/2 -translate-y-1/2 ${zIndexClass} h-10 w-10 items-center justify-center rounded-full border border-border bg-bg-card hover:bg-hover transition-colors disabled:opacity-0 disabled:pointer-events-none`

  return (
    <>
      <button
        type="button"
        onClick={() => goTo(prevUrl)}
        disabled={!prevUrl}
        aria-label={t('article.prevArticle')}
        title={t('article.prevArticle')}
        className={`${baseButtonClass} left-4`}
      >
        <ChevronLeft className="w-5 h-5 text-muted" />
      </button>
      <button
        type="button"
        onClick={() => goTo(nextUrl)}
        disabled={!nextUrl}
        aria-label={t('article.nextArticle')}
        title={t('article.nextArticle')}
        className={`${baseButtonClass} right-4`}
      >
        <ChevronRight className="w-5 h-5 text-muted" />
      </button>
    </>
  )
}
