import { LLM_PROVIDER } from '../../shared/models.js'
import { getProvider } from '../providers/llm/index.js'
import { updateConversation } from '../db.js'

const TITLE_MAX_LENGTH = 50
const TITLE_MIN_LENGTH = 4

/**
 * Generate a conversation title with the same model the conversation runs on.
 * This is fire-and-forget — failures are silently ignored and the fallback title remains.
 */
export async function generateConversationTitle(
  conversationId: string,
  userMessage: string,
  assistantResponse: string,
  model: string,
): Promise<void> {
  if (!model) return

  const provider = getProvider(LLM_PROVIDER)

  const result = await provider.createMessage({
    model,
    maxTokens: 100,
    systemInstruction: 'Summarize the conversation into a short title (15-30 characters). Output only the title — no decoration or brackets. Generate the title in the same language as the user message.',
    messages: [
      { role: 'user', content: `User: ${userMessage}\n\nAI: ${assistantResponse.slice(0, 500)}` },
    ],
  })

  const title = result.text.trim().slice(0, TITLE_MAX_LENGTH)
  if (title.length >= TITLE_MIN_LENGTH) {
    updateConversation(conversationId, { title })
  }
}
