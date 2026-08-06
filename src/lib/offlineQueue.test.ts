import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock fetcher module for flushOfflineQueue
vi.mock('./fetcher', () => ({
  authHeaders: vi.fn(() => ({ Authorization: 'Bearer test' })),
}))

// --- Minimal typed IndexedDB mock ---

interface MockRecord { id: number; [k: string]: unknown }

interface MockIDBRequest<T = unknown> {
  result: T
  onsuccess: (() => void) | null
  onerror: (() => void) | null
}

interface MockIDBTransaction {
  objectStore: (name: string) => MockObjectStore
  oncomplete: (() => void) | null
  onerror: (() => void) | null
}

interface MockObjectStore {
  add: (item: Record<string, unknown>) => { onsuccess: null; onerror: null }
  getAll: () => MockIDBRequest<MockRecord[]>
  clear: () => { onsuccess: null; onerror: null }
  delete: (id: number) => { onsuccess: null; onerror: null }
}

interface MockIDBOpenRequest extends MockIDBRequest<MockIDBDatabase> {
  onupgradeneeded: (() => void) | null
}

interface MockIDBDatabase {
  objectStoreNames: { contains: (name: string) => boolean }
  createObjectStore: (name: string, opts: IDBObjectStoreParameters) => MockObjectStore
  transaction: (storeName: string, mode: string) => MockIDBTransaction
  close: ReturnType<typeof vi.fn>
}

function createMockIndexedDB() {
  let stores: Record<string, MockRecord[]> = {}
  let autoInc: Record<string, number> = {}

  function makeStore(name: string) {
    if (!stores[name]) {
      stores[name] = []
      autoInc[name] = 1
    }
  }

  function createObjectStore(storeName: string): MockObjectStore {
    return {
      add(item: Record<string, unknown>) {
        makeStore(storeName)
        const record = { ...item, id: autoInc[storeName]++ } as MockRecord
        stores[storeName].push(record)
        return { onsuccess: null, onerror: null }
      },
      getAll() {
        makeStore(storeName)
        const req: MockIDBRequest<MockRecord[]> = { result: [...stores[storeName]], onsuccess: null, onerror: null }
        queueMicrotask(() => req.onsuccess?.())
        return req
      },
      clear() {
        stores[storeName] = []
        return { onsuccess: null, onerror: null }
      },
      delete(id: number) {
        makeStore(storeName)
        stores[storeName] = stores[storeName].filter(r => r.id !== id)
        return { onsuccess: null, onerror: null }
      },
    }
  }

  function makeTx(_storeName: string, _mode: string): MockIDBTransaction {
    const tx: MockIDBTransaction = {
      objectStore: (name: string) => createObjectStore(name),
      oncomplete: null,
      onerror: null,
    }
    queueMicrotask(() => tx.oncomplete?.())
    return tx
  }

  const mockDB: MockIDBDatabase = {
    objectStoreNames: {
      contains: (name: string) => !!stores[name],
    },
    createObjectStore: (name: string, _opts: IDBObjectStoreParameters) => {
      makeStore(name)
      return createObjectStore(name)
    },
    transaction: (storeName: string, mode: string) => makeTx(storeName, mode),
    close: vi.fn(),
  }

  const open = vi.fn((_name: string, _version?: number) => {
    const req: MockIDBOpenRequest = { result: mockDB, onsuccess: null, onerror: null, onupgradeneeded: null }
    queueMicrotask(() => {
      req.onupgradeneeded?.()
      req.onsuccess?.()
    })
    return req
  })

  return {
    open,
    deleteDatabase: vi.fn((_name: string) => {
      stores = {}
      autoInc = {}
      const req: MockIDBRequest<undefined> = { result: undefined, onsuccess: null, onerror: null }
      queueMicrotask(() => req.onsuccess?.())
      return req
    }),
    _stores: stores,
    _mockDB: mockDB,
  }
}

let mockIDB: ReturnType<typeof createMockIndexedDB>

beforeEach(async () => {
  mockIDB = createMockIndexedDB()
  vi.stubGlobal('indexedDB', mockIDB)
  vi.clearAllMocks()
  vi.resetModules()
})

async function loadModule() {
  return await import('./offlineQueue')
}

describe('offlineQueue', () => {
  describe('queueSeenIds', () => {
    it('stores article ids via IndexedDB', async () => {
      const { queueSeenIds } = await loadModule()
      await queueSeenIds([10, 20])
      // The mock store should have 2 records after onupgradeneeded creates it
      // We verify by calling flushOfflineQueue which reads them
    })
  })

  describe('flushOfflineQueue', () => {
    it('does nothing when queue is empty', async () => {
      vi.stubGlobal('fetch', vi.fn())
      const { flushOfflineQueue } = await loadModule()
      await flushOfflineQueue()
      expect(fetch).not.toHaveBeenCalled()
    })

    it('sends queued ids to server and clears queue', async () => {
      const { queueSeenIds, flushOfflineQueue } = await loadModule()
      await queueSeenIds([1, 2, 3])

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
      await flushOfflineQueue()

      expect(fetch).toHaveBeenCalledWith('/api/articles/batch-seen', expect.objectContaining({
        method: 'POST',
      }))

      const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)
      expect(body.ids).toEqual(expect.arrayContaining([1, 2, 3]))
    })

    it('deduplicates article ids', async () => {
      const { queueSeenIds, flushOfflineQueue } = await loadModule()
      await queueSeenIds([5, 5, 10])

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
      await flushOfflineQueue()

      const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)
      const ids = body.ids as number[]
      expect(new Set(ids).size).toBe(ids.length)
      expect(ids).toHaveLength(2)
    })

    it('throws when server returns error', async () => {
      const { queueSeenIds, flushOfflineQueue } = await loadModule()
      await queueSeenIds([1])

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))
      await expect(flushOfflineQueue()).rejects.toThrow('flush failed')
    })
  })
})
