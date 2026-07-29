import { useState, useCallback } from 'react'
import { getModelLabel, getModelPricing } from '../data/aiModels'
import { useModelCatalog } from './use-model-catalog'

export interface Metrics {
  time: number
  inputTokens: number
  outputTokens: number
  billingMode?: 'openrouter'
  model?: string
}

export function useMetrics() {
  const [metrics, setMetrics] = useState<Metrics | null>(null)
  const { models } = useModelCatalog()

  const report = useCallback((m: Metrics) => {
    setMetrics(m)
  }, [])

  const reset = useCallback(() => {
    setMetrics(null)
  }, [])

  const formatMetrics = useCallback(() => {
    if (!metrics) return null
    const modelId = metrics.model ?? ''
    const modelLabel = getModelLabel(modelId, models)
    const base = `${modelLabel} · ${metrics.time.toFixed(1)}s · ${metrics.inputTokens.toLocaleString()} input · ${metrics.outputTokens.toLocaleString()} output`
    // Pricing is only known for models present in the fetched catalog
    const pricing = getModelPricing(modelId, models)
    if (!pricing) return base
    const cost = (metrics.inputTokens * pricing[0] + metrics.outputTokens * pricing[1]) / 1_000_000
    return `${base} · ~$${cost.toFixed(4)}`
  }, [metrics, models])

  return { metrics, report, reset, formatMetrics }
}
