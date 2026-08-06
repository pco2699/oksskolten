import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PREFERENCE_KEYS, PREFERENCE_SCHEMA, isAllowedPreferenceValue, type PreferenceKey } from './preferences.js'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

describe('isAllowedPreferenceValue', () => {
  it('accepts any string for open-ended keys', () => {
    expect(isAllowedPreferenceValue('chat.model', 'anthropic/claude-opus-4')).toBe(true)
    expect(isAllowedPreferenceValue('appearance.color_theme', 'anything-at-all')).toBe(true)
  })

  it('enforces the enum for constrained keys', () => {
    expect(isAllowedPreferenceValue('reading.date_mode', 'relative')).toBe(true)
    expect(isAllowedPreferenceValue('reading.date_mode', 'sideways')).toBe(false)
    expect(isAllowedPreferenceValue('appearance.list_layout', 'magazine')).toBe(true)
    expect(isAllowedPreferenceValue('appearance.list_layout', 'grid')).toBe(false)
  })
})

// The server validates against this schema and the client hydrates from it.
// A key that exists in the hydration map but not the schema makes the backfill
// PATCH 400 on every page load, which is what these guard.
describe('frontend/backend key agreement', () => {
  const useSettings = fs.readFileSync(path.join(repoRoot, 'src/hooks/use-settings.ts'), 'utf-8')

  /** Keys the hydration map applies, scraped from the source. */
  const hydratedKeys = [...useSettings.matchAll(/\{ key: '([^']+)'/g)].map(m => m[1])

  it('finds the hydration map', () => {
    expect(hydratedKeys.length).toBeGreaterThan(10)
  })

  it('every hydrated key exists in the shared schema', () => {
    const unknown = hydratedKeys.filter(k => !PREFERENCE_KEYS.includes(k as PreferenceKey))
    expect(unknown).toEqual([])
  })

  it('every schema key has a declared allowed-value list or null', () => {
    for (const key of PREFERENCE_KEYS) {
      const allowed = PREFERENCE_SCHEMA[key]
      expect(allowed === null || Array.isArray(allowed)).toBe(true)
    }
  })
})
