import { MAX_BATCH_SEEN, chunk } from '../../shared/limits'

const DB_NAME = 'reader-offline'
const STORE_NAME = 'read-queue'
const DB_VERSION = 1

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function queueSeenIds(ids: number[]): Promise<void> {
  const db = await openDB()
  const tx = db.transaction(STORE_NAME, 'readwrite')
  const store = tx.objectStore(STORE_NAME)
  for (const articleId of ids) {
    store.add({ articleId, ts: Date.now() })
  }
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

let flushing = false

export async function flushOfflineQueue(): Promise<void> {
  if (flushing) return
  flushing = true
  try {
    await doFlush()
  } finally {
    flushing = false
  }
}

async function doFlush(): Promise<void> {
  const db = await openDB()

  // Read all queued items
  const items = await new Promise<Array<{ id: number; articleId: number }>>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const req = tx.objectStore(STORE_NAME).getAll()
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })

  if (items.length === 0) return

  const { authHeaders } = await import('./fetcher')

  // Send in server-sized batches. A single oversized request used to 400 on
  // every attempt, so the queue never drained and everything queued behind it
  // was stranded too.
  const sent: number[] = []
  let failed = false
  for (const batch of chunk(items, MAX_BATCH_SEEN)) {
    const ids = [...new Set(batch.map(i => i.articleId))]
    const res = await fetch('/api/articles/batch-seen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ ids }),
    })
    if (!res.ok) { failed = true; break }
    sent.push(...batch.map(i => i.id))
  }

  // Delete only what was acknowledged — clearing the whole store would drop
  // items queued while this flush was in flight.
  if (sent.length > 0) {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    for (const id of sent) store.delete(id)
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  }

  if (failed) throw new Error('flush failed')
}
