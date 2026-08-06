import { apiPost } from './fetcher'
import { queueSeenIds } from './offlineQueue'
import { MAX_BATCH_SEEN, chunk } from '../../shared/limits'

/**
 * Mark articles as seen, falling back to the offline queue on failure.
 *
 * Chunked to the server's batch limit: "mark all as read" after scrolling past
 * a hundred articles used to send the whole list, get a 400, and quietly divert
 * every id into the offline queue — where the flush hit the same 400 forever.
 * Each chunk fails independently, so one rejected batch cannot strand the rest.
 */
export async function markSeenOnServer(ids: number[]): Promise<void> {
  await Promise.all(
    chunk(ids, MAX_BATCH_SEEN).map(async (batch) => {
      try {
        await apiPost('/api/articles/batch-seen', { ids: batch })
      } catch {
        await queueSeenIds(batch)
      }
    }),
  )
}
