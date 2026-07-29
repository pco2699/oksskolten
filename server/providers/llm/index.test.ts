import { describe, it, expect, vi } from 'vitest'

vi.mock('../../db.js', () => ({ getSetting: vi.fn() }))

vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create: vi.fn() } }
  },
}))

describe('getProvider', () => {
  it('returns the OpenRouter provider', async () => {
    const { getProvider } = await import('./index.js')
    expect(getProvider('openrouter').name).toBe('openrouter')
  })

  it('throws for a provider that is not registered', async () => {
    const { getProvider } = await import('./index.js')
    expect(() => getProvider('anthropic')).toThrow('Unknown LLM provider: anthropic')
    expect(() => getProvider('llama')).toThrow('Unknown LLM provider: llama')
  })
})
