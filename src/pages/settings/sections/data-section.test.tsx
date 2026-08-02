import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DataSection } from './data-section'

// --- Mocks ---

const mockPreviewOpml = vi.fn()
const mockImportOpml = vi.fn()

vi.mock('../../../lib/fetcher', () => ({
  previewOpml: (...args: unknown[]) => mockPreviewOpml(...args),
  importOpml: (...args: unknown[]) => mockImportOpml(...args),
  fetchOpmlBlob: vi.fn().mockResolvedValue(new Blob(['<opml/>'])),
}))

vi.mock('swr', () => ({
  useSWRConfig: () => ({ mutate: vi.fn() }),
}))

const samplePreview = {
  feeds: [
    { name: 'Hacker News', url: 'https://news.ycombinator.com', rssUrl: 'https://news.ycombinator.com/rss', categoryName: 'Tech', isDuplicate: true },
    { name: 'Lobsters', url: 'https://lobste.rs', rssUrl: 'https://lobste.rs/rss', categoryName: 'Tech', isDuplicate: false },
    { name: 'xkcd', url: 'https://xkcd.com', rssUrl: 'https://xkcd.com/rss.xml', categoryName: null, isDuplicate: false },
  ],
  totalCount: 3,
  duplicateCount: 1,
}

describe('DataSection OPML preview', () => {
  const user = userEvent.setup({ pointerEventsCheck: 0 })

  beforeEach(() => {
    vi.clearAllMocks()
    mockPreviewOpml.mockResolvedValue(samplePreview)
    mockImportOpml.mockResolvedValue({ imported: 2, skipped: 1, errors: [] })
  })

  async function selectFile() {
    render(<DataSection />)
    const file = new File(['<opml/>'], 'test.opml', { type: 'application/xml' })
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    await user.upload(input, file)
  }

  it('opens preview dialog after file selection', async () => {
    await selectFile()
    await waitFor(() => {
      expect(screen.getByText('Hacker News')).toBeTruthy()
      expect(screen.getByText('Lobsters')).toBeTruthy()
      expect(screen.getByText('xkcd')).toBeTruthy()
    })
  })

  it('marks duplicate feeds as already subscribed', async () => {
    await selectFile()
    await waitFor(() => {
      expect(screen.getByText('Already subscribed')).toBeTruthy()
    })
  })

  it('defaults duplicate feeds to unchecked', async () => {
    await selectFile()
    await waitFor(() => {
      const checkboxes = screen.getAllByRole('checkbox')
      // HN (duplicate) should be unchecked, Lobsters and xkcd should be checked
      const hnCheckbox = checkboxes.find(cb => {
        const label = cb.closest('label')
        return label?.textContent?.includes('Hacker News')
      })
      expect(hnCheckbox).toBeDefined()
      expect((hnCheckbox as HTMLInputElement).checked).toBe(false)

      const lobstersCheckbox = checkboxes.find(cb => {
        const label = cb.closest('label')
        return label?.textContent?.includes('Lobsters')
      })
      expect((lobstersCheckbox as HTMLInputElement).checked).toBe(true)
    })
  })

  it('select all / deselect all works', async () => {
    await selectFile()
    await waitFor(() => screen.getByText('Select All'))

    // Deselect all
    await user.click(screen.getByText('Deselect All'))
    const checkboxes = screen.getAllByRole('checkbox')
    checkboxes.forEach(cb => {
      expect((cb as HTMLInputElement).checked).toBe(false)
    })

    // Select all
    await user.click(screen.getByText('Select All'))
    screen.getAllByRole('checkbox').forEach(cb => {
      expect((cb as HTMLInputElement).checked).toBe(true)
    })
  })

  it('shows correct count in import button', async () => {
    await selectFile()
    await waitFor(() => {
      // 2 non-duplicate feeds selected by default
      expect(screen.getByText('Import 2 feeds')).toBeTruthy()
    })
  })

  it('calls importOpml with the selected RSS URLs on import', async () => {
    await selectFile()
    await waitFor(() => screen.getByText('Import 2 feeds'))

    await user.click(screen.getByText('Import 2 feeds'))

    await waitFor(() => {
      expect(mockImportOpml).toHaveBeenCalledTimes(1)
      const [file, urls] = mockImportOpml.mock.calls[0]
      expect(file).toBeInstanceOf(File)
      expect(urls).toEqual(expect.arrayContaining(['https://lobste.rs/rss', 'https://xkcd.com/rss.xml']))
      expect(urls).not.toContain('https://news.ycombinator.com/rss')
    })
  })

  it('tracks selection per feed when several feeds share one site url', async () => {
    mockPreviewOpml.mockResolvedValue({
      feeds: [
        { name: 'Channel A', url: 'https://proxy.example.com', rssUrl: 'https://proxy.example.com/?c=AAA', categoryName: 'Youtube', isDuplicate: false },
        { name: 'Channel B', url: 'https://proxy.example.com', rssUrl: 'https://proxy.example.com/?c=BBB', categoryName: 'Youtube', isDuplicate: false },
      ],
      totalCount: 2,
      duplicateCount: 0,
    })

    await selectFile()
    await waitFor(() => screen.getByText('Import 2 feeds'))

    // Unchecking one feed must not uncheck the other
    await user.click(screen.getAllByRole('checkbox')[0])
    await waitFor(() => screen.getByText('Import 1 feeds'))

    await user.click(screen.getByText('Import 1 feeds'))

    await waitFor(() => {
      const [, urls] = mockImportOpml.mock.calls[0]
      expect(urls).toEqual(['https://proxy.example.com/?c=BBB'])
    })
  })

  it('groups feeds by category', async () => {
    await selectFile()
    await waitFor(() => {
      expect(screen.getByText('Tech')).toBeTruthy()
      expect(screen.getByText('Uncategorized')).toBeTruthy()
    })
  })
})
