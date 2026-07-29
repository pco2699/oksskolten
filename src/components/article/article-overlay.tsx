import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { Dialog, DialogPortal, DialogOverlay, DialogTitle } from '../ui/dialog'
import { ArticleDetail } from './article-detail'
import { ArticleNavArrows } from './article-nav-arrows'

interface ArticleOverlayProps {
  articleUrl: string | null
  onClose: () => void
  /** Swap the article shown in the overlay (used by the prev/next nav arrows) */
  onNavigate?: (url: string) => void
}

export function ArticleOverlay({ articleUrl, onClose, onNavigate }: ArticleOverlayProps) {
  return (
    <Dialog open={!!articleUrl} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogPortal>
        <DialogOverlay className="duration-300" />
        <DialogPrimitive.Content
          className="fixed inset-y-0 right-0 z-[70] w-full md:left-12 md:w-auto bg-bg shadow-2xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right duration-300"
          aria-describedby={undefined}
          data-keyboard-nav-passthrough=""
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          {/* Scrollable inner wrapper — kept separate from the fixed Content box so the
              nav arrows below can stay pinned to the panel's edges without scrolling away. */}
          <div className="h-full overflow-y-auto overscroll-contain">
            <DialogTitle className="sr-only">Article</DialogTitle>
            {/* Close button */}
            <div className="sticky top-0 z-10 flex items-center h-12 px-4 bg-bg/80 backdrop-blur-sm border-b border-border" style={{ paddingTop: 'var(--safe-area-inset-top)' }}>
              <button
                onClick={onClose}
                className="flex items-center justify-center w-8 h-8 rounded-full hover:bg-hover transition-colors"
                aria-label="Close"
              >
                <X className="w-5 h-5 text-muted" />
              </button>
            </div>
            {articleUrl && <ArticleDetail articleUrl={articleUrl} />}
          </div>
          {articleUrl && <ArticleNavArrows currentArticleUrl={articleUrl} onNavigate={onNavigate} variant="overlay" />}
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  )
}
