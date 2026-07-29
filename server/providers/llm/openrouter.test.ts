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

// ---------------------------------------------------------------------------
// Model catalog
// ---------------------------------------------------------------------------

function catalogResponse(models: unknown[], ok = true) {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => ({ data: models }),
  }
}

/** Re-import the module so its in-memory catalog cache starts empty */
async function freshModule() {
  vi.resetModules()
  return import('./openrouter.js')
}

describe('getOpenRouterCatalog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.OPENROUTER_BASE_URL
    vi.mocked(db.getSetting).mockReturnValue('sk-or-v1-test')
  })

  it('maps catalog entries and converts per-token prices to $/M tokens', async () => {
    const fetchMock = vi.fn().mockResolvedValue(catalogResponse([
      { id: 'anthropic/claude-sonnet-4.5', name: 'Anthropic: Claude Sonnet 4.5', pricing: { prompt: '0.000003', completion: '0.000015' } },
    ]))
    vi.stubGlobal('fetch', fetchMock)

    const { getOpenRouterCatalog } = await freshModule()
    const models = await getOpenRouterCatalog()

    expect(models).toEqual([{
      name: 'anthropic/claude-sonnet-4.5',
      label: 'Anthropic: Claude Sonnet 4.5',
      vendor: 'anthropic',
      pricing: [3, 15],
    }])
    vi.unstubAllGlobals()
  })

  it('omits pricing when the catalog reports no usable price', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(catalogResponse([
      { id: 'vendor/free-model', pricing: { prompt: '0', completion: '0' } },
      { id: 'vendor/no-pricing-field' },
      { id: 'vendor/garbage-price', pricing: { prompt: 'n/a', completion: 'n/a' } },
    ])))

    const { getOpenRouterCatalog } = await freshModule()
    const models = await getOpenRouterCatalog()

    expect(models.map(m => m.pricing)).toEqual([undefined, undefined, undefined])
    // Falls back to the id when the catalog gives no display name
    expect(models[0].label).toBe('vendor/free-model')
    vi.unstubAllGlobals()
  })

  it('groups ids without a slash under "other" and sorts by id', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(catalogResponse([
      { id: 'zeta/model' },
      { id: 'standalone-model' },
      { id: 'alpha/model' },
    ])))

    const { getOpenRouterCatalog } = await freshModule()
    const models = await getOpenRouterCatalog()

    expect(models.map(m => m.name)).toEqual(['alpha/model', 'standalone-model', 'zeta/model'])
    expect(models.map(m => m.vendor)).toEqual(['alpha', 'other', 'zeta'])
    vi.unstubAllGlobals()
  })

  it('caches the catalog and refetches only when forced', async () => {
    const fetchMock = vi.fn().mockResolvedValue(catalogResponse([{ id: 'a/b' }]))
    vi.stubGlobal('fetch', fetchMock)

    const { getOpenRouterCatalog } = await freshModule()
    await getOpenRouterCatalog()
    await getOpenRouterCatalog()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await getOpenRouterCatalog(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    vi.unstubAllGlobals()
  })

  it('returns an empty list when OpenRouter is unreachable and nothing is cached', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Connection refused')))

    const { getOpenRouterCatalog } = await freshModule()
    expect(await getOpenRouterCatalog()).toEqual([])
    vi.unstubAllGlobals()
  })

  it('keeps serving the last good catalog when a refresh fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue(catalogResponse([{ id: 'a/b' }]))
    vi.stubGlobal('fetch', fetchMock)

    const { getOpenRouterCatalog } = await freshModule()
    await getOpenRouterCatalog()

    const lastGood = [{ name: 'a/b', label: 'a/b', vendor: 'a' }]

    fetchMock.mockRejectedValue(new Error('Connection refused'))
    expect(await getOpenRouterCatalog(true)).toEqual(lastGood)

    fetchMock.mockResolvedValue(catalogResponse([], false))
    expect(await getOpenRouterCatalog(true)).toEqual(lastGood)
    vi.unstubAllGlobals()
  })
})

describe('openrouterFetch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.OPENROUTER_BASE_URL
  })

  it('sends the stored API key as a bearer token', async () => {
    vi.mocked(db.getSetting).mockReturnValue('sk-or-v1-test')
    const fetchMock = vi.fn().mockResolvedValue(catalogResponse([]))
    vi.stubGlobal('fetch', fetchMock)

    const { openrouterFetch } = await freshModule()
    await openrouterFetch('/key')

    expect(fetchMock).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/key',
      expect.objectContaining({ headers: { Authorization: 'Bearer sk-or-v1-test' } }),
    )
    vi.unstubAllGlobals()
  })

  it('omits the Authorization header when no key is stored', async () => {
    vi.mocked(db.getSetting).mockReturnValue(undefined)
    const fetchMock = vi.fn().mockResolvedValue(catalogResponse([]))
    vi.stubGlobal('fetch', fetchMock)

    const { openrouterFetch } = await freshModule()
    await openrouterFetch('/models')

    expect(fetchMock.mock.calls[0][1].headers).toEqual({})
    vi.unstubAllGlobals()
  })
})
