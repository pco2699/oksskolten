import { getSetting } from '../db.js'
import { getProvider } from '../providers/llm/index.js'
import { LLM_PROVIDER } from '../../shared/models.js'
import { DEFAULT_LANGUAGE, languageName } from '../../shared/lang.js'

export type AiBillingMode = typeof LLM_PROVIDER

export interface AiTextResult {
  inputTokens: number
  outputTokens: number
  billingMode: AiBillingMode
  model: string
}

export function detectLanguage(fullText: string): string {
  const sample = fullText.slice(0, 1000)
  const jaCount = (sample.match(/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/g) || []).length
  return jaCount / sample.length > 0.1 ? 'ja' : 'en'
}


function buildSummarizePrompt(fullText: string): string {
  const lang = getSetting('general.language') || DEFAULT_LANGUAGE
  return `Summarize the following article in ${languageName(lang)}. Follow the format strictly.

## Format
Line 1: A concise 1-2 sentence summary of the article's main point (what the article is about and the author's key argument or conclusion)
Line 2: Empty line
Line 3+: Key points as bullet points. Each item should follow the format "**Point title** — supplementary explanation" (only the title in bold)

## Rules
- Each bullet point must faithfully reflect the article's arguments, claims, or facts
- Maintain the order of the article's flow
- Minimize the number of points (3-4 is ideal). Only add more if the content is truly wide-ranging, but never exceed 7
- Output in Markdown (bullet points start with "- ")
- Do not include any text other than the summary (no headings, preambles, or notes)

--- Article body ---
${fullText}`
}

function buildTranslatePrompt(fullText: string): string {
  const lang = getSetting('translate.target_lang') || getSetting('general.language') || DEFAULT_LANGUAGE
  const targetLang = languageName(lang)
  return `Translate the following article into ${targetLang}.
Translate every word faithfully — do not summarize, compress, or omit anything.
The translation must be 1:1 with the original text in volume.
Preserve Markdown formatting. In particular, keep blockquote lines starting with ">".

--- Article body ---
${fullText}`
}

interface AiTaskConfig {
  modelKey: string
  maxTokensKey: string
  defaultMaxTokens: number
  buildPrompt: (text: string) => string
}

/**
 * Resolve the max output tokens for an AI task. A positive integer stored in
 * settings overrides the built-in default; anything else (unset, empty,
 * malformed) falls back. Lets users of models whose context window is smaller
 * than the defaults lower the completion cap.
 */
function resolveMaxTokens(config: AiTaskConfig): number {
  const raw = getSetting(config.maxTokensKey)
  if (!raw) return config.defaultMaxTokens
  const parsed = Number(raw)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : config.defaultMaxTokens
}

async function runAiTask(
  config: AiTaskConfig,
  fullText: string,
  onText?: (delta: string) => void,
): Promise<{ text: string } & AiTextResult> {
  // OpenRouter has no default model — its catalog is paid and changes constantly,
  // so a model id is only ever what the user configured.
  const model = getSetting(config.modelKey)
  if (!model) throw new Error('MODEL_NOT_SET')
  const provider = getProvider(LLM_PROVIDER)
  provider.requireKey()
  const prompt = config.buildPrompt(fullText)
  const maxTokens = resolveMaxTokens(config)
  const result = onText
    ? await provider.streamMessage(
        { model, maxTokens, messages: [{ role: 'user', content: prompt }] },
        onText,
      )
    : await provider.createMessage({
        model,
        maxTokens,
        messages: [{ role: 'user', content: prompt }],
      })
  return {
    text: result.text,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    billingMode: LLM_PROVIDER,
    model,
  }
}

const SUMMARIZE_MAX_TOKENS = 2048
const TRANSLATE_MAX_TOKENS = 16384

const summarizeConfig: AiTaskConfig = {
  modelKey: 'summary.model',
  maxTokensKey: 'summary.max_tokens',
  defaultMaxTokens: SUMMARIZE_MAX_TOKENS,
  buildPrompt: buildSummarizePrompt,
}

const translateConfig: AiTaskConfig = {
  modelKey: 'translate.model',
  maxTokensKey: 'translate.max_tokens',
  defaultMaxTokens: TRANSLATE_MAX_TOKENS,
  buildPrompt: buildTranslatePrompt,
}

export async function summarizeArticle(fullText: string): Promise<{ summary: string } & AiTextResult> {
  const r = await runAiTask(summarizeConfig, fullText)
  return { summary: r.text, inputTokens: r.inputTokens, outputTokens: r.outputTokens, billingMode: r.billingMode, model: r.model }
}

export async function streamSummarizeArticle(
  fullText: string,
  onText: (delta: string) => void,
): Promise<{ summary: string } & AiTextResult> {
  const r = await runAiTask(summarizeConfig, fullText, onText)
  return { summary: r.text, inputTokens: r.inputTokens, outputTokens: r.outputTokens, billingMode: r.billingMode, model: r.model }
}

export async function translateArticle(fullText: string): Promise<{ fullTextTranslated: string } & AiTextResult> {
  const r = await runAiTask(translateConfig, fullText)
  return { fullTextTranslated: r.text, inputTokens: r.inputTokens, outputTokens: r.outputTokens, billingMode: r.billingMode, model: r.model }
}

export async function streamTranslateArticle(
  fullText: string,
  onText: (delta: string) => void,
): Promise<{ fullTextTranslated: string } & AiTextResult> {
  const r = await runAiTask(translateConfig, fullText, onText)
  return { fullTextTranslated: r.text, inputTokens: r.inputTokens, outputTokens: r.outputTokens, billingMode: r.billingMode, model: r.model }
}
