import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useSwipeDismiss } from './use-swipe-dismiss'

function makeTouch(clientX: number, clientY: number): Touch {
  return { identifier: 0, target: document, clientX, clientY } as unknown as Touch
}

function Panel({ onDismiss }: { onDismiss: () => void }) {
  const handlers = useSwipeDismiss(onDismiss)
  return (
    <div data-testid="panel" {...handlers}>
      <div data-testid="content">article body</div>
      <pre data-testid="code">wide code block</pre>
    </div>
  )
}

function swipe(from: [number, number], to: [number, number], target = screen.getByTestId('content')) {
  fireEvent.touchStart(target, { touches: [makeTouch(...from)] })
  fireEvent.touchEnd(target, { changedTouches: [makeTouch(...to)] })
}

describe('useSwipeDismiss', () => {
  let onDismiss: () => void

  beforeEach(() => {
    onDismiss = vi.fn()
    render(<Panel onDismiss={onDismiss} />)
  })

  it('dismisses on a left swipe', () => {
    swipe([300, 400], [180, 410])
    expect(onDismiss).toHaveBeenCalled()
  })

  it('dismisses on a right swipe', () => {
    swipe([100, 400], [220, 390])
    expect(onDismiss).toHaveBeenCalled()
  })

  it('ignores short swipes', () => {
    swipe([300, 400], [260, 400])
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('ignores mostly vertical swipes (scrolling)', () => {
    swipe([300, 400], [230, 200])
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('ignores multi-touch gestures (pinch zoom)', () => {
    const target = screen.getByTestId('content')
    fireEvent.touchStart(target, { touches: [makeTouch(300, 400), makeTouch(200, 400)] })
    fireEvent.touchEnd(target, { changedTouches: [makeTouch(180, 400)] })
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('ignores a swipe that turns into a pinch mid-gesture', () => {
    const target = screen.getByTestId('content')
    fireEvent.touchStart(target, { touches: [makeTouch(300, 400)] })
    fireEvent.touchMove(target, { touches: [makeTouch(280, 400), makeTouch(200, 400)] })
    fireEvent.touchEnd(target, { changedTouches: [makeTouch(180, 400)] })
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('ignores swipes that start inside horizontally scrollable content', () => {
    const code = screen.getByTestId('code')
    code.style.overflowX = 'auto'
    Object.defineProperty(code, 'scrollWidth', { value: 800, configurable: true })
    Object.defineProperty(code, 'clientWidth', { value: 320, configurable: true })

    swipe([300, 400], [180, 400], code)
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('ignores a touch end without a matching start', () => {
    fireEvent.touchEnd(screen.getByTestId('content'), { changedTouches: [makeTouch(180, 400)] })
    expect(onDismiss).not.toHaveBeenCalled()
  })
})
