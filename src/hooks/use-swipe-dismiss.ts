import { useRef } from 'react'

const SWIPE_DISTANCE = 60
/** Horizontal travel must dominate vertical travel by this factor */
const SWIPE_RATIO = 1.5

/**
 * Horizontal swipe on a panel → dismiss it. Returns touch handlers to spread
 * onto the panel element.
 *
 * Both directions dismiss: the panel slides in from the right, so swiping right
 * pushes it back out, while swiping left is what most readers reach for to
 * "go back" on a phone.
 *
 * Swipes that start inside a horizontally scrollable descendant (wide code
 * blocks, tables) are ignored so scrolling that content never closes the panel.
 */
export function useSwipeDismiss(onDismiss: () => void) {
  const start = useRef<{ x: number; y: number } | null>(null)

  const onTouchStart = (e: React.TouchEvent<HTMLElement>) => {
    if (e.touches.length !== 1 || startsInScrollableRow(e.target, e.currentTarget)) {
      start.current = null
      return
    }
    const touch = e.touches[0]
    start.current = { x: touch.clientX, y: touch.clientY }
  }

  // A second finger means pinch-zoom, not a swipe
  const onTouchMove = (e: React.TouchEvent<HTMLElement>) => {
    if (e.touches.length > 1) start.current = null
  }

  const onTouchEnd = (e: React.TouchEvent<HTMLElement>) => {
    const from = start.current
    start.current = null
    if (!from) return

    const touch = e.changedTouches[0]
    const dx = touch.clientX - from.x
    const dy = touch.clientY - from.y
    if (Math.abs(dx) < SWIPE_DISTANCE) return
    if (Math.abs(dx) < Math.abs(dy) * SWIPE_RATIO) return

    onDismiss()
  }

  return { onTouchStart, onTouchMove, onTouchEnd }
}

function startsInScrollableRow(target: EventTarget, boundary: Element): boolean {
  let el = target instanceof Element ? target : null
  while (el && el !== boundary) {
    if (el.scrollWidth > el.clientWidth + 1) {
      const overflowX = getComputedStyle(el).overflowX
      if (overflowX === 'auto' || overflowX === 'scroll') return true
    }
    el = el.parentElement
  }
  return false
}
