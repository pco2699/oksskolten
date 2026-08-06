import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import Database from 'libsql'
import { logger } from '../logger.js'
import { dataPath } from '../paths.js'
import { findProjectRoot } from '../paths.js'

const log = logger.child('db')

// --- DB instance ---

function isRemote(url: string): boolean {
  return url.startsWith('libsql://') || url.startsWith('https://')
}

function openDb(dbUrl: string) {
  const remote = isRemote(dbUrl)
  if (!remote && dbUrl !== ':memory:') {
    // For local file paths, ensure the parent directory exists
    const filePath = dbUrl.startsWith('file:') ? dbUrl.slice(5) : dbUrl
    const dbDir = path.dirname(filePath)
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true })
    }
  }
  const authToken = process.env.TURSO_AUTH_TOKEN
  // libsql types don't include authToken but it's supported at runtime for Turso connections
  const instance = authToken
    ? new Database(dbUrl, { authToken } as Database.Options & { authToken: string })
    : new Database(dbUrl)
  if (!remote) {
    instance.pragma('journal_mode = WAL')
  }
  instance.pragma('foreign_keys = ON')
  // Limit SQLite internal heap growth to prevent native memory accumulation.
  // Soft limit: SQLite tries to stay under this; exceeding it won't cause errors.
  instance.pragma('soft_heap_limit = 268435456')  // 256MB
  return instance
}

/**
 * Shrink SQLite memory and checkpoint WAL to release accumulated native heap.
 * Safe to call periodically (e.g. every 5 min) to prevent libsql RSS growth.
 * For remote (Turso) databases, only shrink_memory is attempted.
 */
export function shrinkMemory() {
  try {
    const remote = isRemote(process.env.DATABASE_URL || '')
    if (!remote) {
      db.pragma('wal_checkpoint(TRUNCATE)')
    }
    db.pragma('shrink_memory')
    log.info('[db] Memory shrunk' + (remote ? '' : ' + WAL checkpoint'))
  } catch (err) {
    log.error('[db] shrinkMemory error:', err)
  }
}

let db = openDb(process.env.DATABASE_URL || `file:${dataPath('rss.db')}`)

export function getDb() {
  return db
}

export function _resetDb(dbPath = ':memory:') {
  db.close()
  db = openDb(dbPath)
}

export function bindNamedParams(sql: string, params: Record<string, unknown>): { sql: string; args: unknown[] } {
  const args: unknown[] = []
  const boundSql = sql.replace(/@([A-Za-z_][A-Za-z0-9_]*)/g, (_match, key: string) => {
    if (!(key in params)) {
      throw new Error(`Missing SQL parameter: ${key}`)
    }
    args.push(params[key])
    return '?'
  })
  return { sql: boundSql, args }
}

export function runNamed(sql: string, params: Record<string, unknown>) {
  const bound = bindNamedParams(sql, params)
  return db.prepare(bound.sql).run(...bound.args)
}

export function getNamed<T>(sql: string, params: Record<string, unknown>) {
  const bound = bindNamedParams(sql, params)
  return db.prepare(bound.sql).get(...bound.args) as T
}

export function allNamed<T>(sql: string, params: Record<string, unknown>) {
  const bound = bindNamedParams(sql, params)
  return db.prepare(bound.sql).all(...bound.args) as T[]
}

// --- Migrations ---

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = findProjectRoot(__dirname)

/**
 * Error messages from SQLite that indicate an already-applied schema change.
 *
 * Deliberately excludes "no such column": that means a statement references a
 * column that does not exist, which is a broken migration rather than one that
 * already ran. Treating it as idempotent silently skipped real failures.
 */
const IDEMPOTENT_ERRORS = ['duplicate column name', 'already exists'] as const

function isIdempotentError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return IDEMPOTENT_ERRORS.some(e => msg.includes(e))
}

/**
 * Split a SQL script into individual statements.
 *
 * Splitting on a bare ";" corrupts any statement containing a semicolon inside
 * a string literal, a comment, or a `BEGIN … END` trigger body, so track those
 * contexts and only break on a top-level separator.
 */
export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = []
  let current = ''
  let blockDepth = 0
  let i = 0

  const startsWord = (word: string): boolean => {
    if (sql.slice(i, i + word.length).toUpperCase() !== word) return false
    const before = i > 0 ? sql[i - 1] : ' '
    const after = sql[i + word.length] ?? ' '
    return !/[A-Za-z0-9_]/.test(before) && !/[A-Za-z0-9_]/.test(after)
  }

  while (i < sql.length) {
    const ch = sql[i]

    // Quoted literals and identifiers: copy verbatim to the closing quote.
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch
      current += ch
      i++
      while (i < sql.length) {
        current += sql[i]
        if (sql[i] === quote) {
          // A doubled quote is an escape, not a terminator.
          if (sql[i + 1] === quote) { current += sql[i + 1]; i += 2; continue }
          i++
          break
        }
        i++
      }
      continue
    }

    // Comments: copy verbatim so they stay attached to the statement.
    if (ch === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') { current += sql[i]; i++ }
      continue
    }
    if (ch === '/' && sql[i + 1] === '*') {
      current += '/*'
      i += 2
      while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) { current += sql[i]; i++ }
      current += '*/'
      i += 2
      continue
    }

    // Trigger / compound bodies: semicolons inside are statement-internal.
    if (startsWord('BEGIN')) { blockDepth++; current += sql.slice(i, i + 5); i += 5; continue }
    if (startsWord('END')) { if (blockDepth > 0) blockDepth--; current += sql.slice(i, i + 3); i += 3; continue }

    if (ch === ';' && blockDepth === 0) {
      if (current.trim()) statements.push(current.trim())
      current = ''
      i++
      continue
    }

    current += ch
    i++
  }

  if (current.trim()) statements.push(current.trim())
  return statements
}

/**
 * Run SQL statements one-by-one, skipping ones that fail because the schema
 * change they describe is already present.
 */
function execSafe(sql: string, file: string) {
  for (const stmt of splitSqlStatements(sql)) {
    try {
      db.exec(stmt)
    } catch (err: unknown) {
      if (isIdempotentError(err)) {
        log.warn(`Migration ${file}: skipping statement (${(err as Error).message})`)
      } else {
        throw err
      }
    }
  }
}

export function runMigrations() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)

  const migrationsDir = path.join(projectRoot, 'migrations')
  if (!fs.existsSync(migrationsDir)) return

  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort()

  const applied = new Set(
    (db.prepare('SELECT name FROM _migrations').all() as { name: string }[])
      .map(row => row.name)
  )

  const remote = isRemote(process.env.DATABASE_URL || '')
  for (const file of files) {
    if (applied.has(file)) continue
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8')
    // Toggled outside the transaction below — PRAGMA foreign_keys is a no-op
    // while a transaction is open.
    if (!remote) db.pragma('foreign_keys = OFF')
    try {
      applyMigration(file, sql)
    } finally {
      if (!remote) db.pragma('foreign_keys = ON')
    }
    log.info(`Migration applied: ${file}`)
  }
}

/**
 * Apply one migration and record it, atomically.
 *
 * The schema change and its `_migrations` row commit together, so a crash
 * between them can no longer leave a migration applied but unrecorded (which
 * would re-run it on the next boot).
 */
function applyMigration(file: string, sql: string): void {
  const record = () => { db.prepare('INSERT INTO _migrations (name) VALUES (?)').run(file) }
  try {
    db.transaction(() => { db.exec(sql); record() })()
  } catch (err: unknown) {
    if (!isIdempotentError(err)) throw err
    // Partially-applied migration — the transaction above rolled back, so
    // retry statement-by-statement, skipping the ones already in place.
    log.warn(`Migration ${file}: partial conflict (${(err as Error).message}), applying statement-by-statement`)
    db.transaction(() => { execSafe(sql, file); record() })()
  }
}

/**
 * Run a one-off JavaScript data migration exactly once, tracked in the same
 * `_migrations` table as the SQL files. For repairs that cannot be expressed
 * in SQL (e.g. URL normalization, which needs the WHATWG URL parser).
 */
export function runDataMigration(name: string, fn: () => void): void {
  const already = db.prepare('SELECT 1 FROM _migrations WHERE name = ?').get(name)
  if (already) return
  fn()
  db.prepare('INSERT INTO _migrations (name) VALUES (?)').run(name)
  log.info(`Data migration applied: ${name}`)
}
