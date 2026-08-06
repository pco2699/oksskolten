import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockSafeFetch, mockGetSetting, mockUpdateArticleContent, mockMarkImagesArchived, mockClearImagesArchived } = vi.hoisted(() => ({
  mockSafeFetch: vi.fn(),
  mockGetSetting: vi.fn(),
  mockUpdateArticleContent: vi.fn(),
  mockMarkImagesArchived: vi.fn(),
  mockClearImagesArchived: vi.fn(),
}))

vi.mock('./ssrf.js', () => ({
  safeFetch: (...args: unknown[]) => mockSafeFetch(...args),
  assertSafeUrl: vi.fn(),
}))

vi.mock('../db/settings.js', () => ({
  getSetting: (...args: unknown[]) => mockGetSetting(...args),
}))

vi.mock('../db/articles.js', () => ({
  updateArticleContent: (...args: unknown[]) => mockUpdateArticleContent(...args),
  markImagesArchived: (...args: unknown[]) => mockMarkImagesArchived(...args),
  clearImagesArchived: (...args: unknown[]) => mockClearImagesArchived(...args),
}))

// ---------------------------------------------------------------------------
// Module under test (loaded after mocks)
// ---------------------------------------------------------------------------

import { extractByDotPath, isImageArchivingEnabled, deleteArticleImages, archiveArticleImages } from './article-images.js'

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

// These cases point images.storage_path at an OS temp dir, which lives outside
// DATA_DIR. Authorize it the way an operator would in production.
const originalStorageRoot = process.env.IMAGES_STORAGE_ROOT

beforeEach(() => {
  vi.clearAllMocks()
  mockGetSetting.mockReturnValue(undefined)
  process.env.IMAGES_STORAGE_ROOT = fs.realpathSync(os.tmpdir())
})

afterEach(() => {
  if (originalStorageRoot === undefined) delete process.env.IMAGES_STORAGE_ROOT
  else process.env.IMAGES_STORAGE_ROOT = originalStorageRoot
})

// ---------------------------------------------------------------------------
// extractByDotPath
// ---------------------------------------------------------------------------

describe('extractByDotPath', () => {
  it('extracts nested paths', () => {
    expect(extractByDotPath({ a: { b: { c: 'value' } } }, 'a.b.c')).toBe('value')
  })

  it('extracts top-level key', () => {
    expect(extractByDotPath({ url: 'https://example.com' }, 'url')).toBe('https://example.com')
  })

  it('returns undefined for missing keys', () => {
    expect(extractByDotPath({ a: 1 }, 'b')).toBeUndefined()
    expect(extractByDotPath({ a: { b: 1 } }, 'a.c')).toBeUndefined()
  })

  it('returns undefined for null input', () => {
    expect(extractByDotPath(null, 'a')).toBeUndefined()
  })

  it('returns undefined for undefined input', () => {
    expect(extractByDotPath(undefined, 'a')).toBeUndefined()
  })

  it('handles intermediate null in path', () => {
    expect(extractByDotPath({ a: null }, 'a.b')).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// isImageArchivingEnabled
// ---------------------------------------------------------------------------

describe('isImageArchivingEnabled', () => {
  it('returns false when no setting', () => {
    mockGetSetting.mockReturnValue(undefined)
    expect(isImageArchivingEnabled()).toBe(false)
  })

  it('returns true when setting is "1"', () => {
    mockGetSetting.mockImplementation((key: string) => key === 'images.enabled' ? '1' : undefined)
    expect(isImageArchivingEnabled()).toBe(true)
  })

  it('returns true when setting is "true"', () => {
    mockGetSetting.mockImplementation((key: string) => key === 'images.enabled' ? 'true' : undefined)
    expect(isImageArchivingEnabled()).toBe(true)
  })

  it('returns false when setting is "0"', () => {
    mockGetSetting.mockImplementation((key: string) => key === 'images.enabled' ? '0' : undefined)
    expect(isImageArchivingEnabled()).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// deleteArticleImages
// ---------------------------------------------------------------------------

describe('deleteArticleImages', () => {
  it('deletes matching files and returns count', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reader-test-'))
    fs.writeFileSync(path.join(tmpDir, '42_abc.jpg'), 'fake')
    fs.writeFileSync(path.join(tmpDir, '42_def.png'), 'fake')
    fs.writeFileSync(path.join(tmpDir, '99_other.jpg'), 'fake')

    mockGetSetting.mockImplementation((key: string) => key === 'images.storage_path' ? tmpDir : undefined)

    const count = deleteArticleImages(42)
    expect(count).toBe(2)
    expect(fs.readdirSync(tmpDir)).toEqual(['99_other.jpg'])

    // Cleanup
    fs.rmSync(tmpDir, { recursive: true })
  })

  it('returns 0 when directory does not exist', () => {
    mockGetSetting.mockImplementation((key: string) => key === 'images.storage_path' ? '/nonexistent/path' : undefined)

    expect(deleteArticleImages(1)).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// archiveArticleImages
// ---------------------------------------------------------------------------

describe('archiveArticleImages', () => {
  it('local mode: downloads images, rewrites markdown, marks archived', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reader-archive-'))

    mockGetSetting.mockImplementation((key: string) => {
      if (key === 'images.storage_path') return tmpDir
      if (key === 'images.max_size_mb') return '10'
      return undefined
    })

    const fakeImageBuffer = Buffer.from('fake-image-data')
    mockSafeFetch.mockResolvedValue({
      ok: true,
      headers: new Map([['content-length', String(fakeImageBuffer.length)]]),
      arrayBuffer: () => Promise.resolve(fakeImageBuffer.buffer.slice(fakeImageBuffer.byteOffset, fakeImageBuffer.byteOffset + fakeImageBuffer.byteLength)),
    })

    const fullText = 'Hello ![photo](https://example.com/image.png) world'
    const result = await archiveArticleImages(1, fullText)

    expect(result.downloaded).toBe(1)
    expect(result.errors).toBe(0)
    expect(result.rewrittenText).toContain('/api/articles/images/')
    expect(result.rewrittenText).not.toContain('https://example.com/image.png')
    expect(mockUpdateArticleContent).toHaveBeenCalled()
    expect(mockMarkImagesArchived).toHaveBeenCalledWith(1)

    // Verify file was created
    const files = fs.readdirSync(tmpDir)
    expect(files).toHaveLength(1)
    expect(files[0]).toMatch(/^1_/)

    fs.rmSync(tmpDir, { recursive: true })
  })

  it('skips already-local URLs and data URIs', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reader-archive-'))

    mockGetSetting.mockImplementation((key: string) => {
      if (key === 'images.storage_path') return tmpDir
      return undefined
    })

    const fullText = '![a](/api/articles/images/existing.png) ![b](data:image/png;base64,abc)'
    const result = await archiveArticleImages(2, fullText)

    expect(result.downloaded).toBe(0)
    expect(result.errors).toBe(0)
    expect(mockSafeFetch).not.toHaveBeenCalled()
    expect(mockMarkImagesArchived).toHaveBeenCalledWith(2)

    fs.rmSync(tmpDir, { recursive: true })
  })

  it('skips oversized images', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reader-archive-'))

    mockGetSetting.mockImplementation((key: string) => {
      if (key === 'images.storage_path') return tmpDir
      if (key === 'images.max_size_mb') return '1' // 1 MB
      return undefined
    })

    // content-length reports over max
    mockSafeFetch.mockResolvedValue({
      ok: true,
      headers: new Map([['content-length', String(2 * 1024 * 1024)]]), // 2 MB
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    })

    const fullText = '![big](https://example.com/huge.jpg)'
    const result = await archiveArticleImages(3, fullText)

    expect(result.downloaded).toBe(0)
    expect(result.errors).toBe(1)

    fs.rmSync(tmpDir, { recursive: true })
  })

  it('remote mode with incomplete config: early return', async () => {
    mockGetSetting.mockImplementation((key: string) => {
      if (key === 'images.storage') return 'remote'
      // No upload_url or upload_resp_path → incomplete
      return undefined
    })

    const fullText = '![img](https://example.com/image.png)'
    const result = await archiveArticleImages(4, fullText)

    expect(result.downloaded).toBe(0)
    expect(result.errors).toBe(0)
    expect(result.rewrittenText).toBe(fullText)
    expect(mockClearImagesArchived).toHaveBeenCalledWith(4)
    expect(mockSafeFetch).not.toHaveBeenCalled()
  })
})
