import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSWRConfig } from 'swr'
import { apiPatch, apiPost, apiDelete } from '../lib/fetcher'
import type { ArticleDetail } from '../../shared/types'

export function useArticleActions(article: ArticleDetail | undefined, articleKey: string) {
  const navigate = useNavigate()
  const { mutate: globalMutate, cache } = useSWRConfig()

  const [optimisticBookmark, setOptimisticBookmark] = useState<boolean | undefined>(undefined)
  const [optimisticLiked, setOptimisticLiked] = useState<string | null | undefined>(undefined)
  const [optimisticRead, setOptimisticRead] = useState<boolean | undefined>(undefined)
  const [archivingImages, setArchivingImages] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)

  const isBookmarked = optimisticBookmark !== undefined ? optimisticBookmark : !!article?.bookmarked_at
  const isLiked = optimisticLiked !== undefined ? !!optimisticLiked : !!article?.liked_at
  const isRead = optimisticRead !== undefined ? optimisticRead : !!article?.seen_at

  // Reset optimistic state when article changes
  useEffect(() => {
    setOptimisticBookmark(undefined)
    setOptimisticLiked(undefined)
    setOptimisticRead(undefined)
  }, [article?.id])

  const revalidateLists = useCallback(() => {
    // globalMutate(filterFn) silently skips $inf$ keys produced by
    // useSWRInfinite, so walk the cache directly to cover both
    // /api/feeds (regular) and /api/articles (infinite) entries.
    for (const key of cache.keys()) {
      if (typeof key !== 'string') continue
      if (key.includes('/api/feeds') || key.includes('/api/articles')) {
        void globalMutate(key)
      }
    }
  }, [globalMutate, cache])

  const toggleBookmark = useCallback(async () => {
    if (!article) return
    const next = !isBookmarked
    setOptimisticBookmark(next)
    void globalMutate(articleKey, (current: ArticleDetail | undefined) => (
      current ? { ...current, bookmarked_at: next ? new Date().toISOString() : null } : current
    ), false)
    try {
      await apiPatch(`/api/articles/${article.id}/bookmark`, { bookmarked: next })
      void globalMutate(articleKey)
      revalidateLists()
    } catch {
      setOptimisticBookmark(undefined)
      void globalMutate(articleKey)
    }
  }, [article, articleKey, isBookmarked, globalMutate, revalidateLists])

  const toggleLike = useCallback(async () => {
    if (!article) return
    const next = !isLiked
    const nextLikedAt = next ? new Date().toISOString() : null
    setOptimisticLiked(nextLikedAt)
    void globalMutate(articleKey, (current: ArticleDetail | undefined) => (
      current ? { ...current, liked_at: nextLikedAt } : current
    ), false)
    try {
      await apiPatch(`/api/articles/${article.id}/like`, { liked: next })
      void globalMutate(articleKey)
      revalidateLists()
    } catch {
      setOptimisticLiked(undefined)
      void globalMutate(articleKey)
    }
  }, [article, articleKey, isLiked, globalMutate, revalidateLists])

  const toggleReadState = useCallback(async () => {
    if (!article) return
    const next = !isRead
    setOptimisticRead(next)
    void globalMutate(articleKey, (current: ArticleDetail | undefined) => (
      current ? { ...current, seen_at: next ? new Date().toISOString() : null } : current
    ), false)
    try {
      await apiPatch(`/api/articles/${article.id}/seen`, { seen: next })
      void globalMutate(articleKey)
      revalidateLists()
    } catch {
      setOptimisticRead(undefined)
      void globalMutate(articleKey)
    }
  }, [article, articleKey, isRead, globalMutate, revalidateLists])

  const handleArchiveImages = useCallback(async () => {
    if (!article || archivingImages) return
    setArchivingImages(true)
    try {
      await apiPost(`/api/articles/${article.id}/archive-images`)
      setTimeout(() => {
        void globalMutate(articleKey)
        setArchivingImages(false)
      }, 3000)
    } catch {
      setArchivingImages(false)
    }
  }, [article, articleKey, archivingImages, globalMutate])

  const handleDelete = useCallback(() => {
    if (!article) return
    const feedId = article.feed_id
    const articleId = article.id
    void navigate(`/feeds/${feedId}`, { replace: true })
    apiDelete(`/api/articles/${articleId}`)
      .then(() => {
        void globalMutate((key: unknown) =>
          typeof key === 'string' && key.startsWith('/api/feeds'),
        )
      })
      .catch((err) => console.warn('Failed to delete article:', err))
  }, [article, globalMutate, navigate])

  return {
    isBookmarked,
    isLiked,
    isRead,
    archivingImages,
    deleteConfirmOpen,
    setDeleteConfirmOpen,
    toggleBookmark,
    toggleLike,
    toggleReadState,
    handleArchiveImages,
    handleDelete,
  }
}
