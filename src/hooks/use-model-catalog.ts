import useSWR from 'swr'
import { fetcher } from '../lib/fetcher'
import type { CatalogModel } from '../data/aiModels'

/**
 * The OpenRouter model catalog, served from the server's cached copy. Model ids,
 * display names, and pricing all come from here — there is no static model list.
 */
export function useModelCatalog(): { models: CatalogModel[]; isLoading: boolean } {
  const { data, isLoading } = useSWR<{ models: CatalogModel[] }>(
    '/api/settings/openrouter/models',
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 60_000 },
  )
  return { models: data?.models ?? [], isLoading }
}
