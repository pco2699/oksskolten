import { useEffect, useRef } from 'react'

export interface KeyBindings {
  next: string
  prev: string
  bookmark: string
  openExternal: string
}

export const DEFAULT_KEY_BINDINGS: KeyBindings = {
  next: 'j',
  prev: 'k',
  bookmark: 'b',
  openExternal: ';',
}

/** Number of items from the end at which onNearEnd fires */
const NEAR_END_THRESHOLD = 5

interface UseKeyboardNavigationOptions {
  items: string[]
  focusedItemId: string | null
  onFocusChange: (id: string) => void
  onEnter?: (id: string) => void
  onEscape?: () => void
  onBookmarkToggle?: (id: string) => void
  onOpenExternal?: (id: string) => void
  /** 'm' — toggle read/unread state of the focused/current article */
  onToggleRead?: (id: string) => void
  /** Shift+A — mark all articles in the current list view as read */
  onMarkAllRead?: () => void
  onNearEnd?: () => void
  enabled: boolean
  keyBindings?: KeyBindings
}

export function useKeyboardNavigation(options: UseKeyboardNavigationOptions) {
  // Keep latest options in a ref so the event listener always sees current values
  // without needing to re-attach on every render.
  const optionsRef = useRef(options)
  optionsRef.current = options

  useEffect(() => {
    if (!options.enabled) return

    function handleKeyDown(e: KeyboardEvent) {
      const { items, focusedItemId, onFocusChange, onEnter, onEscape, onBookmarkToggle, onOpenExternal, onToggleRead, onMarkAllRead, onNearEnd, keyBindings } = optionsRef.current
      const bindings = keyBindings ?? DEFAULT_KEY_BINDINGS

      const target = e.target as HTMLElement
      const isInput =
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) ||
        target.isContentEditable ||
        (typeof target.getAttribute === 'function' && target.getAttribute('contenteditable') === 'true')

      if (isInput) return

      // Check for open dialogs/modals (skip article overlay which allows j/k)
      const openDialog = document.querySelector('[role="dialog"][data-state="open"]:not([data-keyboard-nav-passthrough])')
      if (openDialog) return

      const { key } = e

      if (key === bindings.next || key === bindings.prev) {
        if (items.length === 0) return

        if (focusedItemId === null) {
          onFocusChange(items[0])
          return
        }

        const currentIndex = items.indexOf(focusedItemId)
        if (currentIndex === -1) {
          // If not in list, j goes to first, k goes to last (or vice versa)
          if (key === bindings.next) {
            onFocusChange(items[0])
          } else {
            onFocusChange(items[items.length - 1])
          }
          return
        }

        if (key === bindings.next) {
          const nextIndex = currentIndex + 1
          if (nextIndex < items.length) {
            onFocusChange(items[nextIndex])
            if (items.length - nextIndex <= NEAR_END_THRESHOLD && onNearEnd) {
              onNearEnd()
            }
          }
        } else {
          const prevIndex = currentIndex - 1
          if (prevIndex >= 0) {
            onFocusChange(items[prevIndex])
          }
        }
        return
      }

      // Feedly-style 'o' opens the focused item the same way Enter does (list view).
      // In views that don't wire up onEnter (e.g. the article detail/overlay reader),
      // this is a no-op, matching Feedly's toggle-close behavior closely enough.
      if ((key === 'Enter' || key === 'o') && focusedItemId && onEnter) {
        onEnter(focusedItemId)
        return
      }

      if (key === 'Escape' && onEscape) {
        // If a passthrough dialog (e.g. article overlay) is open, let it handle Escape
        if (document.querySelector('[data-keyboard-nav-passthrough][data-state="open"]')) return
        onEscape()
        return
      }

      // 's' is a fixed Feedly-style alias for the configurable bookmark/save binding.
      if ((key === bindings.bookmark || key === 's') && focusedItemId && onBookmarkToggle) {
        onBookmarkToggle(focusedItemId)
        return
      }

      // 'v' is a fixed Feedly-style alias for the configurable open-external binding.
      if ((key === bindings.openExternal || key === 'v') && focusedItemId && onOpenExternal) {
        onOpenExternal(focusedItemId)
        return
      }

      if (key === 'm' && focusedItemId && onToggleRead) {
        onToggleRead(focusedItemId)
        return
      }

      if (key === 'A' && e.shiftKey && onMarkAllRead) {
        onMarkAllRead()
        return
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [options.enabled])
}
