import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useSwipeDrawer } from './use-swipe-drawer'
import { MD_BREAKPOINT } from '../lib/breakpoints'

// jsdom does not provide Touch — create a minimal shim
function makeTouch(opts: { clientX: number; clientY: number }): Touch {
  return { identifier: 0, target: document, ...opts } as unknown as Touch
}

function fireTouchStart(clientX: number, clientY: number) {
  const e = new TouchEvent('touchstart', {
    touches: [makeTouch({ clientX, clientY })] as unknown as Touch[],
  })
  document.dispatchEvent(e)
}

function fireTouchEnd(clientX: number, clientY: number) {
  const e = new TouchEvent('touchend', {
    changedTouches: [makeTouch({ clientX, clientY })] as unknown as Touch[],
  })
  document.dispatchEvent(e)
}

describe('useSwipeDrawer', () => {
  let setOpen: (open: boolean) => void
  const originalInnerWidth = window.innerWidth

  beforeEach(() => {
    setOpen = vi.fn()
    // Simulate mobile viewport
    Object.defineProperty(window, 'innerWidth', { value: MD_BREAKPOINT - 1, writable: true, configurable: true })
    // Reset history state
    history.replaceState({}, '')
  })

  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', { value: originalInnerWidth, writable: true, configurable: true })
  })

  it('pushes history state when drawer opens on mobile', () => {
    const pushSpy = vi.spyOn(history, 'pushState')
    renderHook(() => useSwipeDrawer(true, setOpen))

    expect(pushSpy).toHaveBeenCalledWith({ 'drawer-open': true }, '')
    pushSpy.mockRestore()
  })

  it('does not push history on desktop', () => {
    Object.defineProperty(window, 'innerWidth', { value: MD_BREAKPOINT, writable: true, configurable: true })
    const pushSpy = vi.spyOn(history, 'pushState')

    renderHook(() => useSwipeDrawer(true, setOpen))

    expect(pushSpy).not.toHaveBeenCalled()
    pushSpy.mockRestore()
  })

  it('does not push history when drawer is closed', () => {
    const pushSpy = vi.spyOn(history, 'pushState')
    renderHook(() => useSwipeDrawer(false, setOpen))

    expect(pushSpy).not.toHaveBeenCalled()
    pushSpy.mockRestore()
  })

  it('does not duplicate push if already in drawer state', () => {
    history.replaceState({ 'drawer-open': true }, '')
    const pushSpy = vi.spyOn(history, 'pushState')

    renderHook(() => useSwipeDrawer(true, setOpen))

    expect(pushSpy).not.toHaveBeenCalled()
    pushSpy.mockRestore()
  })

  it('closes drawer on popstate event when open', () => {
    renderHook(() => useSwipeDrawer(true, setOpen))
    // Back navigation pops the entry the hook pushed before popstate fires
    history.replaceState({}, '')

    window.dispatchEvent(new PopStateEvent('popstate'))

    expect(setOpen).toHaveBeenCalledWith(false)
  })

  it('does not close drawer on popstate when already closed', () => {
    renderHook(() => useSwipeDrawer(false, setOpen))

    window.dispatchEvent(new PopStateEvent('popstate'))

    expect(setOpen).not.toHaveBeenCalled()
  })

  it('does not close sidebar on popstate on desktop', () => {
    Object.defineProperty(window, 'innerWidth', { value: MD_BREAKPOINT, writable: true, configurable: true })
    renderHook(() => useSwipeDrawer(true, setOpen))

    // An overlay dismissed via history.back() pops an entry the drawer never pushed
    window.dispatchEvent(new PopStateEvent('popstate'))

    expect(setOpen).not.toHaveBeenCalled()
  })

  it('keeps drawer open when a layer stacked on top pops its own entry', () => {
    renderHook(() => useSwipeDrawer(true, setOpen))
    // Overlay closed, drawer entry is current again
    history.replaceState({ 'drawer-open': true }, '')

    window.dispatchEvent(new PopStateEvent('popstate'))

    expect(setOpen).not.toHaveBeenCalled()
  })

  it('right swipe opens drawer when closed', () => {
    renderHook(() => useSwipeDrawer(false, setOpen))

    // Simulate swipe right (dx > 60)
    fireTouchStart(10, 100)
    fireTouchEnd(100, 100)

    expect(setOpen).toHaveBeenCalledWith(true)
  })

  it('left swipe calls history.back when open', () => {
    const backSpy = vi.spyOn(history, 'back').mockImplementation(() => {})
    renderHook(() => useSwipeDrawer(true, setOpen))

    // Simulate swipe left (dx < -60)
    fireTouchStart(200, 100)
    fireTouchEnd(100, 100)

    expect(backSpy).toHaveBeenCalled()
    backSpy.mockRestore()
  })

  it('ignores swipe if horizontal distance is too small', () => {
    renderHook(() => useSwipeDrawer(false, setOpen))

    // dx = 30, less than 60 threshold
    fireTouchStart(10, 100)
    fireTouchEnd(40, 100)

    expect(setOpen).not.toHaveBeenCalled()
  })

  it('ignores swipe if mostly vertical', () => {
    renderHook(() => useSwipeDrawer(false, setOpen))

    // dx = 70, dy = 100 — more vertical than horizontal
    fireTouchStart(10, 10)
    fireTouchEnd(80, 110)

    expect(setOpen).not.toHaveBeenCalled()
  })

  it('ignores touch events on desktop', () => {
    Object.defineProperty(window, 'innerWidth', { value: MD_BREAKPOINT, writable: true, configurable: true })
    renderHook(() => useSwipeDrawer(false, setOpen))

    fireTouchStart(10, 100)
    fireTouchEnd(100, 100)

    expect(setOpen).not.toHaveBeenCalled()
  })

  it('cleans up event listeners on unmount', () => {
    const removeSpy = vi.spyOn(document, 'removeEventListener')
    const { unmount } = renderHook(() => useSwipeDrawer(false, setOpen))

    unmount()

    const removedEvents = removeSpy.mock.calls.map(c => c[0])
    expect(removedEvents).toContain('touchstart')
    expect(removedEvents).toContain('touchend')
    removeSpy.mockRestore()
  })
})
