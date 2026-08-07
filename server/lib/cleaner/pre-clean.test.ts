import { describe, it, expect } from 'vitest'
import { JSDOM } from 'jsdom'
import { readFileSync } from 'fs'
import { join } from 'path'
import { preClean } from './index.js'

const FIXTURES_DIR = join(__dirname, 'fixtures')

interface FixtureMetadata {
  name: string
  url: string
  lang: string
  keySentences: string[]
  knownNoise: string[]
}

function loadFixture(name: string) {
  const dir = join(FIXTURES_DIR, name)
  const inputHtml = readFileSync(join(dir, 'input.html'), 'utf-8')
  const metadata: FixtureMetadata = JSON.parse(readFileSync(join(dir, 'metadata.json'), 'utf-8'))
  return { inputHtml, metadata }
}

function preCleanHtml(html: string, url: string): Document {
  const dom = new JSDOM(html, { url })
  preClean(dom.window.document)
  return dom.window.document
}

describe('preClean', () => {
  describe('removes safe elements', () => {
    it('removes script tags (non-math)', () => {
      const doc = preCleanHtml('<body><script>evil()</script><p>safe</p></body>', 'https://example.com')
      expect(doc.querySelectorAll('script')).toHaveLength(0)
      expect(doc.body.textContent).toContain('safe')
    })

    it('removes style tags', () => {
      const doc = preCleanHtml('<body><style>.x{}</style><p>text</p></body>', 'https://example.com')
      expect(doc.querySelectorAll('style')).toHaveLength(0)
    })

    it('removes noscript tags', () => {
      const doc = preCleanHtml('<body><noscript><img src="/pixel.gif"></noscript><p>text</p></body>', 'https://example.com')
      expect(doc.querySelectorAll('noscript')).toHaveLength(0)
    })

    it('removes link[rel=stylesheet]', () => {
      const doc = preCleanHtml('<head><link rel="stylesheet" href="/s.css"></head><body><p>text</p></body>', 'https://example.com')
      expect(doc.querySelectorAll('link')).toHaveLength(0)
    })

    it('removes meta tags', () => {
      const doc = preCleanHtml('<head><meta name="description" content="test"></head><body><p>text</p></body>', 'https://example.com')
      expect(doc.querySelectorAll('meta')).toHaveLength(0)
    })

    it('removes hidden elements', () => {
      const doc = preCleanHtml('<body><div hidden>hidden</div><p>visible</p></body>', 'https://example.com')
      expect(doc.body.textContent).not.toContain('hidden')
      expect(doc.body.textContent).toContain('visible')
    })

    it('removes display:none elements', () => {
      const doc = preCleanHtml('<body><div style="display:none">hidden</div><p>text</p></body>', 'https://example.com')
      expect(doc.body.textContent).not.toContain('hidden')
    })

    it('removes non-video iframes', () => {
      const doc = preCleanHtml(
        '<body><iframe src="https://ads.example.com"></iframe><iframe src="https://youtube.com/embed/x"></iframe></body>',
        'https://example.com',
      )
      expect(doc.querySelectorAll('iframe')).toHaveLength(1)
      expect(doc.querySelector('iframe')?.getAttribute('src')).toContain('youtube')
    })

    it('removes canvas elements', () => {
      const doc = preCleanHtml('<body><canvas></canvas><p>text</p></body>', 'https://example.com')
      expect(doc.querySelectorAll('canvas')).toHaveLength(0)
    })

    it('removes Hatena trackback lists, keeping the entry body', () => {
      const doc = preCleanHtml(
        `<body><div class="section"><p>entry body</p></div>
         <div class="refererlist"><ul><li><p>a reply</p></li></ul></div></body>`,
        'https://anond.hatelabo.jp/20260807141232',
      )
      expect(doc.querySelectorAll('.refererlist')).toHaveLength(0)
      expect(doc.body.textContent).not.toContain('a reply')
      expect(doc.body.textContent).toContain('entry body')
    })

    it('removes the Hatena entry footer and heading marker', () => {
      const doc = preCleanHtml(
        `<body><div class="section">
           <h3><a href="/20260807141232"><span class="sanchor">■</span></a>title</h3>
           <p>entry body</p>
           <p class="sectionfooter"><a href="/20260807141232">Permalink</a> | 14:12</p>
         </div></body>`,
        'https://anond.hatelabo.jp/20260807141232',
      )
      expect(doc.body.textContent).not.toContain('Permalink')
      expect(doc.body.textContent).not.toContain('■')
      expect(doc.body.textContent).toContain('entry body')
      // The marker is a prefix inside the heading — the title itself must survive.
      expect(doc.querySelector('h3')?.textContent).toContain('title')
    })
  })

  describe('preserves content elements', () => {
    it('preserves article body', () => {
      const doc = preCleanHtml(
        '<body><article><h1>Title</h1><p>Article content</p></article></body>',
        'https://example.com',
      )
      expect(doc.body.textContent).toContain('Article content')
    })

    it('preserves header/nav (not removed in pre-clean)', () => {
      const doc = preCleanHtml(
        '<body><header><nav><a href="/">Home</a></nav></header><p>text</p></body>',
        'https://example.com',
      )
      // header/nav are NOT in pre-clean selectors — they are post-clean only
      expect(doc.querySelectorAll('header')).toHaveLength(1)
      expect(doc.querySelectorAll('nav')).toHaveLength(1)
    })

    it('preserves aside (not removed in pre-clean)', () => {
      const doc = preCleanHtml(
        '<body><aside><p>Sidebar content</p></aside><p>main</p></body>',
        'https://example.com',
      )
      expect(doc.querySelectorAll('aside')).toHaveLength(1)
    })

    it('preserves footer (not removed in pre-clean)', () => {
      const doc = preCleanHtml(
        '<body><footer><p>Copyright</p></footer></body>',
        'https://example.com',
      )
      expect(doc.querySelectorAll('footer')).toHaveLength(1)
    })

    it('preserves images and figures', () => {
      const doc = preCleanHtml(
        '<body><figure><img src="/photo.jpg" alt="Photo"><figcaption>Caption</figcaption></figure></body>',
        'https://example.com',
      )
      expect(doc.querySelectorAll('img')).toHaveLength(1)
      expect(doc.querySelectorAll('figure')).toHaveLength(1)
    })

    it('preserves YouTube iframes', () => {
      const doc = preCleanHtml(
        '<body><iframe src="https://www.youtube.com/embed/abc123"></iframe></body>',
        'https://example.com',
      )
      expect(doc.querySelectorAll('iframe')).toHaveLength(1)
    })
  })

  describe('config options', () => {
    it('disablePreClean skips all cleaning', () => {
      const dom = new JSDOM('<body><script>evil()</script><p>text</p></body>', { url: 'https://example.com' })
      preClean(dom.window.document, { disablePreClean: true })
      expect(dom.window.document.querySelectorAll('script')).toHaveLength(1)
    })

    it('excludePreClean prevents specific selectors', () => {
      const dom = new JSDOM('<body><noscript><img src="/img.jpg"></noscript><p>text</p></body>', { url: 'https://example.com' })
      preClean(dom.window.document, { excludePreClean: ['noscript'] })
      expect(dom.window.document.querySelectorAll('noscript')).toHaveLength(1)
    })

    it('additionalPreClean adds custom selectors', () => {
      const dom = new JSDOM('<body><div class="custom-noise">noise</div><p>text</p></body>', { url: 'https://example.com' })
      preClean(dom.window.document, { additionalPreClean: ['.custom-noise'] })
      expect(dom.window.document.body.textContent).not.toContain('noise')
    })
  })

  describe('fail-open behavior', () => {
    it('does not throw on malformed document', () => {
      const dom = new JSDOM('not html at all', { url: 'https://example.com' })
      expect(() => preClean(dom.window.document)).not.toThrow()
    })
  })

  describe('corpus fixtures', () => {
    const fixtures = ['jp-blog', 'jp-news', 'en-techblog', 'en-personal-blog', 'image-heavy']

    for (const name of fixtures) {
      describe(name, () => {
        const { inputHtml, metadata } = loadFixture(name)

        it('preserves key sentences', () => {
          const doc = preCleanHtml(inputHtml, metadata.url)
          const text = doc.body.textContent || ''
          for (const sentence of metadata.keySentences) {
            expect(text).toContain(sentence)
          }
        })

        it('removes scripts and styles', () => {
          const doc = preCleanHtml(inputHtml, metadata.url)
          expect(doc.querySelectorAll('script:not([type^="math/"])')).toHaveLength(0)
          expect(doc.querySelectorAll('style')).toHaveLength(0)
          expect(doc.querySelectorAll('noscript')).toHaveLength(0)
        })

        it('removes hidden elements', () => {
          const doc = preCleanHtml(inputHtml, metadata.url)
          expect(doc.querySelectorAll('[hidden]')).toHaveLength(0)
          expect(doc.querySelectorAll('[style*="display:none"]')).toHaveLength(0)
        })
      })
    }
  })
})
