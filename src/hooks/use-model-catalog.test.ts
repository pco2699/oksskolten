import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useModelCatalog } from './use-model-catalog'

const swrReturn: { data: unknown; isLoading: boolean } = { data: undefined, isLoading: false }
const mockUseSWR = vi.fn()

vi.mock('swr', () => ({
  default: (key: string, fetcher: unknown, opts: unknown) => {
    mockUseSWR(key, fetcher, opts)
    return swrReturn
  },
}))

beforeEach(() => {
  vi.clearAllMocks()
  swrReturn.data = undefined
  swrReturn.isLoading = false
})

describe('useModelCatalog', () => {
  it('returns the models from the catalog endpoint', () => {
    const models = [
      { name: 'deepseek/deepseek-v4-flash', label: 'DeepSeek: V4 Flash', vendor: 'deepseek', pricing: [0.2, 0.8] },
    ]
    swrReturn.data = { models }

    const { result } = renderHook(() => useModelCatalog())

    expect(result.current.models).toEqual(models)
    expect(mockUseSWR).toHaveBeenCalledWith(
      '/api/settings/openrouter/models',
      expect.any(Function),
      expect.objectContaining({ revalidateOnFocus: false }),
    )
  })

  it('returns an empty list while loading, so callers never see undefined', () => {
    swrReturn.isLoading = true

    const { result } = renderHook(() => useModelCatalog())

    expect(result.current.models).toEqual([])
    expect(result.current.isLoading).toBe(true)
  })

  it('returns an empty list when the endpoint returns no models', () => {
    swrReturn.data = { models: [] }

    const { result } = renderHook(() => useModelCatalog())

    expect(result.current.models).toEqual([])
  })
})
