import { describe, it, expect } from 'vitest'
import { Semaphore, errorMessage, normalizeDate, withTimeout, TimeoutError, CONCURRENCY } from './util.js'

// --- CONCURRENCY ---

describe('CONCURRENCY', () => {
  it('is a positive number', () => {
    expect(CONCURRENCY).toBeGreaterThan(0)
  })
})

// --- Semaphore ---

describe('Semaphore', () => {
  it('runs a single task and returns its result', async () => {
    const sem = new Semaphore(1)
    const result = await sem.run(async () => 42)
    expect(result).toBe(42)
  })

  it('limits concurrency to max', async () => {
    const sem = new Semaphore(2)
    let active = 0
    let maxActive = 0

    const task = () =>
      sem.run(async () => {
        active++
        maxActive = Math.max(maxActive, active)
        await new Promise(r => setTimeout(r, 10))
        active--
      })

    await Promise.all([task(), task(), task(), task(), task()])
    expect(maxActive).toBe(2)
  })

  it('queues tasks beyond max concurrency', async () => {
    const sem = new Semaphore(1)
    const order: number[] = []

    const task = (n: number) =>
      sem.run(async () => {
        order.push(n)
      })

    await Promise.all([task(1), task(2), task(3)])
    expect(order).toEqual([1, 2, 3])
  })

  it('releases slot even when task throws', async () => {
    const sem = new Semaphore(1)

    await expect(sem.run(async () => { throw new Error('boom') })).rejects.toThrow('boom')

    // Should still be able to run after failure
    const result = await sem.run(async () => 'ok')
    expect(result).toBe('ok')
  })

  it('handles concurrency of many tasks', async () => {
    const sem = new Semaphore(3)
    const results: number[] = []

    const tasks = Array.from({ length: 10 }, (_, i) =>
      sem.run(async () => {
        results.push(i)
        return i
      }),
    )

    const returned = await Promise.all(tasks)
    expect(returned).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(results).toHaveLength(10)
  })
})

// --- withTimeout ---

describe('withTimeout', () => {
  it('passes through a value that settles in time', async () => {
    await expect(withTimeout(Promise.resolve(7), 50, 'x')).resolves.toBe(7)
  })

  it('passes through a rejection that settles in time', async () => {
    await expect(withTimeout(Promise.reject(new Error('boom')), 50, 'x')).rejects.toThrow('boom')
  })

  it('rejects with TimeoutError when the promise never settles', async () => {
    const p = withTimeout(new Promise(() => {}), 20, 'stuck task')
    await expect(p).rejects.toBeInstanceOf(TimeoutError)
    await expect(p).rejects.toThrow(/stuck task timed out/)
  })

  it('frees a Semaphore slot held by a hung task', async () => {
    const sem = new Semaphore(1)
    const hung = sem.run(() => withTimeout(new Promise<void>(() => {}), 20, 'hung'))
    const next = sem.run(async () => 'ran')
    await expect(hung).rejects.toBeInstanceOf(TimeoutError)
    await expect(next).resolves.toBe('ran')
  })
})

// --- errorMessage ---

describe('errorMessage', () => {
  it('returns message from Error', () => {
    expect(errorMessage(new Error('fail'))).toBe('fail')
  })

  it('returns string representation of non-Error', () => {
    expect(errorMessage('oops')).toBe('oops')
    expect(errorMessage(42)).toBe('42')
    expect(errorMessage(null)).toBe('null')
  })

  it('unwinds cause chain', () => {
    const inner = new Error('inner')
    const outer = new Error('outer', { cause: inner })
    expect(errorMessage(outer)).toBe('outer: inner')
  })

  it('unwinds deep cause chain', () => {
    const a = new Error('a')
    const b = new Error('b', { cause: a })
    const c = new Error('c', { cause: b })
    expect(errorMessage(c)).toBe('c: b: a')
  })

  it('skips duplicate messages in cause chain', () => {
    const inner = new Error('same')
    const outer = new Error('same', { cause: inner })
    expect(errorMessage(outer)).toBe('same')
  })

  it('handles non-Error cause', () => {
    const err = new Error('outer', { cause: 'string cause' as any })
    // Non-Error cause stops the chain
    expect(errorMessage(err)).toBe('outer')
  })
})

// --- normalizeDate ---

describe('normalizeDate', () => {
  it('converts valid date string to ISO', () => {
    const result = normalizeDate('2025-01-15T10:30:00Z')
    expect(result).toBe('2025-01-15T10:30:00.000Z')
  })

  it('converts RFC 2822 date', () => {
    const result = normalizeDate('Mon, 15 Jan 2025 10:30:00 GMT')
    expect(result).toBe('2025-01-15T10:30:00.000Z')
  })

  it('returns null for null input', () => {
    expect(normalizeDate(null)).toBeNull()
  })

  it('returns null for undefined input', () => {
    expect(normalizeDate(undefined)).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(normalizeDate('')).toBeNull()
  })

  it('returns null for invalid date string', () => {
    expect(normalizeDate('not-a-date')).toBeNull()
  })

  it('handles date-only string', () => {
    const result = normalizeDate('2025-01-15')
    expect(result).not.toBeNull()
    expect(result).toContain('2025-01-15')
  })
})
