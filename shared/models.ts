/**
 * OpenRouter is the only LLM provider. Its catalog holds hundreds of models and
 * changes constantly, so there is no static model list here: model ids are typed
 * or picked from the live catalog, and pricing comes from the same catalog.
 */

export const LLM_PROVIDER = 'openrouter'

/** Per-task defaults. Models are user-chosen — an empty model means "not configured yet". */
export const TASK_DEFAULTS = {
  chat:      { provider: LLM_PROVIDER, model: '' },
  summarize: { provider: LLM_PROVIDER, model: '' },
  translate: { provider: LLM_PROVIDER, model: '' },
} as const

export const PROVIDER_LABELS: Record<string, 'provider.openrouter'> = {
  openrouter: 'provider.openrouter',
}

/** [input $/M tokens, output $/M tokens] */
export type ModelPricing = [number, number]

export interface CatalogModel {
  /** OpenRouter model id, e.g. "deepseek/deepseek-v4-flash" */
  name: string
  /** Human-readable name from the catalog, e.g. "DeepSeek: V4 Flash" */
  label: string
  /** Vendor prefix of the id, used to group the model picker */
  vendor: string
  /** Undefined when the catalog reports no usable price (e.g. free models) */
  pricing?: ModelPricing
}

/** Short display label for a model id, falling back to the id itself */
export function getModelLabel(model: string, catalog?: CatalogModel[]): string {
  return catalog?.find(m => m.name === model)?.label || model
}

/** Look up a model's pricing in a fetched catalog */
export function getModelPricing(model: string, catalog?: CatalogModel[]): ModelPricing | undefined {
  return catalog?.find(m => m.name === model)?.pricing
}
