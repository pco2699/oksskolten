import { useState } from 'react'
import { toast } from 'sonner'
import { useI18n } from '../../lib/i18n'
import { apiPatch } from '../../lib/fetcher'
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog'
import { Input } from '../ui/input'
import { Button } from '../ui/button'
import * as VisuallyHidden from '@radix-ui/react-visually-hidden'
import type { FeedWithCounts } from '../../../shared/types'

interface FeedEditDialogProps {
  feed: FeedWithCounts
  onClose: () => void
  onUpdated: () => void
}

function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

export function FeedEditDialog({ feed, onClose, onUpdated }: FeedEditDialogProps) {
  const { t } = useI18n()
  // Feeds discovered via RSS Bridge / CSS-selector inference have no direct
  // rss_url — the bridge URL is generated server-side and isn't user-editable.
  const usesBridge = !feed.rss_url && !!feed.rss_bridge_url
  const [name, setName] = useState(feed.name)
  const [rssUrl, setRssUrl] = useState(feed.rss_url ?? '')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmedName = name.trim()
    if (!trimmedName) {
      setError(t('feeds.editErrorNameRequired'))
      return
    }
    const trimmedUrl = rssUrl.trim()
    if (!usesBridge && !isValidHttpUrl(trimmedUrl)) {
      setError(t('modal.errorHttpOrHttpsOnly'))
      return
    }
    setError('')
    setSaving(true)
    try {
      await apiPatch(`/api/feeds/${feed.id}`, {
        name: trimmedName,
        ...(usesBridge ? {} : { rss_url: trimmedUrl }),
      })
      onUpdated()
      toast.success(t('feeds.editSuccess', { name: trimmedName }))
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('modal.genericError'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-w-sm" aria-describedby={undefined}>
        <VisuallyHidden.Root><DialogTitle>{t('feeds.editFeed')}</DialogTitle></VisuallyHidden.Root>
        <h2 className="text-base font-semibold mb-4">{t('feeds.editFeed')}</h2>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs text-muted">{t('feeds.editNameLabel')}</label>
            <Input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              autoFocus
              required
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted">{t('feeds.editUrlLabel')}</label>
            {usesBridge ? (
              <>
                <Input type="text" value={feed.rss_bridge_url ?? ''} readOnly disabled />
                <p className="text-xs text-muted">{t('feeds.editBridgeNote')}</p>
              </>
            ) : (
              <Input
                type="url"
                value={rssUrl}
                onChange={e => setRssUrl(e.target.value)}
                required
              />
            )}
          </div>
          {error && <p className="text-xs text-error">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={onClose}>
              {t('modal.cancel')}
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? t('feeds.editSaving') : t('feeds.editSave')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
