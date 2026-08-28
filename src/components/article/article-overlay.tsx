import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { Dialog, DialogPortal, DialogOverlay, DialogTitle } from '../ui/dialog'
import { useHistoryDismiss } from '../../hooks/use-history-dismiss'
import { useSwipeDismiss } from '../../hooks/use-swipe-dismiss'
import { ArticleDetail } from './article-detail'
import { ArticleNavArrows } from './article-nav-arrows'

interface ArticleOverlayProps {
  articleUrl: string | null
  onClose: () => void
  /** Swap the article shown in the overlay (used by the prev/next nav arrows) */
  onNavigate?: (url: string) => void
}

const OVERLAY_HISTORY_KEY = 'article-overlay'

export function ArticleOverlay({ articleUrl, onClose, onNavigate }: ArticleOverlayProps) {
  // Back gesture / back button closes the overlay instead of navigating the
  // list page behind it away
  useHistoryDismiss(!!articleUrl, onClose, OVERLAY_HISTORY_KEY)
  const swipeHandlers = useSwipeDismiss(onClose)

  return (
    <Dialog open={!!articleUrl} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogPortal>
        <DialogOverlay className="duration-300" />
        <DialogPrimitive.Content
          className="fixed inset-y-0 right-0 z-[70] w-full [--article-bottom-bar:3rem] md:[--article-bottom-bar:0px] md:left-[var(--article-overlay-left)] md:w-auto bg-bg shadow-2xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right duration-300"
          aria-describedby={undefined}
          data-keyboard-nav-passthrough=""
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          {...swipeHandlers}
        >
          {/* Scrollable inner wrapper — kept separate from the fixed Content box so the
              action bar and nav arrows below can stay pinned to the panel's edges
              without scrolling away. The padding keeps the article clear of the bar,
              which sits at the bottom on mobile and at the top from md up. */}
          <div className="h-full overflow-y-auto overscroll-contain pt-[var(--safe-area-inset-top)] pb-[calc(3rem+var(--safe-area-inset-bottom))] md:pb-0 md:pt-[calc(3rem+var(--safe-area-inset-top))]">
            <DialogTitle className="sr-only">Article</DialogTitle>
            {articleUrl && <ArticleDetail articleUrl={articleUrl} />}
          </div>
          {/* Close + prev/next bar. On phones it sits at the bottom, within thumb
              reach; from md up it stays at the top of the panel as a header. */}
          <div
            className="absolute inset-x-0 bottom-0 z-10 flex items-center h-[calc(3rem+var(--safe-area-inset-bottom))] pb-[var(--safe-area-inset-bottom)] px-4 bg-bg/80 backdrop-blur-sm border-t border-border md:bottom-auto md:top-0 md:h-[calc(3rem+var(--safe-area-inset-top))] md:pb-0 md:pt-[var(--safe-area-inset-top)] md:border-t-0 md:border-b"
          >
            <button
              onClick={onClose}
              className="flex items-center justify-center w-8 h-8 rounded-full hover:bg-hover transition-colors"
              aria-label="Close"
            >
              <X className="w-5 h-5 text-muted" />
            </button>
            {/* Mobile has no room for the edge chevrons — the same prev/next
                navigation lives in this bar instead. */}
            {articleUrl && <ArticleNavArrows currentArticleUrl={articleUrl} onNavigate={onNavigate} variant="header" />}
          </div>
          {articleUrl && <ArticleNavArrows currentArticleUrl={articleUrl} onNavigate={onNavigate} variant="overlay" />}
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  )
}
