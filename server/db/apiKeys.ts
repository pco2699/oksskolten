import { randomBytes, createHash } from 'node:crypto'
import { getDb } from './connection.js'

export interface ApiKey {
  id: number
  name: string
  key_prefix: string
  scopes: string
  last_used_at: string | null
  created_at: string
}

export interface ApiKeyCreated extends ApiKey {
  /** Full key — shown only once at creation time */
  key: string
}

function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

export function createApiKey(name: string, scopes: string = 'read'): ApiKeyCreated {
  const raw = `ok_${randomBytes(20).toString('hex')}`
  const keyHash = hashKey(raw)
  const keyPrefix = raw.slice(0, 11) // "ok_" + first 8 hex chars

  const result = getDb()
    .prepare(
      'INSERT INTO api_keys (name, key_hash, key_prefix, scopes) VALUES (?, ?, ?, ?)',
    )
    .run(name, keyHash, keyPrefix, scopes)

  return {
    id: result.lastInsertRowid as number,
    name,
    key: raw,
    key_prefix: keyPrefix,
    scopes,
    last_used_at: null,
    created_at: new Date().toISOString(),
  }
}

export function listApiKeys(): ApiKey[] {
  return getDb()
    .prepare('SELECT id, name, key_prefix, scopes, last_used_at, created_at FROM api_keys ORDER BY created_at DESC')
    .all() as ApiKey[]
}

export function deleteApiKey(id: number): boolean {
  const result = getDb().prepare('DELETE FROM api_keys WHERE id = ?').run(id)
  return result.changes > 0
}

/**
 * How stale `last_used_at` may get before it is written again.
 *
 * This column is displayed in Settings, so minute-level accuracy is plenty —
 * and it is on the hot path of every authenticated API request, where a
 * synchronous SQLite write per request is real overhead.
 */
const LAST_USED_WRITE_INTERVAL_MS = 60_000

/** id → epoch ms of the last `last_used_at` write. */
const lastUsedWrites = new Map<number, number>()

/** @internal Test-only helper to clear the last_used_at throttle. */
export function _resetLastUsedThrottle(): void {
  lastUsedWrites.clear()
}

export function validateApiKey(key: string): { id: number; scopes: string } | null {
  const keyHash = hashKey(key)
  const row = getDb()
    .prepare('SELECT id, scopes FROM api_keys WHERE key_hash = ?')
    .get(keyHash) as { id: number; scopes: string } | undefined

  if (!row) return null

  const now = Date.now()
  const lastWrite = lastUsedWrites.get(row.id) ?? 0
  if (now - lastWrite >= LAST_USED_WRITE_INTERVAL_MS) {
    lastUsedWrites.set(row.id, now)
    getDb()
      .prepare("UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?")
      .run(row.id)
  }

  return { id: row.id, scopes: row.scopes }
}
