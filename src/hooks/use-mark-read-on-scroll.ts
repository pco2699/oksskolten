import { useCallback, useEffect, useRef, useState } from 'react'
import { useSWRConfig } from 'swr'
import { markSeenOnServer } from '../lib/markSeenWithQueue'
import { trackRead } from '../lib/readTracker'

/** How often (ms) to flush the batch of read article ids to the server. */
const BATCH_FLUSH_INTERVAL = 1500

interface Options {
  /** Whether scroll-based auto-marking is turned on. */
  enabled: boolean
  /** Element containing the article nodes (each tagged `data-article-id`). */
  listRef: React.RefObject<HTMLElement | null>
  /** Changing this resets the local read set — e.g. on feed/category change. */
  viewKey: string
}

/**
 * Mark articles read as they scroll above the header.
 *
 * Reads are applied to the UI immediately via a local id set and flushed to the
 * server in batches. The IntersectionObserver instance is created once and new
 * nodes from infinite scroll are attached incrementally by a MutationObserver —
 * recreating the observer per page caused missed and duplicated read events.
 */
export function useMarkReadOnScroll({ enabled, listRef, viewKey }: Options) {
  const { mutate: globalMutate } = useSWRConfig()
  const [autoReadIds, setAutoReadIds] = useState<Set<number>>(() => new Set())

  const observerRef = useRef<IntersectionObserver | null>(null)
  const batchQueue = useRef(new Set<number>())
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flushBatch = useCallback(() => {
    if (batchQueue.current.size === 0) return
    const ids = [...batchQueue.current]
    batchQueue.current.clear()
    markSeenOnServer(ids)
      .then(() => globalMutate((key: unknown) => typeof key === 'string' && key.startsWith('/api/feeds')))
      .catch(() => {})
  }, [globalMutate])

  const scheduleFlush = useCallback(() => {
    if (flushTimerRef.current) return
    flushTimerRef.current = setTimeout(() => {
      flushTimerRef.current = null
      flushBatch()
    }, BATCH_FLUSH_INTERVAL)
  }, [flushBatch])

  /** Mark one article read: instant UI update plus a queued server write. */
  const markRead = useCallback((articleId: number) => {
    setAutoReadIds(prev => {
      if (prev.has(articleId)) return prev
      const next = new Set(prev)
      next.add(articleId)
      return next
    })
    trackRead(articleId)
    batchQueue.current.add(articleId)
    scheduleFlush()
  }, [scheduleFlush])

  /** Mark a known set of articles read in one go (the "mark all read" action). */
  const markManyRead = useCallback((ids: number[]) => {
    if (ids.length === 0) return
    setAutoReadIds(prev => {
      const next = new Set(prev)
      ids.forEach(id => next.add(id))
      return next
    })
    markSeenOnServer(ids)
      .then(() => globalMutate((key: unknown) => typeof key === 'string' && key.startsWith('/api/feeds')))
      .catch(() => {})
  }, [globalMutate])

  const markReadRef = useRef(markRead)
  markReadRef.current = markRead

  // One stable IntersectionObserver for the lifetime of the enabled state.
  useEffect(() => {
    observerRef.current?.disconnect()
    observerRef.current = null
    if (!enabled) return

    // Measure the header in pixels — iOS Safari rejects rootMargin values
    // containing the calc()/env() that getComputedStyle may hand back.
    const headerEl = document.querySelector('[data-header]') as HTMLElement | null
    const headerH = headerEl ? `${headerEl.offsetHeight}px` : '48px'

    const observer = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          const el = entry.target as HTMLElement
          const articleId = Number(el.dataset.articleId)
          if (!articleId) continue
          if (el.dataset.articleUnread !== '1') continue
          const rootTop = entry.rootBounds?.top ?? 0
          if (entry.boundingClientRect.top < rootTop) markReadRef.current(articleId)
        }
      },
      { rootMargin: `-${headerH} 0px 0px 0px`, threshold: [0, 1] },
    )
    observerRef.current = observer

    const list = listRef.current
    if (list) {
      list.querySelectorAll<HTMLElement>('[data-article-id]').forEach(node => observer.observe(node))
    }

    return () => observer.disconnect()
  }, [enabled, listRef])

  // Attach nodes added by infinite scroll, keeping the observer above stable.
  useEffect(() => {
    const list = listRef.current
    const io = observerRef.current
    if (!list || !io || !enabled) return

    const mo = new MutationObserver(mutations => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (!(node instanceof HTMLElement)) continue
          if (node.dataset.articleId) io.observe(node)
          node.querySelectorAll<HTMLElement>('[data-article-id]').forEach(child => io.observe(child))
        }
      }
    })

    mo.observe(list, { childList: true, subtree: true })
    return () => mo.disconnect()
  }, [enabled, listRef])

  // Flush anything pending when leaving the view.
  useEffect(() => {
    return () => {
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current)
        flushTimerRef.current = null
      }
      flushBatch()
    }
  }, [viewKey, flushBatch])

  // A new view starts with a clean set of locally-marked reads.
  useEffect(() => { setAutoReadIds(new Set()) }, [viewKey])

  return { autoReadIds, markRead, markManyRead }
}
