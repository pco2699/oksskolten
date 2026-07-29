import OpenAI from 'openai'
import { getSetting } from '../../db.js'
import type { LLMProvider, LLMMessageParams, LLMStreamResult } from './provider.js'

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1'

// OpenRouter uses these to attribute traffic to the calling app on its public
// leaderboards. Both are optional for the API itself.
const APP_URL = 'https://github.com/babarot/oksskolten'
const APP_TITLE = 'Oksskolten'

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
    defaultHeaders: {
      'HTTP-Referer': APP_URL,
      'X-Title': APP_TITLE,
    },
  })
  return cachedClient
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

export const openrouterProvider: LLMProvider = {
  name: 'openrouter',

  requireKey() {
    if (!getOpenRouterApiKey()) {
      throw new Error('OPENROUTER_KEY_NOT_SET')
    }
  },

  async createMessage(params: LLMMessageParams): Promise<LLMStreamResult> {
    const client = getOpenRouterClient()

    const response = await client.chat.completions.create({
      model: params.model,
      max_completion_tokens: params.maxTokens,
      messages: toOpenAIMessages(params),
    })

    const text = response.choices[0]?.message?.content ?? ''
    return {
      text,
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
    }
  },

  async streamMessage(params: LLMMessageParams, onText: (delta: string) => void): Promise<LLMStreamResult> {
    const client = getOpenRouterClient()

    const stream = await client.chat.completions.create({
      model: params.model,
      max_completion_tokens: params.maxTokens,
      messages: toOpenAIMessages(params),
      stream: true,
      stream_options: { include_usage: true },
    })

    let fullText = ''
    let inputTokens = 0
    let outputTokens = 0

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content ?? ''
      if (delta) {
        fullText += delta
        onText(delta)
      }
      if (chunk.usage) {
        inputTokens = chunk.usage.prompt_tokens ?? inputTokens
        outputTokens = chunk.usage.completion_tokens ?? outputTokens
      }
    }

    return { text: fullText, inputTokens, outputTokens }
  },
}
