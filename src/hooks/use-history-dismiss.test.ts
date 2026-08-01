import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useHistoryDismiss } from './use-history-dismiss'

const KEY = 'test-layer'

describe('useHistoryDismiss', () => {
  let onDismiss: () => void
  let pushSpy: ReturnType<typeof vi.spyOn>
  let backSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    onDismiss = vi.fn()
    history.replaceState({}, '')
    pushSpy = vi.spyOn(history, 'pushState')
    backSpy = vi.spyOn(history, 'back').mockImplementation(() => {})
  })

  afterEach(() => {
    pushSpy.mockRestore()
    backSpy.mockRestore()
  })

  it('pushes a history entry when the layer opens', () => {
    renderHook(() => useHistoryDismiss(true, onDismiss, KEY))
    expect(pushSpy).toHaveBeenCalledWith({ [KEY]: true }, '')
  })

  it('does not push when the layer is closed', () => {
    renderHook(() => useHistoryDismiss(false, onDismiss, KEY))
    expect(pushSpy).not.toHaveBeenCalled()
  })

  it('does not push twice when the entry is already ours', () => {
    history.replaceState({ [KEY]: true }, '')
    renderHook(() => useHistoryDismiss(true, onDismiss, KEY))
    expect(pushSpy).not.toHaveBeenCalled()
  })

  it('dismisses on popstate while open', () => {
    renderHook(() => useHistoryDismiss(true, onDismiss, KEY))
    window.dispatchEvent(new PopStateEvent('popstate'))
    expect(onDismiss).toHaveBeenCalled()
  })

  it('ignores popstate while closed', () => {
    renderHook(() => useHistoryDismiss(false, onDismiss, KEY))
    window.dispatchEvent(new PopStateEvent('popstate'))
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('pops its entry when closed by other means', () => {
    const { rerender } = renderHook(
      ({ open }) => useHistoryDismiss(open, onDismiss, KEY),
      { initialProps: { open: true } },
    )
    // pushState is spied but not stubbed, so the state is really applied
    expect(history.state).toEqual({ [KEY]: true })

    rerender({ open: false })
    expect(backSpy).toHaveBeenCalled()
  })

  it('does not pop again when the back navigation is what closed it', () => {
    history.replaceState({}, '')
    const { rerender } = renderHook(
      ({ open }) => useHistoryDismiss(open, onDismiss, KEY),
      { initialProps: { open: false } },
    )
    rerender({ open: false })
    expect(backSpy).not.toHaveBeenCalled()
  })

  it('stops listening after unmount', () => {
    const { unmount } = renderHook(() => useHistoryDismiss(true, onDismiss, KEY))
    unmount()
    window.dispatchEvent(new PopStateEvent('popstate'))
    expect(onDismiss).not.toHaveBeenCalled()
  })
})
