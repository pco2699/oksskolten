import { describe, it, expect, vi, beforeEach } from 'vitest'
import { openrouterProvider, getOpenRouterBaseUrl, getOpenRouterApiKey } from './openrouter.js'
import * as db from '../../db.js'

vi.mock('../../db.js', () => ({
  getSetting: vi.fn(),
}))

const createMock = vi.fn()

vi.mock('openai', () => {
  return {
    default: class {
      chat = {
        completions: {
          create: createMock,
        },
      }
    },
  }
})

function mockChatResponse() {
  createMock.mockResolvedValue({
    choices: [{ message: { content: 'test response' } }],
    usage: { prompt_tokens: 10, completion_tokens: 20 },
  })
}

describe('openrouterProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.OPENROUTER_BASE_URL
  })

  it('uses the OpenRouter API root by default', () => {
    expect(getOpenRouterBaseUrl()).toBe('https://openrouter.ai/api/v1')
  })

  it('gets base URL from env and strips trailing slashes', () => {
    process.env.OPENROUTER_BASE_URL = 'https://gateway.example.com/api/v1/'
    expect(getOpenRouterBaseUrl()).toBe('https://gateway.example.com/api/v1')
  })

  it('gets API key from settings', () => {
    vi.mocked(db.getSetting).mockImplementation((key) => {
      if (key === 'api_key.openrouter') return 'sk-or-v1-test'
      return undefined
    })
    expect(getOpenRouterApiKey()).toBe('sk-or-v1-test')
  })

  it('requireKey throws when no API key is set', () => {
    vi.mocked(db.getSetting).mockReturnValue(undefined)
    expect(() => openrouterProvider.requireKey()).toThrow('OPENROUTER_KEY_NOT_SET')
  })

  it('requireKey passes when an API key is set', () => {
    vi.mocked(db.getSetting).mockReturnValue('sk-or-v1-test')
    expect(() => openrouterProvider.requireKey()).not.toThrow()
  })

  it('createMessage calls OpenAI with correct parameters', async () => {
    vi.mocked(db.getSetting).mockReturnValue('sk-or-v1-test')
    mockChatResponse()

    const result = await openrouterProvider.createMessage({
      model: 'anthropic/claude-sonnet-4.5',
      maxTokens: 100,
      messages: [{ role: 'user', content: 'hello' }],
      systemInstruction: 'you are a bot',
    })

    expect(createMock).toHaveBeenCalledWith({
      model: 'anthropic/claude-sonnet-4.5',
      max_completion_tokens: 100,
      messages: [
        { role: 'system', content: 'you are a bot' },
        { role: 'user', content: 'hello' },
      ],
    })
    expect(result.text).toBe('test response')
    expect(result.inputTokens).toBe(10)
    expect(result.outputTokens).toBe(20)
  })

  it('streamMessage accumulates deltas and usage', async () => {
    vi.mocked(db.getSetting).mockReturnValue('sk-or-v1-test')
    createMock.mockResolvedValue({
      async *[Symbol.asyncIterator]() {
        yield { choices: [{ delta: { content: 'Hello' } }] }
        yield { choices: [{ delta: { content: ' world' } }] }
        yield { choices: [{ delta: {} }], usage: { prompt_tokens: 5, completion_tokens: 7 } }
      },
    })

    const deltas: string[] = []
    const result = await openrouterProvider.streamMessage(
      {
        model: 'openai/gpt-4.1-mini',
        maxTokens: 50,
        messages: [{ role: 'user', content: 'hi' }],
      },
      d => deltas.push(d),
    )

    expect(deltas).toEqual(['Hello', ' world'])
    expect(result.text).toBe('Hello world')
    expect(result.inputTokens).toBe(5)
    expect(result.outputTokens).toBe(7)
  })
})
