import { useState, useRef, useMemo } from 'react'
import { useSWRConfig } from 'swr'
import { useI18n } from '../../../lib/i18n'
import { importOpml, fetchOpmlBlob, previewOpml } from '../../../lib/fetcher'
import type { OpmlPreviewResponse, OpmlPreviewFeed } from '../../../lib/fetcher'
import { Upload, Download } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../../../components/ui/dialog'

export function DataSection() {
  const { t } = useI18n()
  const { mutate: globalMutate } = useSWRConfig()
  const fileRef = useRef<HTMLInputElement>(null)
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<{ imported: number; skipped: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Preview state
  const [previewData, setPreviewData] = useState<OpmlPreviewResponse | null>(null)
  const [selectedUrls, setSelectedUrls] = useState<Set<string>>(new Set())
  const [previewFile, setPreviewFile] = useState<File | null>(null)
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)
  const [isPreviewing, setIsPreviewing] = useState(false)

  const groupedFeeds = useMemo(() => {
    if (!previewData) return []
    const groups = new Map<string, OpmlPreviewFeed[]>()
    for (const feed of previewData.feeds) {
      const key = feed.categoryName ?? 'Uncategorized'
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(feed)
    }
    return Array.from(groups.entries()).map(([name, feeds]) => ({ name, feeds }))
  }, [previewData])

  const selectedCount = selectedUrls.size

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    setIsPreviewing(true)
    setResult(null)
    setError(null)

    try {
      const preview = await previewOpml(file)
      setPreviewData(preview)
      setPreviewFile(file)
      setSelectedUrls(new Set(
        preview.feeds.filter((f) => !f.isDuplicate).map((f) => f.rssUrl)
      ))
      setIsPreviewOpen(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Preview failed')
    } finally {
      setIsPreviewing(false)
      e.target.value = ''
    }
  }

  async function handleImport() {
    if (!previewFile) return
    setImporting(true)
    try {
      const data = await importOpml(previewFile, Array.from(selectedUrls))
      setResult({ imported: data.imported, skipped: data.skipped })
      void globalMutate((key: unknown) =>
        typeof key === 'string' && (key.includes('/api/feeds') || key.includes('/api/articles') || key.includes('/api/categories')),
      )
      setIsPreviewOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setImporting(false)
    }
  }

  function toggleUrl(url: string) {
    setSelectedUrls((prev) => {
      const next = new Set(prev)
      if (next.has(url)) {
        next.delete(url)
      } else {
        next.add(url)
      }
      return next
    })
  }

  function selectAll() {
    if (!previewData) return
    setSelectedUrls(new Set(previewData.feeds.map((f) => f.rssUrl)))
  }

  function deselectAll() {
    setSelectedUrls(new Set())
  }

  async function handleExport() {
    const blob = await fetchOpmlBlob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'oksskolten.opml'
    a.click()
    URL.revokeObjectURL(url)
  }

  function formatHostname(url: string): string {
    try {
      return new URL(url).hostname
    } catch {
      return url
    }
  }

  return (
    <section>
      <h2 className="text-base font-semibold text-text mb-4">{t('settings.importExport')}</h2>

      <div>
        <p className="text-sm text-text mb-1">{t('settings.importOpml')}</p>
        <p className="text-xs text-muted mb-3">{t('settings.importOpmlDesc')}</p>
        <input
          ref={fileRef}
          type="file"
          accept=".opml,.xml"
          onChange={handleFileChange}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={isPreviewing || importing}
          className="inline-flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg border border-border text-text hover:bg-hover transition-colors disabled:opacity-50"
        >
          <Upload size={14} />
          {isPreviewing ? t('settings.previewing') : t('settings.importOpml')}
        </button>
        {result && (
          <p className="text-xs text-accent mt-2">
            Imported {result.imported} feeds ({result.skipped} skipped)
          </p>
        )}
        {error && (
          <p className="text-xs text-error mt-2">{error}</p>
        )}
      </div>

      <div className="mt-6">
        <p className="text-sm text-text mb-1">{t('settings.exportOpml')}</p>
        <p className="text-xs text-muted mb-3">{t('settings.exportOpmlDesc')}</p>
        <button
          type="button"
          onClick={handleExport}
          className="inline-flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg border border-border text-text hover:bg-hover transition-colors"
        >
          <Download size={14} />
          {t('settings.exportOpml')}
        </button>
      </div>

      {/* OPML Preview Dialog */}
      <Dialog open={isPreviewOpen} onOpenChange={setIsPreviewOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('settings.importOpml')}</DialogTitle>
            {previewData && (
              <DialogDescription>
                {t('settings.feedsSelected')
                  .replace('{selected}', String(selectedCount))
                  .replace('{total}', String(previewData.totalCount))
                  .replace('{duplicates}', String(previewData.duplicateCount))}
              </DialogDescription>
            )}
          </DialogHeader>

          {/* Select All / Deselect All */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={selectAll}
              className="text-xs text-accent hover:underline"
            >
              {t('settings.selectAll')}
            </button>
            <button
              type="button"
              onClick={deselectAll}
              className="text-xs text-accent hover:underline"
            >
              {t('settings.deselectAll')}
            </button>
          </div>

          {/* Feed list */}
          <div className="max-h-[60vh] overflow-y-auto -mx-6 px-6">
            {groupedFeeds.map(({ name, feeds }) => (
              <div key={name} className="mb-3">
                <div className="text-xs font-medium text-muted uppercase tracking-wide mb-1.5 border-b border-border pb-1">
                  {name}
                </div>
                <div className="space-y-1">
                  {feeds.map((feed) => (
                    <label
                      key={feed.rssUrl}
                      className="flex items-start gap-2 py-1 px-1 rounded hover:bg-hover cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={selectedUrls.has(feed.rssUrl)}
                        onChange={() => toggleUrl(feed.rssUrl)}
                        className="mt-0.5 accent-accent"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-text truncate">{feed.name}</span>
                          <span className="text-xs text-muted truncate flex-shrink-0">
                            {formatHostname(feed.url)}
                          </span>
                        </div>
                        {feed.isDuplicate && (
                          <span className="text-xs text-muted italic">
                            {t('settings.alreadySubscribed')}
                          </span>
                        )}
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <DialogFooter>
            <button
              type="button"
              onClick={() => setIsPreviewOpen(false)}
              className="px-3 py-1.5 text-sm rounded-lg border border-border text-text hover:bg-hover transition-colors"
            >
              {t('header.back')}
            </button>
            <button
              type="button"
              onClick={handleImport}
              disabled={importing || selectedCount === 0}
              className="px-3 py-1.5 text-sm rounded-lg bg-accent text-white hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {importing
                ? t('settings.importing')
                : t('settings.importSelected').replace('{count}', String(selectedCount))}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
