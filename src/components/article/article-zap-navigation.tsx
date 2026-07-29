import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useKeyboardNavigationContext } from '../../contexts/keyboard-navigation-context'
import { useKeyboardNavigation } from '../../hooks/use-keyboard-navigation'
import { useAppLayout } from '../../app'

import { articleUrlToPath } from '../../lib/url'

interface ArticleZapNavigationProps {
  currentArticleId: string
  onBookmarkToggle?: () => void
  onOpenExternal?: () => void
  onToggleRead?: () => void
}

export function ArticleZapNavigation({ currentArticleId, onBookmarkToggle, onOpenExternal, onToggleRead }: ArticleZapNavigationProps) {
  const navigate = useNavigate()
  const { articleIds, articleUrls, setFocusedItemId, lastListUrl } = useKeyboardNavigationContext()
  const { settings: { keyboardNavigation, keybindings } } = useAppLayout()

  useKeyboardNavigation({
    items: articleIds,
    focusedItemId: currentArticleId,
    onFocusChange: (id) => {
      setFocusedItemId(id)
      const url = articleUrls[id]
      if (url) void navigate(articleUrlToPath(url))
    },
    onBookmarkToggle: onBookmarkToggle ? () => onBookmarkToggle() : undefined,
    onOpenExternal: onOpenExternal ? () => onOpenExternal() : undefined,
    onToggleRead: onToggleRead ? () => onToggleRead() : undefined,
    onEscape: () => {
      void navigate(lastListUrl || '/all')
    },
    enabled: keyboardNavigation === 'on' && articleIds.length > 0,
    keyBindings: keybindings,
  })

  useEffect(() => {
    setFocusedItemId(currentArticleId)
  }, [currentArticleId, setFocusedItemId])

  return null
}
