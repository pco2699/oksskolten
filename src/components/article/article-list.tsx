import { memo, useState, useRef, useEffect, useCallback, useImperativeHandle, forwardRef, useMemo } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import useSWR from 'swr'
import useSWRInfinite from 'swr/infinite'
import { useSWRConfig } from 'swr'
import { fetcher } from '../../lib/fetcher'
import { useI18n } from '../../lib/i18n'
import { useIsTouchDevice } from '../../hooks/use-is-touch-device'
import { useInfiniteScroll } from '../../hooks/use-infinite-scroll'
import { useMarkReadOnScroll } from '../../hooks/use-mark-read-on-scroll'
import { useOptimisticArticleToggle, type ToggleField } from '../../hooks/use-optimistic-article-toggle'
import { useClipFeedId } from '../../hooks/use-clip-feed-id'
import { useAppLayout } from '../../app'
import { ArticleCard, type ArticleDisplayConfig } from './article-card'
import { FeedMetricsBar } from '../feed/feed-metrics-bar'
import { SwipeableArticleCard } from './swipeable-article-card'
import { articleUrlToPath } from '../../lib/url'
import { ArticleOverlay } from './article-overlay'
import { PullToRefresh } from '../layout/pull-to-refresh'
import { useFetchProgressContext } from '../../contexts/fetch-progress-context'
import { toast } from 'sonner'
import { Mascot } from '../ui/mascot'
import { FeedErrorBanner } from '../feed/feed-error-banner'
import { Skeleton } from '../ui/skeleton'
import { ActionChip } from '../ui/action-chip'
import { Circle, CircleDot } from 'lucide-react'
import { ConfirmDialog } from '../ui/confirm-dialog'
import { useKeyboardNavigationContext } from '../../contexts/keyboard-navigation-context'
import { useKeyboardNavigation } from '../../hooks/use-keyboard-navigation'
import type { ArticleListItem, FeedWithCounts } from '../../../shared/types'
import type { LayoutName } from '../../data/layouts'

interface ArticlesResponse {
  articles: ArticleListItem[]
  total: number
  has_more: boolean
  total_without_floor?: number
  total_all?: number
}

const PAGE_SIZE = 20

interface CardItemProps extends ArticleDisplayConfig {
  article: ArticleListItem
  layout: LayoutName
  isFeatured: boolean
  onClick?: (e: React.MouseEvent<HTMLAnchorElement>) => void
  isTouchDevice: boolean
  toggleArticleField: (article: Pick<ArticleListItem, 'id' | 'url'> & Partial<Record<ToggleField, string | null>>, field: ToggleField) => void
}

const CardItem = memo(function CardItem({ article, layout, isFeatured, onClick, isTouchDevice, toggleArticleField, ...displayConfig }: CardItemProps) {
  const onToggleBookmark = useCallback(() => {
    void toggleArticleField(article, 'bookmarked_at')
  }, [article, toggleArticleField])

  const onToggleLike = useCallback(() => {
    void toggleArticleField(article, 'liked_at')
  }, [article, toggleArticleField])

  const isList = layout === 'list'
  const cardProps = {
    article,
    layout,
    isFeatured,
    onClick,
    onToggleBookmark: isList ? onToggleBookmark : undefined,
    onToggleLike: isList ? onToggleLike : undefined,
    ...displayConfig,
  }

  if (isTouchDevice) {
    return <SwipeableArticleCard {...cardProps} />
  }
  return <ArticleCard {...cardProps} />
})

export interface ArticleListHandle {
  revalidate: () => void
}

export const ArticleList = forwardRef<ArticleListHandle, object>(function ArticleList(_props, ref) {
  const location = useLocation()
  const navigate = useNavigate()
  const { feedId: feedIdParam, categoryId: categoryIdParam } = useParams<{ feedId?: string; categoryId?: string }>()
  const { settings } = useAppLayout()
  const clipFeedId = useClipFeedId()

  const isBookmarks = location.pathname === '/bookmarks'
  const isLikes = location.pathname === '/likes'
  const isHistory = location.pathname === '/history'
  const isClips = location.pathname === '/clips'
  const isCollectionView = isBookmarks || isLikes || isHistory || isClips

  const { data: feedsData } = useSWR<{ feeds: FeedWithCounts[] }>('/api/feeds', fetcher)
  const feedId = feedIdParam ? Number(feedIdParam) : (isClips && clipFeedId ? clipFeedId : undefined)
  const currentFeed = feedId && feedsData ? feedsData.feeds.find(f => f.id === feedId) : undefined
  const categoryId = categoryIdParam ? Number(categoryIdParam) : undefined
  const [showReadArticles, setShowReadArticles] = useState(false)
  // The unread-only filter applies to every feed/folder list including "All".
  // It is a persisted setting (also editable in Settings → Reading) that the
  // toolbar toggle flips, plus a per-view showReadArticles escape hatch used by
  // the "all caught up" empty state.
  const canFilterUnread = !isCollectionView
  const unreadFilterEnabled = canFilterUnread && settings.categoryUnreadOnly === 'on'
  const unreadOnly = unreadFilterEnabled && !showReadArticles
  const bookmarkedOnly = isBookmarks
  const likedOnly = isLikes
  const readOnly = isHistory
  const { autoMarkRead, dateMode, indicatorStyle, layout, articleOpenMode, keyboardNavigation, keybindings } = settings
  const [overlayUrl, setOverlayUrl] = useState<string | null>(null)
  const [markAllReadConfirmOpen, setMarkAllReadConfirmOpen] = useState(false)
  const [noFloor, setNoFloor] = useState(false)
  const displayConfig: ArticleDisplayConfig = useMemo(() => ({
    dateMode,
    indicatorStyle,
    showUnreadIndicator: settings.showUnreadIndicator === 'on',
    showThumbnails: settings.showThumbnails === 'on',
  }), [dateMode, indicatorStyle, settings.showUnreadIndicator, settings.showThumbnails])
  const isGridLayout = layout === 'card' || layout === 'magazine'
  const { t } = useI18n()
  const { progress, startFeedFetch } = useFetchProgressContext()
  const { mutate: globalMutate } = useSWRConfig()

  // Anchor for the unread filter, sent to the server as `unread_since`.
  //
  // Without it, OFFSET pagination over an unread-filtered list loses articles:
  // every article marked read while reading shrinks the server-side result set,
  // so the next page starts as many articles further down as were read and the
  // ones in between are never shown (and so never get marked read either).
  // Pinning the filter to the moment the view was opened keeps the result set
  // stable for as long as the reader stays in it. Recomputed when the view or
  // the filter changes so that turning the filter on hides what was already
  // read before that point, and on an explicit revalidate() so that a
  // "mark all as read" clears the list instead of leaving it full of read items.
  const [unreadAnchorGeneration, setUnreadAnchorGeneration] = useState(0)
  const unreadViewKey = `${location.pathname}:${unreadOnly}:${unreadAnchorGeneration}`
  const unreadAnchorRef = useRef({ view: unreadViewKey, since: new Date().toISOString() })
  if (unreadAnchorRef.current.view !== unreadViewKey) {
    unreadAnchorRef.current = { view: unreadViewKey, since: new Date().toISOString() }
  }
  const unreadSince = unreadAnchorRef.current.since

  const getKey = (pageIndex: number, previousPageData: ArticlesResponse | null) => {
    if (previousPageData && !previousPageData.has_more) return null
    const params = new URLSearchParams()
    if (feedId) params.set('feed_id', String(feedId))
    if (categoryId) params.set('category_id', String(categoryId))
    if (unreadOnly) {
      params.set('unread', '1')
      params.set('unread_since', unreadSince)
    }
    if (bookmarkedOnly) params.set('bookmarked', '1')
    if (likedOnly) params.set('liked', '1')
    if (readOnly) params.set('read', '1')
    if (noFloor) params.set('no_floor', '1')
    params.set('limit', String(PAGE_SIZE))
    params.set('offset', String(pageIndex * PAGE_SIZE))
    return `/api/articles?${params.toString()}`
  }

  const { data, error, setSize, isLoading, isValidating, mutate } = useSWRInfinite<ArticlesResponse>(
    getKey,
    fetcher,
    {
      revalidateFirstPage: isCollectionView,
    },
  )

  useImperativeHandle(ref, () => ({
    revalidate: () => {
      // A fresh anchor changes every page key, which refetches the list from
      // scratch — the point of revalidating an unread view is usually to drop
      // what was just marked read. Without the filter the keys do not carry the
      // anchor, so fall back to a plain revalidation.
      if (unreadOnly) setUnreadAnchorGeneration(g => g + 1)
      else void mutate()
    },
  }), [mutate, unreadOnly])

  const articles = useMemo(() => data ? data.flatMap(page => page.articles) : [], [data])
  const hasMore = data ? data[data.length - 1]?.has_more ?? false : false
  const isEmpty = data?.[0]?.articles.length === 0
  const totalAll = data?.[0]?.total_all
  const allReadEmpty = isEmpty && unreadOnly && totalAll != null && totalAll > 0
  const hiddenByFloor = data?.[0]?.total_without_floor != null
    ? data[0].total_without_floor - (data[0].total ?? 0)
    : 0

  // ---------------------------------------------------------------------------
  // Keyboard navigation
  // ---------------------------------------------------------------------------
  const { focusedItemId, setFocusedItemId, setArticleIds, setArticleUrls, setLastListUrl } = useKeyboardNavigationContext()
  const isKeyboardNavEnabled = keyboardNavigation === 'on' && !isGridLayout

  const articleIds = useMemo(() => articles.map(a => String(a.id)), [articles])
  const articleUrls = useMemo(() => {
    const map: Record<string, string> = {}
    for (const a of articles) map[String(a.id)] = a.url
    return map
  }, [articles])

  useEffect(() => {
    setArticleIds(articleIds)
    setArticleUrls(articleUrls)
  }, [articleIds, articleUrls, setArticleIds, setArticleUrls])

  useEffect(() => {
    setLastListUrl(location.pathname)
  }, [location.pathname, setLastListUrl])

  const articleMap = useMemo(() => {
    const map = new Map<string, ArticleListItem>()
    for (const a of articles) map.set(String(a.id), a)
    return map
  }, [articles])

  const isOverlayMode = articleOpenMode === 'overlay'
  // Short debounce after overlay close to prevent Escape from immediately clearing focus
  const escapeDebounceRef = useRef(false)

  // ---------------------------------------------------------------------------
  // Pagination, read tracking, and optimistic mutations
  // ---------------------------------------------------------------------------
  /** Identifies the current view; changing it resets per-view state. */
  const viewKey = `${location.pathname}:${feedId ?? ''}:${categoryId ?? ''}`

  const isAutoMarkEnabled = autoMarkRead === 'on'
  const isTouchDevice = useIsTouchDevice()
  const listRef = useRef<HTMLElement>(null)

  const { sentinelCallbackRef, requestMore } = useInfiniteScroll({
    hasMore,
    isLoading: isValidating,
    loadMore: () => { void setSize(prev => prev + 1) },
  })

  const { autoReadIds, markRead, markManyRead } = useMarkReadOnScroll({
    enabled: isAutoMarkEnabled,
    listRef,
    viewKey,
  })

  const toggleArticleField = useOptimisticArticleToggle<ArticlesResponse>(mutate)

  useKeyboardNavigation({
    items: articleIds,
    focusedItemId,
    onFocusChange: (id) => {
      // Advancing past an article with the next key (j) marks the article the
      // user is leaving as read — a Feedly-style "mark read on advance"
      // behavior. Only forward moves count: moving backward (k) or the initial
      // focus (no previous item yet) never marks anything. Reuses the same
      // auto-read pipeline (autoReadIds + batchQueue) as the scroll-based
      // auto-mark-read above, so the UI updates instantly and the server sync
      // stays batched — the Set-based queue naturally dedupes with any id the
      // scroll observer already enqueued.
      if (autoMarkRead === 'on' && focusedItemId != null) {
        const fromIndex = articleIds.indexOf(focusedItemId)
        const toIndex = articleIds.indexOf(id)
        const isAdvance = fromIndex !== -1 && toIndex !== -1 && toIndex > fromIndex
        if (isAdvance) {
          const prevArticle = articleMap.get(focusedItemId)
          if (prevArticle && prevArticle.seen_at == null && !autoReadIds.has(prevArticle.id)) {
            markRead(prevArticle.id)
          }
        }
      }
      setFocusedItemId(id)
      const el = document.querySelector(`[data-article-id="${id}"]`)
      el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      // Overlay mode: if the overlay is already open, j/k swaps the article
      // shown in it (in sync with the new focus). If the overlay is closed,
      // j/k only moves the list selection — it must not auto-open the overlay.
      // (When the overlay is open, the departed article was already marked
      // read on mount by ArticleDetail, so the advance-mark above is a no-op.)
      if (isOverlayMode && overlayUrl != null) {
        const article = articleMap.get(id)
        if (article) setOverlayUrl(article.url)
      }
    },
    onEnter: (id) => {
      const article = articleMap.get(id)
      if (!article) return
      if (isOverlayMode) {
        // Overlay mode: o/Enter opens the focused article in the overlay
        setOverlayUrl(article.url)
      } else {
        // Page mode: Enter navigates to the article page
        void navigate(articleUrlToPath(article.url))
      }
    },
    onEscape: () => {
      if (escapeDebounceRef.current) return
      setFocusedItemId(null)
    },
    onBookmarkToggle: (id) => {
      const article = articleMap.get(id)
      if (article) void toggleArticleField(article, 'bookmarked_at')
    },
    onOpenExternal: (id) => {
      const article = articleMap.get(id)
      if (article?.url) window.open(article.url, '_blank')
    },
    onToggleRead: (id) => {
      const article = articleMap.get(id)
      if (article) void toggleArticleField(article, 'seen_at')
    },
    onMarkAllRead: () => setMarkAllReadConfirmOpen(true),
    onNearEnd: () => requestMore(),
    enabled: isKeyboardNavEnabled,
    keyBindings: keybindings,
  })

  // Mark all currently loaded articles in this view as read (Shift+A shortcut)
  const handleMarkAllReadConfirmed = useCallback(() => {
    setMarkAllReadConfirmOpen(false)
    markManyRead(articles.map(a => a.id))
  }, [articles, markManyRead])

  useEffect(() => {
    setNoFloor(false)
    setShowReadArticles(false)
    setFocusedItemId(null)
  }, [viewKey, setFocusedItemId])

  return (
    <main ref={listRef} className="max-w-2xl md:max-w-3xl lg:max-w-4xl mx-auto" role={!isGridLayout ? 'listbox' : undefined}>
      {isTouchDevice && <PullToRefresh onRefresh={async () => {
        if (feedId) {
          const result = await startFeedFetch(feedId)
          const name = currentFeed?.name ?? ''
          if (result.error) toast.error(t('toast.fetchError', { name }))
          else if (result.totalNew > 0) toast.success(t('toast.fetchedArticles', { count: String(result.totalNew), name }))
          else toast(t('toast.noNewArticles', { name }))
        } else {
          await mutate()
        }
      }} />}

      {currentFeed && currentFeed.type !== 'clip' && settings.showFeedActivity === 'on' && (
        <FeedMetricsBar feed={currentFeed} />
      )}

      {canFilterUnread && (
        <div className="flex justify-end px-4 md:px-6 pt-2 pb-1">
          <ActionChip
            active={unreadOnly}
            aria-pressed={unreadOnly}
            onClick={() => {
              setShowReadArticles(false)
              settings.setCategoryUnreadOnly(unreadOnly ? 'off' : 'on')
            }}
            tooltip={t('articles.unreadOnlyTooltip')}
          >
            {unreadOnly ? <CircleDot size={13} /> : <Circle size={13} />}
            {t('articles.unreadOnly')}
          </ActionChip>
        </div>
      )}

      {isLoading && <ArticleListSkeleton layout={layout} showThumbnails={displayConfig.showThumbnails} />}

      {error && (
        <div className="text-center py-12">
          <p className="text-muted mb-2">{t('articles.loadError')}</p>
          <button onClick={() => setSize(1)} className="text-accent text-sm">
            {t('articles.retry')}
          </button>
        </div>
      )}

      {allReadEmpty && !isLoading && (
        <div className="text-center py-12">
          <p className="text-muted mb-3">{t('articles.allRead')}</p>
          <button
            onClick={() => setShowReadArticles(true)}
            className="text-accent text-sm hover:underline"
          >
            {t('articles.showReadArticles')}
          </button>
        </div>
      )}

      {isEmpty && !allReadEmpty && !isLoading && currentFeed && feedId && progress.has(feedId) && (
        <FeedErrorBanner
          lastError={currentFeed.last_error ?? ''}
          feedId={currentFeed.id}
          overridePhase="processing"
        />
      )}

      {isEmpty && !allReadEmpty && !isLoading && !(feedId && progress.has(feedId)) && (
        currentFeed?.last_error ? (
          <FeedErrorBanner
            lastError={currentFeed.last_error}
            feedId={currentFeed.id}
            onMutate={async () => {
              await globalMutate((key: unknown) => typeof key === 'string' && key.startsWith('/api/feeds'))
            }}
            onFetch={currentFeed.type !== 'clip' ? async () => {
              const result = await startFeedFetch(currentFeed.id)
              const name = currentFeed.name
              if (result.error) toast.error(t('toast.fetchError', { name }))
              else if (result.totalNew > 0) { toast.success(t('toast.fetchedArticles', { count: String(result.totalNew), name })); void mutate() }
              else toast(t('toast.noNewArticles', { name }))
            } : undefined}
          />
        ) : (
          <p className="text-muted text-center py-12">{t('articles.empty')}</p>
        )
      )}

      <div className={isGridLayout ? 'grid grid-cols-1 md:grid-cols-2 gap-4 px-4 md:px-6' : ''}>
        {articles.map((article, index) => {
          const isAutoRead = autoReadIds.has(article.id)
          const effectiveArticle = isAutoRead
            ? { ...article, seen_at: article.seen_at ?? new Date().toISOString() }
            : article
          const handleOverlayOpen = articleOpenMode === 'overlay' ? (e: React.MouseEvent<HTMLAnchorElement>) => {
            if (e.metaKey || e.ctrlKey || e.button === 1) return
            e.preventDefault()
            setOverlayUrl(article.url)
          } : undefined
          const isKbFocused = focusedItemId === String(article.id)
          return (
            <div
              key={article.id}
              data-article-id={article.id}
              data-article-unread={article.seen_at == null && !isAutoRead ? '1' : '0'}
              aria-selected={isKbFocused || undefined}
              className={layout === 'magazine' && index === 0 ? 'col-span-full' : ''}
              style={isKbFocused ? {
                borderLeft: '2px solid var(--color-accent)',
                backgroundColor: 'color-mix(in srgb, var(--color-accent) 10%, transparent)',
              } : undefined}
              onClick={() => {
                if (!isGridLayout) {
                  setFocusedItemId(String(article.id))
                }
              }}
            >
              <CardItem
                article={effectiveArticle}
                layout={layout}
                isFeatured={layout === 'magazine' && index === 0}
                onClick={handleOverlayOpen}
                isTouchDevice={isTouchDevice}
                toggleArticleField={toggleArticleField}
                {...displayConfig}
              />
            </div>
          )
        })}
      </div>

      {hasMore && (
        <div ref={sentinelCallbackRef} className="py-4">
          {isValidating && <ArticleListSkeleton layout={layout} count={2} showThumbnails={displayConfig.showThumbnails} />}
        </div>
      )}

      {!hasMore && hiddenByFloor > 0 && (
        <div className="text-center py-6">
          <button
            onClick={() => setNoFloor(true)}
            className="text-accent text-sm hover:underline"
          >
            {t('articles.showOlder', { count: String(hiddenByFloor) })}
          </button>
        </div>
      )}

      {/* Scroll spacer: ensures the last article can scroll past the header for auto-mark-read */}
      {!hasMore && articles.length > 0 && isAutoMarkEnabled && !isCollectionView && (
        <div
          className="flex flex-col items-center justify-end select-none"
          style={{ minHeight: 'calc(100vh - var(--header-height))' }}
        >
          {settings.mascot !== 'off' && (
            <>
              <div>
                <Mascot choice={settings.mascot} />
              </div>
              <p className="text-muted/40 text-xs mt-4 pb-4">{t('articles.allCaughtUp')}</p>
            </>
          )}
        </div>
      )}

      <ArticleOverlay
        articleUrl={overlayUrl}
        onNavigate={(url) => {
          const article = articles.find(a => a.url === url)
          if (article) setFocusedItemId(String(article.id))
          setOverlayUrl(url)
        }}
        onClose={() => {
          setOverlayUrl(null)
          escapeDebounceRef.current = true
          setTimeout(() => { escapeDebounceRef.current = false }, 100)
        }}
      />

      {markAllReadConfirmOpen && (
        <ConfirmDialog
          title={t('feeds.markAllRead')}
          message={t('articles.markAllReadConfirm')}
          confirmLabel={t('feeds.markAllRead')}
          onConfirm={handleMarkAllReadConfirmed}
          onCancel={() => setMarkAllReadConfirmOpen(false)}
        />
      )}
    </main>
  )
})

function ArticleListSkeleton({ layout = 'list', count = 3, showThumbnails = true }: { layout?: LayoutName; count?: number; showThumbnails?: boolean }) {
  if (layout === 'compact') {
    return (
      <>
        {Array.from({ length: count * 2 }).map((_, i) => (
          <div key={i} className="border-b border-border py-1.5 px-4 md:px-6">
            <div className="flex items-center gap-2">
              <div className="w-2.5 shrink-0" />
              <Skeleton className="h-3.5 flex-1" />
              <Skeleton className="h-3 w-12 shrink-0" />
            </div>
          </div>
        ))}
      </>
    )
  }

  if (layout === 'card') {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 px-4 md:px-6">
        {Array.from({ length: count * 2 }).map((_, i) => (
          <div key={i} className="border border-border rounded-lg overflow-hidden">
            {showThumbnails && <Skeleton className="w-full aspect-video" />}
            <div className="p-3 space-y-1.5">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
              <div className="flex items-center gap-1 mt-1">
                <Skeleton className="w-3 h-3 shrink-0" />
                <Skeleton className="h-3 w-24" />
              </div>
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (layout === 'magazine') {
    return (
      <>
        {/* Hero skeleton */}
        <div className="border border-border rounded-lg overflow-hidden mb-4 mx-4 md:mx-6">
          {showThumbnails && <Skeleton className="w-full aspect-video" />}
          <div className="p-4 space-y-2">
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-3.5 w-full" />
            <Skeleton className="h-3.5 w-2/3" />
            <div className="flex items-center gap-1 mt-1">
              <Skeleton className="w-3.5 h-3.5 shrink-0" />
              <Skeleton className="h-3 w-28" />
            </div>
          </div>
        </div>
        {/* Small card skeletons */}
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className="flex gap-3 border-b border-border py-2 px-4 md:px-6">
            {showThumbnails && <Skeleton className="w-12 h-12 shrink-0" />}
            <div className="flex-1 min-w-0 space-y-1.5">
              <Skeleton className="h-3.5 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
              <div className="flex items-center gap-1 mt-0.5">
                <Skeleton className="w-3 h-3 shrink-0" />
                <Skeleton className="h-3 w-20" />
              </div>
            </div>
          </div>
        ))}
      </>
    )
  }

  // Default: list layout
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="border-b border-border py-3 md:py-5 px-4 md:px-6">
          <div className="flex items-center md:items-start gap-2 md:gap-4">
            <div className="w-3 shrink-0" />
            <div className="flex-1 min-w-0 space-y-1.5 md:space-y-2">
              <Skeleton className="h-4 w-3/4 md:h-5" />
              <Skeleton className="h-3 w-1/2 md:h-4 md:w-2/3" />
              <div className="flex items-center gap-1 mt-0.5 md:mt-1">
                <Skeleton className="w-3.5 h-3.5 shrink-0" />
                <Skeleton className="h-3 w-28" />
              </div>
            </div>
            {showThumbnails && <Skeleton className="w-16 h-16 md:w-28 md:h-20 shrink-0" />}
          </div>
        </div>
      ))}
    </>
  )
}
