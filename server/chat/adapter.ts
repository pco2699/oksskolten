import type { Message } from './types.js'

export type ChatSSEEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'thinking_start' }
  | { type: 'reasoning_delta'; text: string }
  | { type: 'thinking_end' }
  | { type: 'tool_use_start'; name: string; tool_use_id: string }
  | { type: 'tool_use_end'; name: string; tool_use_id: string }
  | { type: 'done'; usage: { input_tokens: number; output_tokens: number }; elapsed_ms?: number; model?: string }
  | { type: 'error'; error: string }

export interface RunChatTurnResult {
  allMessages: Message[]
  usage: { input_tokens: number; output_tokens: number }
}

export interface ChatTurnParams {
  messages: Message[]
  system: string
  model: string
  timeZone?: string
  onEvent: (event: ChatSSEEvent) => void
}

export async function runChatTurn(params: ChatTurnParams): Promise<RunChatTurnResult> {
  const { runOpenRouterTurn } = await import('./adapter-openrouter.js')
  return runOpenRouterTurn(params)
}
