import { useCallback } from 'react'
import { useSWRConfig } from 'swr'
import type { SWRInfiniteKeyedMutator } from 'swr/infinite'
import { apiPatch } from '../lib/fetcher'
import type { ArticleListItem } from '../../shared/types'

/** Article fields that are a nullable timestamp toggled by a PATCH endpoint. */
export type ToggleField = 'seen_at' | 'bookmarked_at' | 'liked_at'

interface ToggleSpec {
  /** Article field holding the timestamp. */
  field: ToggleField
  /** Path segment under /api/articles/:id/. */
  endpoint: 'seen' | 'bookmark' | 'like'
  /** Boolean property name in the PATCH body. */
  bodyKey: 'seen' | 'bookmarked' | 'liked'
}

export const TOGGLE_SPECS = {
  seen_at: { field: 'seen_at', endpoint: 'seen', bodyKey: 'seen' },
  bookmarked_at: { field: 'bookmarked_at', endpoint: 'bookmark', bodyKey: 'bookmarked' },
  liked_at: { field: 'liked_at', endpoint: 'like', bodyKey: 'liked' },
} as const satisfies Record<ToggleField, ToggleSpec>

interface PageShape { articles: ArticleListItem[] }

/**
 * Toggle a timestamp field on an article, updating both SWR caches optimistically.
 *
 * Three caches have to move together and it is easy to update only some of
 * them: the paginated list, the by-url entry the detail view and overlay read
 * from, and the feed counts. Rolling back on failure needs the same set. This
 * was previously written out per field, so each new toggle re-derived the same
 * thirty lines.
 */
export function useOptimisticArticleToggle<T extends PageShape>(
  listMutate: SWRInfiniteKeyedMutator<T[]>,
) {
  const { mutate: globalMutate } = useSWRConfig()

  return useCallback(
    (article: Pick<ArticleListItem, 'id' | 'url'> & Partial<Record<ToggleField, string | null>>, field: ToggleField) => {
      const spec = TOGGLE_SPECS[field]
      const next = article[field] == null
      const value = next ? new Date().toISOString() : null
      const byUrlKey = `/api/articles/by-url?url=${encodeURIComponent(article.url)}`

      void listMutate(
        (pages) => pages?.map(page => ({
          ...page,
          articles: page.articles.map(a => (a.id === article.id ? { ...a, [field]: value } : a)),
        })),
        { revalidate: false },
      )

      // The detail view keys off the article URL — a separate cache entry that
      // would otherwise stay stale behind an open overlay.
      void globalMutate(
        byUrlKey,
        (curr: Record<string, unknown> | undefined) => (curr ? { ...curr, [field]: value } : curr),
        { revalidate: false },
      )

      return apiPatch(`/api/articles/${article.id}/${spec.endpoint}`, { [spec.bodyKey]: next })
        .then(() => {
          void globalMutate((key: unknown) => typeof key === 'string' && key.startsWith('/api/feeds'))
        })
        .catch(() => {
          void listMutate()
          void globalMutate(byUrlKey)
        })
    },
    [listMutate, globalMutate],
  )
}
