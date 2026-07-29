import { useEffect } from 'react'

interface UseKeyboardShortcutsHelpOptions {
  enabled: boolean
  onShow: () => void
}

/**
 * Feedly-style '?' shortcut that opens the keyboard shortcuts help dialog.
 * Mounted at the top of the app so it works on both list and detail/overlay views.
 */
export function useKeyboardShortcutsHelp({ enabled, onShow }: UseKeyboardShortcutsHelpOptions) {
  useEffect(() => {
    if (!enabled) return

    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement
      const isInput =
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) ||
        target.isContentEditable ||
        (typeof target.getAttribute === 'function' && target.getAttribute('contenteditable') === 'true')

      if (isInput) return

      // Skip when a non-passthrough dialog (e.g. this same help dialog) is already open
      const openDialog = document.querySelector('[role="dialog"][data-state="open"]:not([data-keyboard-nav-passthrough])')
      if (openDialog) return

      if (e.key === '?') {
        e.preventDefault()
        onShow()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [enabled, onShow])
}
