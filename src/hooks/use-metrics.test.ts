import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useMetrics } from './use-metrics'

const CATALOG = [
  { name: 'anthropic/claude-haiku-4.5', label: 'Anthropic: Claude Haiku 4.5', vendor: 'anthropic', pricing: [1, 5] as [number, number] },
  { name: 'deepseek/deepseek-v4-flash', label: 'DeepSeek: V4 Flash', vendor: 'deepseek' },
]

vi.mock('./use-model-catalog', () => ({
  useModelCatalog: () => ({ models: CATALOG, isLoading: false }),
}))

describe('useMetrics', () => {
  it('initializes with null', () => {
    const { result } = renderHook(() => useMetrics())
    expect(result.current.metrics).toBeNull()
  })

  it('report() sets metrics', () => {
    const { result } = renderHook(() => useMetrics())
    const m = { time: 1.5, inputTokens: 100, outputTokens: 50 }

    act(() => result.current.report(m))
    expect(result.current.metrics).toEqual(m)
  })

  it('reset() clears metrics to null', () => {
    const { result } = renderHook(() => useMetrics())

    act(() => result.current.report({ time: 1, inputTokens: 10, outputTokens: 5 }))
    act(() => result.current.reset())
    expect(result.current.metrics).toBeNull()
  })

  it('report() overwrites previous metrics', () => {
    const { result } = renderHook(() => useMetrics())

    act(() => result.current.report({ time: 1, inputTokens: 10, outputTokens: 5 }))
    const updated = { time: 2, inputTokens: 200, outputTokens: 100 }
    act(() => result.current.report(updated))
    expect(result.current.metrics).toEqual(updated)
  })

  describe('formatMetrics', () => {
    it('returns null when no metrics', () => {
      const { result } = renderHook(() => useMetrics())
      expect(result.current.formatMetrics()).toBeNull()
    })

    it('labels the model from the catalog and computes cost from its pricing', () => {
      const { result } = renderHook(() => useMetrics())
      act(() => result.current.report({
        time: 2.5,
        inputTokens: 1000,
        outputTokens: 500,
        billingMode: 'openrouter',
        model: 'anthropic/claude-haiku-4.5',
      }))

      const text = result.current.formatMetrics()!
      expect(text).toContain('Anthropic: Claude Haiku 4.5')
      expect(text).toContain('2.5s')
      expect(text).toContain('1,000 input')
      expect(text).toContain('500 output')
      // (1000*1 + 500*5) / 1_000_000
      expect(text).toContain('$0.0035')
    })

    it('omits cost for a catalog model without pricing', () => {
      const { result } = renderHook(() => useMetrics())
      act(() => result.current.report({
        time: 1.0,
        inputTokens: 1000,
        outputTokens: 200,
        model: 'deepseek/deepseek-v4-flash',
      }))

      const text = result.current.formatMetrics()!
      expect(text).toContain('DeepSeek: V4 Flash')
      expect(text).not.toContain('$')
    })

    it('falls back to the raw id and omits cost for a model not in the catalog', () => {
      const { result } = renderHook(() => useMetrics())
      act(() => result.current.report({
        time: 1.0,
        inputTokens: 1000,
        outputTokens: 200,
        model: 'unknown/model-xyz',
      }))

      const text = result.current.formatMetrics()!
      expect(text).toContain('unknown/model-xyz')
      expect(text).not.toContain('$')
    })

    it('handles metrics with no model', () => {
      const { result } = renderHook(() => useMetrics())
      act(() => result.current.report({
        time: 1.0,
        inputTokens: 500,
        outputTokens: 100,
      }))

      const text = result.current.formatMetrics()!
      expect(text).toContain('1.0s')
      expect(text).toContain('500 input')
    })
  })
})
