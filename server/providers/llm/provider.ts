export interface LLMMessageParams {
  model: string
  maxTokens: number
  messages: Array<{ role: string; content: string }>
  systemInstruction?: string
  /**
   * Whether the model may spend reasoning tokens before answering. Left
   * undefined the model's own default applies.
   */
  reasoning?: boolean
}

export interface LLMStreamResult {
  text: string
  inputTokens: number
  outputTokens: number
}

export interface LLMProvider {
  name: string
  requireKey(): void
  createMessage(params: LLMMessageParams): Promise<LLMStreamResult>
  streamMessage(
    params: LLMMessageParams,
    onText: (delta: string) => void,
    onReasoning?: (delta: string) => void,
  ): Promise<LLMStreamResult>
}
