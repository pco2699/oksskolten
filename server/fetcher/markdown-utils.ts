import TurndownService from 'turndown'

// Lightweight Turndown instance for converting RSS HTML excerpts to Markdown.
// Unlike the worker-thread instance in contentWorker.ts, this skips custom rules
// (barePreBlock, table keep) because RSS descriptions are simple HTML fragments.
const fallbackTurndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' })

/** Check if a string contains HTML tags (not just plain text or Markdown). */
const HTML_TAG_RE = /<[a-zA-Z][^>]*>/

/**
 * Convert RSS feed content to Markdown for use as article full_text.
 * Detects whether the input is HTML, Markdown/plain text, and only applies
 * Turndown conversion for HTML. Plain text and Markdown are returned as-is
 * because Turndown would mangle them (escaping Markdown syntax, collapsing newlines).
 */
export function convertHtmlToMarkdown(content: string): string {
  if (!HTML_TAG_RE.test(content)) return content
  return fallbackTurndown.turndown(content)
}

const IMG_SRC_RE = /<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/i

/**
 * Pull the first image URL out of an RSS content fragment, resolved against the
 * article URL. Feeds that skip full-text fetching never retrieve page metadata,
 * so this stands in for og:image to keep article thumbnails working.
 */
export function firstImageFromHtml(html: string, baseUrl: string): string | null {
  const match = html.match(IMG_SRC_RE)
  if (!match) return null
  try {
    return new URL(match[1], baseUrl).toString()
  } catch {
    return null
  }
}

/**
 * Generate a plain-text excerpt from Markdown by stripping images and links.
 * Used by both contentWorker (page extraction) and fetcher (RSS fallback).
 */
export function markdownToExcerpt(md: string, maxLen = 200): string | null {
  return md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')        // strip ![alt](url)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')     // [text](url) → text
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen)
    .trim() || null
}
