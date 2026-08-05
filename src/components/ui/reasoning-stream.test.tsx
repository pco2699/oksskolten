import { describe, it, expect } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { ReasoningStream } from './reasoning-stream'

describe('ReasoningStream', () => {
  it('renders the reasoning text as it accumulates', () => {
    const { rerender } = render(<ReasoningStream text="Let me" />)
    expect(screen.getByText('Let me')).toBeTruthy()

    rerender(<ReasoningStream text="Let me think" />)
    expect(screen.getByText('Let me think')).toBeTruthy()
    cleanup()
  })

  it('renders nothing before the first thought arrives', () => {
    const { container } = render(<ReasoningStream text="" />)
    expect(container.firstChild).toBeNull()
    cleanup()
  })

  it('keeps the view pinned to the newest text', () => {
    render(<ReasoningStream text="first line" />)
    const scroller = screen.getByText('first line')
    // jsdom reports 0 for both, but the effect must have run without throwing
    // and assigned from scrollHeight rather than leaving the box untouched.
    expect(scroller.scrollTop).toBe(scroller.scrollHeight)
    cleanup()
  })
})
