import { describe, it, expect, beforeEach } from 'vitest'
import { setupTestDb } from '../__tests__/helpers/testDb.js'
import { createApiKey, listApiKeys, deleteApiKey, validateApiKey, _resetLastUsedThrottle } from './apiKeys.js'

beforeEach(() => {
  setupTestDb()
  // Key ids restart at 1 with each fresh test DB, so a throttle entry left over
  // from a previous case would suppress the next last_used_at write.
  _resetLastUsedThrottle()
})

describe('apiKeys', () => {
  describe('createApiKey', () => {
    it('returns a key with ok_ prefix', () => {
      const result = createApiKey('test key')
      expect(result.key).toMatch(/^ok_[0-9a-f]{40}$/)
      expect(result.key_prefix).toBe(result.key.slice(0, 11))
      expect(result.name).toBe('test key')
      expect(result.scopes).toBe('read')
      expect(result.id).toBeGreaterThan(0)
    })

    it('respects custom scopes', () => {
      const result = createApiKey('rw key', 'read,write')
      expect(result.scopes).toBe('read,write')
    })

    it('generates unique keys each time', () => {
      const a = createApiKey('key-a')
      const b = createApiKey('key-b')
      expect(a.key).not.toBe(b.key)
      expect(a.id).not.toBe(b.id)
    })
  })

  describe('listApiKeys', () => {
    it('returns empty array when no keys exist', () => {
      expect(listApiKeys()).toEqual([])
    })

    it('returns keys without the full key value', () => {
      createApiKey('my key')
      const keys = listApiKeys()
      expect(keys).toHaveLength(1)
      expect(keys[0].name).toBe('my key')
      expect(keys[0].key_prefix).toMatch(/^ok_[0-9a-f]{8}$/)
      expect(keys[0]).not.toHaveProperty('key')
      expect(keys[0]).not.toHaveProperty('key_hash')
    })

    it('lists multiple keys', () => {
      createApiKey('first')
      createApiKey('second')
      const keys = listApiKeys()
      expect(keys).toHaveLength(2)
      const names = keys.map(k => k.name)
      expect(names).toContain('first')
      expect(names).toContain('second')
    })
  })

  describe('deleteApiKey', () => {
    it('deletes an existing key and returns true', () => {
      const { id } = createApiKey('to-delete')
      expect(deleteApiKey(id)).toBe(true)
      expect(listApiKeys()).toHaveLength(0)
    })

    it('returns false for non-existent id', () => {
      expect(deleteApiKey(999)).toBe(false)
    })
  })

  describe('validateApiKey', () => {
    it('returns id and scopes for a valid key', () => {
      const created = createApiKey('valid', 'read,write')
      const result = validateApiKey(created.key)
      expect(result).toEqual({ id: created.id, scopes: 'read,write' })
    })

    it('returns null for an invalid key', () => {
      expect(validateApiKey('ok_0000000000000000000000000000000000000000')).toBeNull()
    })

    it('returns null for a non-ok_ prefixed string', () => {
      expect(validateApiKey('not-a-key')).toBeNull()
    })

    it('updates last_used_at on successful validation', () => {
      const created = createApiKey('track-usage')
      expect(listApiKeys()[0].last_used_at).toBeNull()

      validateApiKey(created.key)

      const keys = listApiKeys()
      expect(keys[0].last_used_at).not.toBeNull()
    })

    it('throttles repeat last_used_at writes within the interval', () => {
      const created = createApiKey('hot-path')
      validateApiKey(created.key)
      const first = listApiKeys()[0].last_used_at
      expect(first).not.toBeNull()

      // A second validation inside the window must not issue another write:
      // this runs on every authenticated request.
      validateApiKey(created.key)
      expect(listApiKeys()[0].last_used_at).toBe(first)
    })

    it('returns null after key is deleted', () => {
      const created = createApiKey('ephemeral')
      deleteApiKey(created.id)
      expect(validateApiKey(created.key)).toBeNull()
    })
  })
})
