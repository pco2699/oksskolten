import type { LLMProvider } from './provider.js'
import { openrouterProvider } from './openrouter.js'

const providers = new Map<string, LLMProvider>()

providers.set('openrouter', openrouterProvider)

export function getProvider(name: string): LLMProvider {
  const provider = providers.get(name)
  if (!provider) throw new Error(`Unknown LLM provider: ${name}`)
  return provider
}
