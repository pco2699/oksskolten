import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./fetcher', () => ({
  apiPost: vi.fn(),
}))

vi.mock('./offlineQueue', () => ({
  queueSeenIds: vi.fn(),
}))

import { markSeenOnServer } from './markSeenWithQueue'
import { apiPost } from './fetcher'
import { queueSeenIds } from './offlineQueue'
import { MAX_BATCH_SEEN } from '../../shared/limits'

describe('markSeenOnServer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls apiPost with article ids', async () => {
    vi.mocked(apiPost).mockResolvedValue(undefined)
    await markSeenOnServer([1, 2, 3])
    expect(apiPost).toHaveBeenCalledWith('/api/articles/batch-seen', { ids: [1, 2, 3] })
    expect(queueSeenIds).not.toHaveBeenCalled()
  })

  it('queues ids to offline queue when apiPost fails', async () => {
    vi.mocked(apiPost).mockRejectedValue(new Error('network error'))
    await markSeenOnServer([4, 5])
    expect(queueSeenIds).toHaveBeenCalledWith([4, 5])
  })

  // "Mark all as read" after scrolling past 100 articles used to send one
  // oversized request, get a 400, and lose the write.
  it('splits oversized batches to the server limit', async () => {
    vi.mocked(apiPost).mockResolvedValue(undefined)
    const ids = Array.from({ length: 250 }, (_, i) => i + 1)

    await markSeenOnServer(ids)

    expect(apiPost).toHaveBeenCalledTimes(3)
    const sent = vi.mocked(apiPost).mock.calls.flatMap(([, body]) => (body as { ids: number[] }).ids)
    expect(sent).toEqual(ids)
    expect(vi.mocked(apiPost).mock.calls.every(([, b]) => (b as { ids: number[] }).ids.length <= MAX_BATCH_SEEN)).toBe(true)
    expect(queueSeenIds).not.toHaveBeenCalled()
  })

  it('queues only the chunks that failed', async () => {
    vi.mocked(apiPost)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('network error'))
    const ids = Array.from({ length: 150 }, (_, i) => i + 1)

    await markSeenOnServer(ids)

    expect(queueSeenIds).toHaveBeenCalledTimes(1)
    expect(queueSeenIds).toHaveBeenCalledWith(ids.slice(MAX_BATCH_SEEN))
  })
})
