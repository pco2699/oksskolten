// Request-size limits shared by the API and its callers.
//
// These live here rather than in the route file because the client has to chunk
// to the same numbers. When only the server knew the cap, the client sent
// oversized batches, got a 400, and swallowed it — silently losing writes.

/** Maximum article ids accepted by POST /api/articles/batch-seen. */
export const MAX_BATCH_SEEN = 100

/** Maximum URLs accepted by POST /api/articles/check-urls. */
export const MAX_CHECK_URLS = 200

/** Split a list into chunks of at most `size`. */
export function chunk<T>(items: T[], size: number): T[][] {
  if (items.length <= size) return items.length > 0 ? [items] : []
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size))
  }
  return out
}
