import { XMLParser } from 'fast-xml-parser'
import type { Feed, Category } from './db.js'

interface OpmlOutline {
  '@_text'?: string
  '@_title'?: string
  '@_type'?: string
  '@_xmlUrl'?: string
  '@_htmlUrl'?: string
  outline?: OpmlOutline | OpmlOutline[]
}

export interface ParsedFeed {
  name: string
  url: string
  rssUrl: string
  categoryName: string | null
}

export function parseOpml(xml: string): ParsedFeed[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    isArray: (name) => name === 'outline',
  })
  const doc = parser.parse(xml)

  const body = doc?.opml?.body
  if (!body) throw new Error('Invalid OPML: missing <body>')

  const outlines: OpmlOutline[] = Array.isArray(body.outline) ? body.outline : body.outline ? [body.outline] : []

  const feeds: ParsedFeed[] = []
  walkOutlines(outlines, null, feeds)
  return feeds
}

function walkOutlines(outlines: OpmlOutline[], categoryName: string | null, feeds: ParsedFeed[]): void {
  for (const outline of outlines) {
    if (outline['@_xmlUrl']) {
      const rssUrl = outline['@_xmlUrl']
      const htmlUrl = outline['@_htmlUrl']
      // Fall back to the feed URL itself, not its origin: `feeds.url` is UNIQUE, so
      // collapsing to the origin makes every feed served from one host (proxies,
      // aggregators) look like the same feed.
      const url = htmlUrl || rssUrl
      const name = outline['@_text'] || outline['@_title'] || new URL(rssUrl).hostname

      feeds.push({ name, url, rssUrl, categoryName })
    } else if (outline.outline) {
      // Category node: has children but no xmlUrl
      const catName = outline['@_text'] || outline['@_title'] || null
      const children = Array.isArray(outline.outline) ? outline.outline : [outline.outline]
      walkOutlines(children, catName, feeds)
    }
  }
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function generateOpml(feeds: Feed[], categories: Category[]): string {
  const categoryMap = new Map(categories.map(c => [c.id, c.name]))

  // Group feeds by category
  const grouped = new Map<string | null, Feed[]>()
  for (const feed of feeds) {
    if (feed.type === 'clip') continue
    const catName = feed.category_id ? (categoryMap.get(feed.category_id) ?? null) : null
    if (!grouped.has(catName)) grouped.set(catName, [])
    grouped.get(catName)!.push(feed)
  }

  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<opml version="2.0">',
    '  <head>',
    '    <title>Oksskolten Feeds</title>',
    `    <dateCreated>${new Date().toISOString()}</dateCreated>`,
    '  </head>',
    '  <body>',
  ]

  // Feeds with categories
  for (const [catName, catFeeds] of grouped) {
    if (catName === null) continue
    lines.push(`    <outline text="${escapeXml(catName)}" title="${escapeXml(catName)}">`)
    for (const feed of catFeeds) {
      lines.push(feedToOutline(feed, '      '))
    }
    lines.push('    </outline>')
  }

  // Feeds without category (top-level)
  const uncategorized = grouped.get(null) ?? []
  for (const feed of uncategorized) {
    lines.push(feedToOutline(feed, '    '))
  }

  lines.push('  </body>')
  lines.push('</opml>')

  return lines.join('\n')
}

function feedToOutline(feed: Feed, indent: string): string {
  const attrs = [
    'type="rss"',
    `text="${escapeXml(feed.name)}"`,
    `title="${escapeXml(feed.name)}"`,
    `xmlUrl="${escapeXml(feed.rss_url || feed.rss_bridge_url || feed.url)}"`,
    `htmlUrl="${escapeXml(feed.url)}"`,
  ]
  return `${indent}<outline ${attrs.join(' ')} />`
}
