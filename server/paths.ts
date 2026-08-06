import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

/**
 * Resolve the data directory.
 *
 * Priority:
 *   1. DATA_DIR environment variable (explicit override)
 *   2. ./data (when running inside the project — dev / Docker container)
 *   3. ~/.oksskolten/data (standalone: SSH + MCP server, etc.)
 */
export function resolveDataDir(
  env: string | undefined = process.env.DATA_DIR,
  localExists: () => boolean = () => {
    try { return fs.statSync(path.resolve('data')).isDirectory() } catch { return false }
  },
  homedir: string = os.homedir(),
): string {
  if (env) {
    return path.resolve(env)
  }

  if (localExists()) {
    return path.resolve('data')
  }

  return path.join(homedir, '.oksskolten', 'data')
}

export const DATA_DIR = resolveDataDir()

export function dataPath(...segments: string[]): string {
  return path.join(DATA_DIR, ...segments)
}

/**
 * Directories a user-configured storage path is allowed to live under.
 *
 * DATA_DIR always; plus `IMAGES_STORAGE_ROOT` when the operator sets it, for
 * the common self-hosting case of putting images on a separate volume. The
 * split matters: the env var is operator-controlled, whereas the storage path
 * itself is settable over the API by anyone holding a write-scoped token.
 */
export function allowedStorageRoots(): string[] {
  const roots = [path.resolve(DATA_DIR)]
  const extra = process.env.IMAGES_STORAGE_ROOT
  if (extra) roots.push(path.resolve(extra))
  return roots
}

/**
 * Resolve a user-configured directory, rejecting anything outside the
 * allowed roots.
 *
 * The image storage path is settable over the API and is later joined with a
 * request-supplied filename to read and write files. Unconstrained, pointing it
 * at `/etc` turns the image endpoint into arbitrary host file access. Returns
 * null when the path escapes every allowed root.
 */
export function resolveUserDataPath(input: string): string | null {
  const resolved = path.resolve(DATA_DIR, input)
  for (const root of allowedStorageRoots()) {
    if (resolved === root || resolved.startsWith(root + path.sep)) return resolved
  }
  return null
}

/**
 * Find the project root directory by walking up from __dirname until
 * package.json is found. Works under both tsx (source) and compiled
 * (dist/ or dist-server/) environments where __dirname depth differs.
 *
 * Assumes a single-package layout (no monorepo workspaces) where the
 * first package.json walking upward is the project root. Will produce
 * incorrect results in a multi-package workspace with nested
 * package.json files.
 */
export function findProjectRoot(dirname: string): string {
  let dir = dirname
  while (true) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) return dir // hit filesystem root
    dir = parent
  }
}
