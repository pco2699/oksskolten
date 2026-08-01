import { useEffect, useRef } from 'react'

/**
 * Keeps a history entry alive while an in-app layer (overlay, drawer, ...) is
 * open, so the browser back gesture / hardware back button dismisses that layer
 * instead of navigating the page behind it away.
 *
 * Closing the layer by any other means (close button, Escape, backdrop) pops the
 * entry back off, keeping the history stack balanced — otherwise the user would
 * have to press back twice to actually leave the page.
 */
export function useHistoryDismiss(isOpen: boolean, onDismiss: () => void, stateKey: string) {
  // Kept in a ref so a new inline callback each render doesn't resubscribe
  const onDismissRef = useRef(onDismiss)
  onDismissRef.current = onDismiss

  useEffect(() => {
    if (isOpen) {
      if (!history.state?.[stateKey]) {
        history.pushState({ [stateKey]: true }, '')
      }
      return
    }
    // Closed without a back navigation — drop the entry we pushed.
    // (When the back gesture is what closed it, popstate already removed it.)
    if (history.state?.[stateKey]) {
      history.back()
    }
  }, [isOpen, stateKey])

  useEffect(() => {
    if (!isOpen) return
    const onPopState = () => onDismissRef.current()
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [isOpen])
}
