import OpenAI from 'openai'
import { getSetting } from '../../db.js'
import type { CatalogModel } from '../../../shared/models.js'
import type { LLMProvider, LLMMessageParams, LLMStreamResult } from './provider.js'

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1'

// OpenRouter uses these to attribute traffic to the calling app on its public
// leaderboards. Both are optional for the API itself.
const APP_URL = 'https://github.com/babarot/oksskolten'
const APP_TITLE = 'Oksskolten'

// The SDK defaults (10 minute timeout, 2 retries) mean a stalled generation can
// silently occupy half an hour before surfacing an error. A thinking model on a
// long article is slow but not that slow, so fail sooner and retry once.
const REQUEST_TIMEOUT_MS = 5 * 60 * 1000
const MAX_RETRIES = 1

let cachedBaseUrl = ''
let cachedKey = ''
let cachedClient: OpenAI | null = null

export function getOpenRouterBaseUrl(): string {
  const raw = process.env.OPENROUTER_BASE_URL || DEFAULT_BASE_URL
  return raw.replace(/\/+$/, '')
}

export function getOpenRouterApiKey(): string {
  return getSetting('api_key.openrouter') || ''
}

export function getOpenRouterClient(): OpenAI {
  const baseUrl = getOpenRouterBaseUrl()
  const key = getOpenRouterApiKey()
  if (cachedClient && baseUrl === cachedBaseUrl && key === cachedKey) return cachedClient
  cachedBaseUrl = baseUrl
  cachedKey = key
  cachedClient = new OpenAI({
    baseURL: baseUrl,
    apiKey: key,
    timeout: REQUEST_TIMEOUT_MS,
    maxRetries: MAX_RETRIES,
    defaultHeaders: {
      'HTTP-Referer': APP_URL,
      'X-Title': APP_TITLE,
    },
  })
  return cachedClient
}

// --- Model catalog ---

interface OpenRouterCatalogEntry {
  id: string
  name?: string
  pricing?: { prompt?: string; completion?: string }
}

const CATALOG_TTL_MS = 6 * 60 * 60 * 1000

let cachedCatalog: CatalogModel[] | null = null
let cachedCatalogAt = 0

/** OpenRouter prices per token as a decimal string; the UI works in $/M tokens. */
function toPerMillion(raw: string | undefined): number | undefined {
  if (!raw) return undefined
  const perToken = Number(raw)
  if (!Number.isFinite(perToken) || perToken <= 0) return undefined
  return perToken * 1_000_000
}

export function openrouterFetch(path: string, timeoutMs = 10_000): Promise<Response> {
  const apiKey = getOpenRouterApiKey()
  const headers: Record<string, string> = {}
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`
  return fetch(`${getOpenRouterBaseUrl()}${path}`, { headers, signal: AbortSignal.timeout(timeoutMs) })
}

/**
 * Fetch the OpenRouter model catalog, cached in memory. The catalog is ~400 entries
 * that change a few times a week, so a stale read is far cheaper than a fetch per view.
 * Returns an empty list (uncached) when OpenRouter is unreachable.
 */
export async function getOpenRouterCatalog(force = false): Promise<CatalogModel[]> {
  if (!force && cachedCatalog && Date.now() - cachedCatalogAt < CATALOG_TTL_MS) {
    return cachedCatalog
  }
  try {
    const res = await openrouterFetch('/models')
    if (!res.ok) return cachedCatalog ?? []
    const data = await res.json() as { data?: OpenRouterCatalogEntry[] }
    const models: CatalogModel[] = (data.data || [])
      .map(m => {
        const input = toPerMillion(m.pricing?.prompt)
        const output = toPerMillion(m.pricing?.completion)
        return {
          name: m.id,
          label: m.name || m.id,
          // The segment before "/" is the vendor, and groups the model picker
          vendor: m.id.includes('/') ? m.id.split('/')[0] : 'other',
          ...(input !== undefined && output !== undefined ? { pricing: [input, output] as [number, number] } : {}),
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name))
    cachedCatalog = models
    cachedCatalogAt = Date.now()
    return models
  } catch {
    return cachedCatalog ?? []
  }
}

function toOpenAIMessages(params: LLMMessageParams): OpenAI.ChatCompletionMessageParam[] {
  const messages: OpenAI.ChatCompletionMessageParam[] = []
  if (params.systemInstruction) {
    messages.push({ role: 'system', content: params.systemInstruction })
  }
  for (const m of params.messages) {
    messages.push({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content,
    })
  }
  return messages
}

/**
 * Params OpenRouter accepts alongside the OpenAI schema.
 *
 * `reasoning` matters most: several models (DeepSeek V4 among them) think by
 * default, and their reasoning tokens are billed against max_completion_tokens
 * while producing no visible output — a summary that should take seconds stalls
 * instead. `provider.sort` keeps a request off the slowest host serving a model.
 */
interface OpenRouterExtraBody {
  reasoning?: { enabled: boolean }
  provider?: { sort: 'throughput' }
}

function extraBody(params: LLMMessageParams): OpenRouterExtraBody {
  const body: OpenRouterExtraBody = { provider: { sort: 'throughput' } }
  if (params.reasoning !== undefined) body.reasoning = { enabled: params.reasoning }
  return body
}

/** OpenRouter carries reasoning text on a delta field the OpenAI schema has no name for. */
function reasoningDelta(delta: unknown): string {
  const raw = (delta as { reasoning?: unknown } | undefined)?.reasoning
  return typeof raw === 'string' ? raw : ''
}

export const openrouterProvider: LLMProvider = {
  name: 'openrouter',

  requireKey() {
    if (!getOpenRouterApiKey()) {
      throw new Error('OPENROUTER_KEY_NOT_SET')
    }
  },

  async createMessage(params: LLMMessageParams): Promise<LLMStreamResult> {
    const client = getOpenRouterClient()

    const body = {
      model: params.model,
      max_completion_tokens: params.maxTokens,
      messages: toOpenAIMessages(params),
      ...extraBody(params),
    }
    const response = await client.chat.completions.create(
      body as OpenAI.ChatCompletionCreateParamsNonStreaming,
    )

    const text = response.choices[0]?.message?.content ?? ''
    return {
      text,
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
    }
  },

  async streamMessage(
    params: LLMMessageParams,
    onText: (delta: string) => void,
    onReasoning?: (delta: string) => void,
  ): Promise<LLMStreamResult> {
    const client = getOpenRouterClient()

    const body = {
      model: params.model,
      max_completion_tokens: params.maxTokens,
      messages: toOpenAIMessages(params),
      stream: true,
      stream_options: { include_usage: true },
      ...extraBody(params),
    }
    const stream = await client.chat.completions.create(
      body as OpenAI.ChatCompletionCreateParamsStreaming,
    )

    let fullText = ''
    let inputTokens = 0
    let outputTokens = 0

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content ?? ''
      if (delta) {
        fullText += delta
        onText(delta)
      }
      // Surfaced separately from the answer: it is progress to show, not content to keep.
      const thought = reasoningDelta(chunk.choices[0]?.delta)
      if (thought && onReasoning) onReasoning(thought)
      if (chunk.usage) {
        inputTokens = chunk.usage.prompt_tokens ?? inputTokens
        outputTokens = chunk.usage.completion_tokens ?? outputTokens
      }
    }

    return { text: fullText, inputTokens, outputTokens }
  },
}
