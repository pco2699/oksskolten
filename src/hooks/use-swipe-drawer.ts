import { useCallback, useEffect, useRef } from 'react'
import { MD_BREAKPOINT } from '../lib/breakpoints'

const DRAWER_STATE_KEY = 'drawer-open'

/**
 * A modal (article overlay, confirm dialog, ...) is on top of the page.
 * Radix portals its content to <body> and marks it with data-state.
 * Swipes belong to that layer, not to the drawer underneath it.
 */
function isModalOpen(): boolean {
  return document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]') !== null
}

/**
 * Swipe to open/close the sidebar drawer on mobile.
 * Also pushes a history entry when the drawer opens so that the native
 * back gesture (or hardware back button) closes the drawer instead of
 * navigating away.
 */
export function useSwipeDrawer(
  isOpen: boolean,
  setOpen: (open: boolean) => void,
) {
  const touchStart = useRef<{ x: number; y: number } | null>(null)

  // Stable close callback that doesn't re-trigger history management
  const closeDrawer = useCallback(() => setOpen(false), [setOpen])

  // Push/pop history entry when drawer opens/closes
  useEffect(() => {
    if (window.innerWidth >= MD_BREAKPOINT) return

    if (isOpen) {
      // Only push if we haven't already
      if (!history.state?.[DRAWER_STATE_KEY]) {
        history.pushState({ [DRAWER_STATE_KEY]: true }, '')
      }
    }
  }, [isOpen])

  // Listen for popstate to close drawer on back navigation
  useEffect(() => {
    const onPopState = () => {
      if (!isOpen) return
      // Desktop: the sidebar is part of the layout, not a history-backed layer.
      // No entry was ever pushed for it, so a back navigation is never ours.
      if (window.innerWidth >= MD_BREAKPOINT) return
      // A layer stacked on top of the drawer (article overlay, dialog) popped its
      // own entry — ours is current again, so the drawer stays open.
      if (history.state?.[DRAWER_STATE_KEY]) return
      closeDrawer()
    }

    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [isOpen, closeDrawer])

  // Swipe gestures
  useEffect(() => {
    const onTouchStart = (e: TouchEvent) => {
      if (window.innerWidth >= MD_BREAKPOINT) return
      if (isModalOpen()) return
      const touch = e.touches[0]
      touchStart.current = { x: touch.clientX, y: touch.clientY }
    }

    const onTouchEnd = (e: TouchEvent) => {
      if (!touchStart.current) return
      if (window.innerWidth >= MD_BREAKPOINT) return

      const touch = e.changedTouches[0]
      const dx = touch.clientX - touchStart.current.x
      const dy = touch.clientY - touchStart.current.y

      // Require horizontal swipe (dx significant, not mostly vertical)
      if (Math.abs(dx) < 60 || Math.abs(dy) > Math.abs(dx)) {
        touchStart.current = null
        return
      }

      if (!isOpen && dx > 0) {
        // Right swipe anywhere → open
        setOpen(true)
      } else if (isOpen && dx < 0) {
        // Left swipe while open → go back (which triggers popstate → close)
        history.back()
      }

      touchStart.current = null
    }

    document.addEventListener('touchstart', onTouchStart, { passive: true })
    document.addEventListener('touchend', onTouchEnd, { passive: true })
    return () => {
      document.removeEventListener('touchstart', onTouchStart)
      document.removeEventListener('touchend', onTouchEnd)
    }
  }, [isOpen, setOpen])
}
