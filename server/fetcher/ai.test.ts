import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockGetSetting, mockCreateMessage, mockStreamMessage, mockRequireKey } = vi.hoisted(() => ({
  mockGetSetting: vi.fn(),
  mockCreateMessage: vi.fn(),
  mockStreamMessage: vi.fn(),
  mockRequireKey: vi.fn(),
}))

vi.mock('../db.js', () => ({
  getSetting: (...args: unknown[]) => mockGetSetting(...args),
}))

vi.mock('../providers/llm/index.js', () => ({
  getProvider: () => ({
    name: 'openrouter',
    requireKey: mockRequireKey,
    createMessage: mockCreateMessage,
    streamMessage: mockStreamMessage,
  }),
}))

import {
  detectLanguage,
  summarizeArticle,
  streamSummarizeArticle,
  translateArticle,
  streamTranslateArticle,
} from './ai.js'

const DEFAULT_MODEL = 'anthropic/claude-haiku-4.5'

/** Settings stub: a model is configured, everything else falls back to defaults */
function settings(overrides: Record<string, string> = {}) {
  return (key: string) => {
    if (key in overrides) return overrides[key]
    if (key === 'summary.model' || key === 'translate.model') return DEFAULT_MODEL
    return null
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetSetting.mockImplementation(settings())
})

// ---------------------------------------------------------------------------
// detectLanguage
// ---------------------------------------------------------------------------
describe('detectLanguage', () => {
  it('returns "ja" for Japanese text', () => {
    expect(detectLanguage('これは日本語のテキストです。テストのために書いています。')).toBe('ja')
  })

  it('returns "en" for English text', () => {
    expect(detectLanguage('This is an English text written for testing purposes.')).toBe('en')
  })

  it('returns "en" for empty string', () => {
    expect(detectLanguage('')).toBe('en')
  })

  it('uses only first 1000 chars for detection', () => {
    const ja = 'あ'.repeat(200)
    const en = 'a'.repeat(2000)
    // First 1000 chars: 200 ja + 800 en → 200/1000 = 20% > 10% → "ja"
    expect(detectLanguage(ja + en)).toBe('ja')
  })

  it('returns "en" when CJK ratio is at boundary (<=10%)', () => {
    // 10 CJK chars + 90 ASCII = 10% → not > 10% → "en"
    const text = 'あ'.repeat(10) + 'a'.repeat(90)
    expect(detectLanguage(text)).toBe('en')
  })

  it('returns "ja" when CJK ratio is just above 10%', () => {
    // 11 CJK chars + 89 ASCII = 11% → > 10% → "ja"
    const text = 'あ'.repeat(11) + 'a'.repeat(89)
    expect(detectLanguage(text)).toBe('ja')
  })

  it('detects kanji-heavy text as Japanese', () => {
    expect(detectLanguage('東京都渋谷区で開催されたイベントに参加しました')).toBe('ja')
  })

  it('detects katakana-heavy text as Japanese', () => {
    expect(detectLanguage('プログラミングのテストケースをチェックする')).toBe('ja')
  })
})

// ---------------------------------------------------------------------------
// summarizeArticle
// ---------------------------------------------------------------------------
describe('summarizeArticle', () => {
  it('returns summary with token usage', async () => {
    mockCreateMessage.mockResolvedValue({
      text: '要約テキスト',
      inputTokens: 100,
      outputTokens: 50,
    })

    const result = await summarizeArticle('Article body text')

    expect(result.summary).toBe('要約テキスト')
    expect(result.inputTokens).toBe(100)
    expect(result.outputTokens).toBe(50)
    expect(result.billingMode).toBe('openrouter')
    expect(result.model).toBeDefined()
  })

  it('calls requireKey before making request', async () => {
    mockCreateMessage.mockResolvedValue({ text: 'ok', inputTokens: 0, outputTokens: 0 })
    await summarizeArticle('text')
    expect(mockRequireKey).toHaveBeenCalled()
  })

  it('uses createMessage (non-streaming)', async () => {
    mockCreateMessage.mockResolvedValue({ text: 'ok', inputTokens: 0, outputTokens: 0 })
    await summarizeArticle('text')
    expect(mockCreateMessage).toHaveBeenCalled()
    expect(mockStreamMessage).not.toHaveBeenCalled()
  })

  it('passes article text in prompt', async () => {
    mockCreateMessage.mockResolvedValue({ text: 'ok', inputTokens: 0, outputTokens: 0 })
    await summarizeArticle('My article content here')

    const params = mockCreateMessage.mock.calls[0][0]
    expect(params.messages[0].content).toContain('My article content here')
  })

  it('sets maxTokens to 2048 for summarize', async () => {
    mockCreateMessage.mockResolvedValue({ text: 'ok', inputTokens: 0, outputTokens: 0 })
    await summarizeArticle('text')

    const params = mockCreateMessage.mock.calls[0][0]
    expect(params.maxTokens).toBe(2048)
  })

  it('uses summary.max_tokens override from settings', async () => {
    mockGetSetting.mockImplementation(settings({ 'summary.max_tokens': '512' }))
    mockCreateMessage.mockResolvedValue({ text: 'ok', inputTokens: 0, outputTokens: 0 })
    await summarizeArticle('text')

    const params = mockCreateMessage.mock.calls[0][0]
    expect(params.maxTokens).toBe(512)
  })

  it('falls back to default when summary.max_tokens is not a positive integer', async () => {
    mockGetSetting.mockImplementation(settings({ 'summary.max_tokens': 'not-a-number' }))
    mockCreateMessage.mockResolvedValue({ text: 'ok', inputTokens: 0, outputTokens: 0 })
    await summarizeArticle('text')

    const params = mockCreateMessage.mock.calls[0][0]
    expect(params.maxTokens).toBe(2048)
  })

  it('keeps reasoning off by default so summaries do not pay for thinking', async () => {
    mockCreateMessage.mockResolvedValue({ text: 'ok', inputTokens: 0, outputTokens: 0 })
    await summarizeArticle('text')

    const params = mockCreateMessage.mock.calls[0][0]
    expect(params.reasoning).toBe(false)
  })

  it('enables reasoning and widens the token budget when summary.reasoning is on', async () => {
    mockGetSetting.mockImplementation(settings({ 'summary.reasoning': 'on' }))
    mockCreateMessage.mockResolvedValue({ text: 'ok', inputTokens: 0, outputTokens: 0 })
    await summarizeArticle('text')

    const params = mockCreateMessage.mock.calls[0][0]
    expect(params.reasoning).toBe(true)
    // Reasoning tokens are billed against the same cap, so the answer needs headroom
    expect(params.maxTokens).toBe(8192)
  })

  it('respects an explicit max_tokens even with reasoning on', async () => {
    mockGetSetting.mockImplementation(settings({ 'summary.reasoning': 'on', 'summary.max_tokens': '512' }))
    mockCreateMessage.mockResolvedValue({ text: 'ok', inputTokens: 0, outputTokens: 0 })
    await summarizeArticle('text')

    const params = mockCreateMessage.mock.calls[0][0]
    expect(params.maxTokens).toBe(512)
  })

  it('uses custom model from settings', async () => {
    mockGetSetting.mockImplementation(settings({ 'summary.model': 'deepseek/deepseek-v4-flash' }))
    mockCreateMessage.mockResolvedValue({ text: 'ok', inputTokens: 0, outputTokens: 0 })
    const result = await summarizeArticle('text')
    expect(result.model).toBe('deepseek/deepseek-v4-flash')
  })

  it('throws MODEL_NOT_SET when no model is configured', async () => {
    mockGetSetting.mockReturnValue(null)
    await expect(summarizeArticle('text')).rejects.toThrow('MODEL_NOT_SET')
    expect(mockCreateMessage).not.toHaveBeenCalled()
  })

  it('propagates provider errors', async () => {
    mockCreateMessage.mockRejectedValue(new Error('API rate limit'))
    await expect(summarizeArticle('text')).rejects.toThrow('API rate limit')
  })

  it('propagates requireKey errors', async () => {
    mockRequireKey.mockImplementation(() => {
      throw new Error('OPENROUTER_KEY_NOT_SET')
    })
    await expect(summarizeArticle('text')).rejects.toThrow('OPENROUTER_KEY_NOT_SET')
    mockRequireKey.mockReset()
  })
})

// ---------------------------------------------------------------------------
// streamSummarizeArticle
// ---------------------------------------------------------------------------
describe('streamSummarizeArticle', () => {
  it('uses streamMessage and passes onText callback', async () => {
    mockStreamMessage.mockResolvedValue({ text: 'streamed summary', inputTokens: 10, outputTokens: 5 })

    const deltas: string[] = []
    const result = await streamSummarizeArticle('text', (d) => deltas.push(d))

    expect(result.summary).toBe('streamed summary')
    expect(mockStreamMessage).toHaveBeenCalled()
    expect(mockCreateMessage).not.toHaveBeenCalled()

    // Verify onText was passed through
    const onText = mockStreamMessage.mock.calls[0][1]
    onText('chunk')
    expect(deltas).toEqual(['chunk'])
  })

  it('passes the onReasoning callback through to the provider', async () => {
    mockStreamMessage.mockResolvedValue({ text: 'summary', inputTokens: 0, outputTokens: 0 })

    const thoughts: string[] = []
    await streamSummarizeArticle('text', () => {}, (d) => thoughts.push(d))

    const onReasoning = mockStreamMessage.mock.calls[0][2]
    onReasoning('thinking')
    expect(thoughts).toEqual(['thinking'])
  })
})

// ---------------------------------------------------------------------------
// translateArticle
// ---------------------------------------------------------------------------
describe('translateArticle', () => {
  it('returns fullTextTranslated with token usage', async () => {
    mockCreateMessage.mockResolvedValue({
      text: '翻訳されたテキスト',
      inputTokens: 200,
      outputTokens: 180,
    })

    const result = await translateArticle('English article text')

    expect(result.fullTextTranslated).toBe('翻訳されたテキスト')
    expect(result.inputTokens).toBe(200)
    expect(result.outputTokens).toBe(180)
    expect(result.billingMode).toBe('openrouter')
  })

  it('passes article text in translate prompt', async () => {
    mockCreateMessage.mockResolvedValue({ text: 'ok', inputTokens: 0, outputTokens: 0 })
    await translateArticle('Content to translate')

    const params = mockCreateMessage.mock.calls[0][0]
    expect(params.messages[0].content).toContain('Content to translate')
    expect(params.messages[0].content).toContain('Translate the following article into English')
  })

  it('sets maxTokens to 16384 for translate', async () => {
    mockCreateMessage.mockResolvedValue({ text: 'ok', inputTokens: 0, outputTokens: 0 })
    await translateArticle('text')

    const params = mockCreateMessage.mock.calls[0][0]
    expect(params.maxTokens).toBe(16384)
  })

  it('uses translate.max_tokens override from settings', async () => {
    mockGetSetting.mockImplementation(settings({ 'translate.max_tokens': '4096' }))
    mockCreateMessage.mockResolvedValue({ text: 'ok', inputTokens: 0, outputTokens: 0 })
    await translateArticle('text')

    const params = mockCreateMessage.mock.calls[0][0]
    expect(params.maxTokens).toBe(4096)
  })

  it('uses translate-specific settings keys', async () => {
    mockGetSetting.mockImplementation(settings({ 'translate.model': 'gpt-4.1' }))
    mockCreateMessage.mockResolvedValue({ text: 'ok', inputTokens: 0, outputTokens: 0 })
    const result = await translateArticle('text')
    expect(result.model).toBe('gpt-4.1')
  })
})

// ---------------------------------------------------------------------------
// streamTranslateArticle
// ---------------------------------------------------------------------------
describe('streamTranslateArticle', () => {
  it('uses streamMessage and returns fullTextTranslated', async () => {
    mockStreamMessage.mockResolvedValue({ text: 'ストリーム翻訳', inputTokens: 15, outputTokens: 12 })

    const deltas: string[] = []
    const result = await streamTranslateArticle('text', (d) => deltas.push(d))

    expect(result.fullTextTranslated).toBe('ストリーム翻訳')
    expect(mockStreamMessage).toHaveBeenCalled()
    expect(mockCreateMessage).not.toHaveBeenCalled()
  })
})
