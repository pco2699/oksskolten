/**
 * HTML preparation that runs *before* Readability, on the worker thread.
 *
 * Split out from `content.ts` for the same reason `markdown-utils.ts` is:
 * `contentWorker.ts` needs these, but `content.ts` owns the Piscina pool that
 * loads `contentWorker.ts`, so importing across that edge would be a cycle.
 *
 * Everything here is CPU-bound and unbounded in the worst case. It ran on the
 * main thread until 2026-09-06, when a sibling text pass in `content.ts` wedged
 * the event loop for ~1 hour; synchronous JS cannot be interrupted, so the only
 * real guard is running it somewhere a worker timeout can kill it.
 */
import { JSDOM } from 'jsdom'

/**
 * Strip heavy non-content shells before Readability, to cut parse time.
 *
 * Cheap on real pages, but not bounded: each `<tag[\s\S]*?</tag>` scans to the
 * end of the document for every unclosed opening tag, so a hostile page is
 * quadratic. That is survivable here because this now runs inside the worker,
 * under the pool's per-task timeout - it used to run on the event loop.
 */
export function stripHeavyTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<svg[\s\S]*?<\/svg>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<aside[\s\S]*?<\/aside>/gi, '')
    .replace(/<dialog[\s\S]*?<\/dialog>/gi, '')
    .replace(/<form[\s\S]*?<\/form>/gi, '')
    .replace(/<template[\s\S]*?<\/template>/gi, '')
    .replace(/<canvas[\s\S]*?<\/canvas>/gi, '')
}

function isHeading(el: Element): el is HTMLElement {
  return /^H[1-6]$/i.test(el.tagName)
}

function headingLevel(el: Element | null): number {
  if (!el) return 6
  if (isHeading(el)) return Number(el.tagName[1])
  if (el.getAttribute('role') === 'heading') {
    const ariaLevel = Number(el.getAttribute('aria-level') || '6')
    return Number.isFinite(ariaLevel) && ariaLevel > 0 ? ariaLevel : 6
  }
  return 6
}

function isBoundaryHeading(el: Element, targetLevel: number): boolean {
  return headingLevel(el) <= targetLevel
}

/**
 * For anchor-link documents like changelogs, extract only the targeted section,
 * so the whole page history is not handed to jsdom + Readability.
 *
 * Note this parses the document with JSDOM itself. That is real work on up to
 * `MAX_RESPONSE_BYTES` of HTML, which is why it belongs on a worker thread.
 */
export function extractAnchoredContentHtml(html: string, articleUrl: string): string {
  const url = new URL(articleUrl)
  const hash = url.hash.replace(/^#/, '')
  if (!hash) return html

  const dom = new JSDOM(html, { url: articleUrl })
  const doc = dom.window.document
  const target = doc.getElementById(hash)
  if (!target) return html

  const start = isHeading(target) ? target : (target as Element).closest('h1, h2, h3, h4, h5, h6, [role="heading"]') || target
  const targetLevel = headingLevel(start)

  let endBoundary: Element | null = null
  let current: Element | null = start
  while ((current = current!.nextElementSibling)) {
    if (isBoundaryHeading(current, targetLevel)) {
      endBoundary = current
      break
    }
  }

  const range = doc.createRange()
  range.setStartBefore(start)
  if (endBoundary) range.setEndBefore(endBoundary)
  else range.setEndAfter(doc.body.lastElementChild || doc.body)

  const fragment = doc.createElement('article')
  fragment.append(range.cloneContents())
  const fragmentHtml = fragment.innerHTML.trim()
  if (!fragmentHtml) return html

  const ogTags = [
    doc.querySelector('meta[property="og:image"]')?.outerHTML,
    doc.querySelector('meta[property="og:title"]')?.outerHTML,
  ].filter(Boolean).join('\n')
  const title = doc.querySelector('title')?.textContent || ''

  return `<!DOCTYPE html>
<html>
<head>
<title>${title}</title>
${ogTags}
</head>
<body>
<article>
${fragmentHtml}
</article>
</body>
</html>`
}
