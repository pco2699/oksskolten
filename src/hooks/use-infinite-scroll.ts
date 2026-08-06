import { useCallback, useEffect, useRef } from 'react'

interface Options {
  /** Whether another page exists. */
  hasMore: boolean
  /** Whether a fetch is currently in flight. */
  isLoading: boolean
  /** Request the next page. */
  loadMore: () => void
  /** Distance from the viewport at which to prefetch, in px. */
  rootMargin?: number
}

/**
 * Drive pagination from a sentinel element.
 *
 * Two things need to trigger a load: the sentinel scrolling into view, and a
 * fetch completing while the sentinel is *still* in view (IntersectionObserver
 * only fires on threshold crossings, so a short page would otherwise stall).
 * Both go through one guarded path here — previously they were separate call
 * sites that could fire in the same tick and collapse into a single advance.
 */
export function useInfiniteScroll({ hasMore, isLoading, loadMore, rootMargin = 200 }: Options) {
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const observerRef = useRef<IntersectionObserver | null>(null)

  // Latest values, read by the observer callback without recreating it.
  const state = useRef({ hasMore, isLoading, loadMore })
  state.current = { hasMore, isLoading, loadMore }

  // Guards against a second request between calling loadMore and `isLoading`
  // flipping true on the next render.
  const pending = useRef(false)
  useEffect(() => {
    if (!isLoading) pending.current = false
  }, [isLoading])

  const requestMore = useCallback(() => {
    const { hasMore: more, isLoading: loading, loadMore: load } = state.current
    if (!more || loading || pending.current) return
    pending.current = true
    load()
  }, [])

  const sentinelCallbackRef = useCallback((node: HTMLDivElement | null) => {
    observerRef.current?.disconnect()
    observerRef.current = null
    sentinelRef.current = node
    if (!node) return

    const observer = new IntersectionObserver(
      entries => { if (entries[0].isIntersecting) requestMore() },
      { rootMargin: `${rootMargin}px` },
    )
    observer.observe(node)
    observerRef.current = observer
  }, [requestMore, rootMargin])

  // Re-arm when a fetch finishes and the sentinel never left the viewport.
  useEffect(() => {
    if (isLoading || !hasMore || !sentinelRef.current) return
    const rect = sentinelRef.current.getBoundingClientRect()
    if (rect.top < window.innerHeight + rootMargin) requestMore()
  }, [isLoading, hasMore, rootMargin, requestMore])

  useEffect(() => () => observerRef.current?.disconnect(), [])

  return { sentinelCallbackRef, requestMore }
}
