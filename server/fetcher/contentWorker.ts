import { JSDOM, VirtualConsole } from 'jsdom'
import { Readability } from '@mozilla/readability'
import TurndownService from 'turndown'
import pino from 'pino'
import { preClean, postClean } from '../lib/cleaner/index.js'
import { findBestContentBlock } from '../lib/cleaner/content-scorer.js'
import type { CleanerConfig } from '../lib/cleaner/selectors.js'
import { markdownToExcerpt } from './markdown-utils.js'
import { stripHeavyTags, extractAnchoredContentHtml } from './html-prep.js'
import { isBotBlockPage } from '../lib/blocked-body.js'

const isDev = process.env.NODE_ENV === 'development'
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  ...(isDev
    ? { transport: { target: 'pino-pretty', options: { translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' } } }
    : {}),
}).child({ worker: 'contentWorker' })

function createVirtualConsole(articleUrl: string): VirtualConsole {
  const vc = new VirtualConsole()
  vc.on('error', (msg: string) => {
    logger.debug({ articleUrl }, msg)
  })
  return vc
}

const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' })
turndown.keep(['table', 'thead', 'tbody', 'tr', 'th', 'td'])

// Handle bare <pre> elements (without <code> child) as fenced code blocks.
// Many blogs (e.g. Hatena Blog) use <pre class="code lang-sh"> with syntax
// highlighting <span> elements but no wrapping <code> tag.
turndown.addRule('barePreBlock', {
  filter(node) {
    return (
      node.nodeName === 'PRE' &&
      !node.querySelector('code')
    )
  },
  replacement(_content, node) {
    const el = node as HTMLElement
    const lang = el.getAttribute('data-lang') || ''
    const text = el.textContent || ''
    return `\n\n\`\`\`${lang}\n${text.replace(/\n+$/, '')}\n\`\`\`\n\n`
  },
})

export interface ParseHtmlInput {
  /** Raw page body. Anchor extraction and tag stripping happen in here. */
  html: string
  articleUrl: string
  cleanerConfig?: CleanerConfig
}

export interface ParseHtmlResult {
  fullText: string
  ogImage: string | null
  excerpt: string | null
  title: string | null
  /** Whitespace-collapsed length of `fullText`, so callers need not rescan it. */
  textLength: number
  /** True when the extraction looks like an interstitial or a script dump. */
  looksGarbage: boolean
}

export function parseHtml(input: ParseHtmlInput): ParseHtmlResult {
  const { html: rawHtml, articleUrl, cleanerConfig } = input

  // Prepare the body here rather than at the call site: both entry points
  // (direct fetch and the FlareSolverr retry) used to run these two passes on
  // the main thread, identically, before handing the result over.
  const html = stripHeavyTags(extractAnchoredContentHtml(rawHtml, articleUrl))

  // Extract og:image and og:title before any DOM mutation
  const vc = createVirtualConsole(articleUrl)
  const metaDom = new JSDOM(html, { url: articleUrl, virtualConsole: vc })
  const metaDoc = metaDom.window.document
  const ogImageRaw = metaDoc
    .querySelector('meta[property="og:image"]')
    ?.getAttribute('content') || null
  const ogImage = ogImageRaw ? new URL(ogImageRaw, articleUrl).toString() : null
  const ogTitle = metaDoc
    .querySelector('meta[property="og:title"]')
    ?.getAttribute('content')?.trim() || null
  const htmlTitle = metaDoc.querySelector('title')?.textContent?.trim() || null

  // Phase 1: pre-clean (safe element removal before Readability)
  const domForCleaning = new JSDOM(html, { url: articleUrl, virtualConsole: vc })
  try {
    preClean(domForCleaning.window.document, cleanerConfig)
  } catch {
    // Fail-open: continue with original HTML if pre-clean fails
  }

  // Phase 2: Readability extraction (uses pre-cleaned HTML)
  const domForReadability = new JSDOM(domForCleaning.serialize(), { url: articleUrl, virtualConsole: vc })
  let article = new Readability(domForReadability.window.document).parse()

  let contentHtml = article?.content || null
  let readabilityTextLen = (article?.textContent || '').replace(/\s+/g, ' ').trim().length

  // Validate Readability result against enhanced content-block scoring.
  const bestBlock = findBestContentBlock(domForCleaning.window.document)
  if (bestBlock && bestBlock.pRatio > 0.3) {
    const bestTextLen = bestBlock.el.textContent?.replace(/\s+/g, ' ').trim().length || 0
    if (bestTextLen > readabilityTextLen * 2) {
      contentHtml = bestBlock.el.innerHTML
    }
  }

  if (!contentHtml) throw new Error('Readability: could not extract article')

  // Phase 3: post-clean (selector removal + scoring + HTML normalization)
  const contentDom = new JSDOM(contentHtml, { url: articleUrl, virtualConsole: vc })
  const contentDoc = contentDom.window.document
  try {
    postClean(contentDoc, cleanerConfig)
  } catch {
    // Fail-open: continue with Readability output if post-clean fails
  }

  // Simplify <picture> elements to plain <img> before Turndown conversion.
  for (const pic of contentDoc.querySelectorAll('picture')) {
    const img = pic.querySelector('img')
    if (img) {
      let src = img.getAttribute('src')
      if (!src) {
        const srcset = img.getAttribute('srcset')
        if (srcset) src = srcset.split(',')[0].trim().split(/\s+/)[0]
      }
      if (src) img.setAttribute('src', new URL(src, articleUrl).toString())
      img.removeAttribute('srcset')
      pic.replaceWith(img)
    } else {
      const source = pic.querySelector('source')
      const srcset = source?.getAttribute('srcset')
      if (srcset) {
        const firstUrl = srcset.split(',')[0].trim().split(/\s+/)[0]
        const newImg = contentDoc.createElement('img')
        newImg.setAttribute('src', new URL(firstUrl, articleUrl).toString())
        pic.replaceWith(newImg)
      } else {
        pic.remove()
      }
    }
  }

  let fullText = turndown.turndown(contentDoc.body.innerHTML)
  fullText = fullText.replace(
    /\[\s*\n+\s*(!\[[^\]]*\]\([^)]*\))\s*\n+\s*\]\s*\(([^)]*)\)/g,
    (_m, img, url) => `[${img}](${url})`,
  )
  // Collapse a markdown link whose text was wrapped across lines.
  //
  // `[^\]]` must exclude `\n` here: it otherwise overlaps with the `\n` that
  // opens the repeated group, so the same run of text can be split between the
  // two in exponentially many ways. On a `[` that never gets its closing `](`,
  // that ambiguity is catastrophic backtracking. Excluding the newline from
  // both classes makes the parse unique while matching the same language.
  fullText = fullText.replace(
    /\[([^\]\n]*(?:\n[^\]\n]*)+)\]\(([^)]+)\)/g,
    (_m, text, url) => `[${text.replace(/\s*\n\s*/g, ' ').trim()}](${url})`,
  )
  const excerpt = markdownToExcerpt(fullText)

  const title = article?.title || ogTitle || htmlTitle
  const textLength = fullText.replace(/\s+/g, ' ').trim().length
  return { fullText, ogImage, excerpt, title, textLength, looksGarbage: isGarbageExtraction(fullText) }
}

/**
 * Detect garbage extraction: text that is mostly code/scripts with little
 * natural prose. Readability "succeeds" on bot checks, consent walls and leaked
 * script blobs, and the result is indistinguishable from an article downstream
 * — the summarizer will confidently summarize a CAPTCHA page. Strips markdown
 * code fences and asks whether what remains reads like prose.
 *
 * Lives here, beside the parse that produces its input, so it runs under the
 * worker pool's timeout. It sat in `content.ts` on the main thread until
 * 2026-09-06, when its sentence-counting regex went quadratic on a ~1 MB
 * terminator-free extraction and pinned the event loop for ~1 hour.
 */
function isGarbageExtraction(text: string): boolean {
  // Bot detection / form submission pages. Classified by `isBotBlockPage` in
  // server/lib/blocked-body.ts, shared with the summarize path so the fetcher
  // and the tools agree on what a failed fetch is.
  if (isBotBlockPage(text)) return true

  // Strip markdown code blocks (```...```)
  const withoutCodeBlocks = text.replace(/```[\s\S]*?```/g, '')
  // Strip inline code (`...`)
  const withoutInlineCode = withoutCodeBlocks.replace(/`[^`]+`/g, '')

  const prose = withoutInlineCode.replace(/\s+/g, ' ').trim()
  if (prose.length === 0) return true

  // Count prose sentences: sequences ending with sentence-final punctuation
  // that contain at least a few word-like tokens.
  //
  // Walk the string instead of matching /[^.!?。！？]+[.!?。！？]/g. That pattern
  // is quadratic on text whose tail holds no terminator: the run is scanned to
  // the end, backtracks, and is rescanned from the next start position, so cost
  // grows with the square of the trailing run. The walk is linear and stops as
  // soon as the threshold is met.
  const SENTENCE_END = new Set(['.', '!', '?', '。', '！', '？'])
  const MIN_PROSE_SENTENCES = 3
  let proseSentences = 0
  let sentenceStart = 0
  for (let i = 0; i < prose.length && proseSentences < MIN_PROSE_SENTENCES; i++) {
    if (!SENTENCE_END.has(prose[i])) continue
    const sentence = prose.slice(sentenceStart, i + 1).trim()
    sentenceStart = i + 1
    if (sentence && sentence.split(/\s+/).length >= 3) proseSentences++
  }

  // A real article should have at least a handful of prose sentences
  if (proseSentences < MIN_PROSE_SENTENCES) return true

  // Check ratio: if prose (outside code fences) is tiny relative to total text, likely garbage
  if (prose.length < text.length * 0.1) return true

  return false
}

// piscina default export: receives serializable input, returns serializable output
export default function (input: ParseHtmlInput): ParseHtmlResult {
  return parseHtml(input)
}
