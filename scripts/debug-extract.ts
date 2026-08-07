#!/usr/bin/env node --import tsx
/**
 * Diagnose full-text extraction for a single URL.
 *
 * Prints what each stage of the content pipeline decided, so a page that
 * extracts the wrong region (navigation, comments, a trackback list) can be
 * traced to the stage that made the wrong choice instead of being guessed at:
 *
 *   1. fetch            — bytes received, whether FlareSolverr was used
 *   2. stripHeavyTags   — how much the main-thread regex pass removed
 *   3. Readability      — which element it picked, and its text length
 *   4. findBestContentBlock — the scorer's candidate, and whether it overrode
 *                            Readability (contentWorker applies the override
 *                            when pRatio > 0.3 and text is 2x Readability's)
 *   5. postClean        — final Markdown
 *
 * Usage:
 *   npx tsx scripts/debug-extract.ts <url> [--save-fixture <name>]
 *
 * `--save-fixture <name>` writes the raw HTML to
 * server/lib/cleaner/fixtures/<name>/input.html so a misextracting page can be
 * turned into a regression test. Trim it by hand before committing — real pages
 * are large and carry third-party content.
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { JSDOM } from 'jsdom'
import { Readability } from '@mozilla/readability'
import { fetchHtml } from '../server/fetcher/http.js'
import { stripHeavyTags, extractAnchoredContentHtml, fetchFullText } from '../server/fetcher/content.js'
import { preClean } from '../server/lib/cleaner/index.js'
import { findBestContentBlock } from '../server/lib/cleaner/content-scorer.js'

function describeElement(el: Element): string {
  const tag = el.tagName.toLowerCase()
  const id = el.id ? `#${el.id}` : ''
  const cls = typeof el.className === 'string' && el.className
    ? `.${el.className.trim().split(/\s+/).join('.')}`
    : ''
  return `${tag}${id}${cls}`
}

function textLen(s: string | null | undefined): number {
  return (s || '').replace(/\s+/g, ' ').trim().length
}

/** Ancestor chain as a selector path, so the picked region is locatable in the page. */
function pathOf(el: Element): string {
  const parts: string[] = []
  let cur: Element | null = el
  while (cur && cur.tagName.toLowerCase() !== 'html') {
    parts.unshift(describeElement(cur))
    cur = cur.parentElement
  }
  return parts.join(' > ')
}

async function main() {
  const args = process.argv.slice(2)
  const url = args.find(a => !a.startsWith('--'))
  if (!url) {
    console.error('Usage: npx tsx scripts/debug-extract.ts <url> [--save-fixture <name>]')
    process.exit(1)
  }
  const fixtureIdx = args.indexOf('--save-fixture')
  const fixtureName = fixtureIdx >= 0 ? args[fixtureIdx + 1] : null

  console.log(`\n=== 1. fetch: ${url}`)
  const { html, contentType, usedFlareSolverr } = await fetchHtml(url)
  console.log(`  content-type       : ${contentType}`)
  console.log(`  used FlareSolverr  : ${usedFlareSolverr}`)
  console.log(`  raw HTML bytes     : ${Buffer.byteLength(html)}`)

  if (fixtureName) {
    const dir = join('server/lib/cleaner/fixtures', fixtureName)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'input.html'), html)
    console.log(`  saved fixture      : ${join(dir, 'input.html')}`)
  }

  console.log('\n=== 2. stripHeavyTags')
  const anchored = extractAnchoredContentHtml(html, url)
  if (anchored.length !== html.length) {
    console.log(`  anchored slice     : ${html.length} -> ${anchored.length} chars (URL has a #hash)`)
  }
  const stripped = stripHeavyTags(anchored)
  console.log(`  before             : ${anchored.length} chars`)
  console.log(`  after              : ${stripped.length} chars`)
  const strippedTextLen = textLen(new JSDOM(stripped).window.document.body.textContent)
  const anchoredTextLen = textLen(new JSDOM(anchored).window.document.body.textContent)
  console.log(`  visible text       : ${anchoredTextLen} -> ${strippedTextLen} chars`)
  // A large drop is normal on nav-heavy pages, so only flag it when what remains
  // is too small to be an article. These regexes are not nesting-aware, so an
  // unclosed nav/header/form can swallow the body.
  if (strippedTextLen < anchoredTextLen * 0.5 && strippedTextLen < 1000) {
    console.log('  WARNING: little visible text survived this stage. stripHeavyTags is not')
    console.log('           nesting-aware — an unclosed tag can swallow the article body.')
  }

  console.log('\n=== 3. Readability (after preClean)')
  const domForCleaning = new JSDOM(stripped, { url })
  preClean(domForCleaning.window.document)
  const domForReadability = new JSDOM(domForCleaning.serialize(), { url })
  const article = new Readability(domForReadability.window.document).parse()
  const readabilityTextLen = textLen(article?.textContent)
  console.log(`  title              : ${article?.title ?? '(none)'}`)
  console.log(`  text length        : ${readabilityTextLen} chars`)
  console.log(`  first 300 chars    : ${(article?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 300)}`)

  console.log('\n=== 4. findBestContentBlock (scorer)')
  const best = findBestContentBlock(domForCleaning.window.document)
  if (!best) {
    console.log('  no candidate (needs >=1000 chars of <p> text and link density <= 0.4)')
  } else {
    const bestTextLen = textLen(best.el.textContent)
    console.log(`  candidate          : ${pathOf(best.el)}`)
    console.log(`  score / pRatio     : ${best.score.toFixed(1)} / ${best.pRatio.toFixed(3)}`)
    console.log(`  text length        : ${bestTextLen} chars`)
    const overrides = best.pRatio > 0.3 && bestTextLen > readabilityTextLen * 2
    console.log(`  overrides Readability: ${overrides}`)
    console.log(`  first 300 chars    : ${(best.el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 300)}`)
  }

  console.log('\n=== 5. final pipeline output (postClean + Markdown)')
  const result = await fetchFullText(url)
  console.log(`  title              : ${result.title ?? '(none)'}`)
  console.log(`  fullText length    : ${textLen(result.fullText)} chars`)
  console.log(`  excerpt            : ${result.excerpt ?? '(none)'}`)
  console.log('  ---- fullText ----')
  console.log(result.fullText)
  process.exit(0)
}

main().catch((err) => {
  console.error('debug-extract failed:', err)
  process.exit(1)
})
