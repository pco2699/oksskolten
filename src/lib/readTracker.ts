/**
 * Session-level read tracker.
 * Keeps article IDs that were marked as read during this browser session.
 * Cleared on full page reload — which is exactly the All view behaviour we want.
 */
const readIds = new Set<number>()

export function trackRead(id: number) {
  readIds.add(id)
}

export function isReadInSession(id: number): boolean {
  return readIds.has(id)
}
