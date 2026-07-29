import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setupTestDb } from '../__tests__/helpers/testDb.js'
import { buildApp } from '../__tests__/helpers/buildApp.js'
import { createApiKey } from '../db/apiKeys.js'
import type { FastifyInstance } from 'fastify'

let app: FastifyInstance
let savedAuthDisabled: string | undefined

const mcpHeaders = (token?: string) => ({
  'content-type': 'application/json',
  'accept': 'application/json, text/event-stream',
  ...(token ? { authorization: `Bearer ${token}` } : {}),
})

const initializePayload = {
  jsonrpc: '2.0' as const,
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'test-client', version: '1.0.0' },
  },
}

const toolsListPayload = {
  jsonrpc: '2.0' as const,
  id: 2,
  method: 'tools/list',
  params: {},
}

function createToken(scopes: 'read' | 'read,write' = 'read'): string {
  process.env.AUTH_DISABLED = '1'
  const created = createApiKey('mcp-test', scopes)
  delete process.env.AUTH_DISABLED
  return created.key
}

beforeEach(async () => {
  setupTestDb()
  app = await buildApp()
  savedAuthDisabled = process.env.AUTH_DISABLED
  delete process.env.AUTH_DISABLED
})

afterEach(() => {
  if (savedAuthDisabled !== undefined) {
    process.env.AUTH_DISABLED = savedAuthDisabled
  } else {
    delete process.env.AUTH_DISABLED
  }
})

describe('POST /mcp', () => {
  it('returns 401 without a token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: mcpHeaders(),
      payload: initializePayload,
    })
    expect(res.statusCode).toBe(401)
  })

  it('returns 401 with an invalid token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: mcpHeaders('ok_0000000000000000000000000000000000000000'),
      payload: initializePayload,
    })
    expect(res.statusCode).toBe(401)
  })

  it('round-trips an initialize request with a valid token', async () => {
    const token = createToken('read')
    const res = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: mcpHeaders(token),
      payload: initializePayload,
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.jsonrpc).toBe('2.0')
    expect(body.id).toBe(1)
    expect(body.result.serverInfo.name).toBe('oksskolten')
    expect(body.result.capabilities.tools).toBeDefined()
  })

  it('returns the expected tool names from tools/list', async () => {
    const token = createToken('read')
    const res = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: mcpHeaders(token),
      payload: toolsListPayload,
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    const names = body.result.tools.map((t: { name: string }) => t.name)

    expect(names).toEqual(expect.arrayContaining([
      'search_articles',
      'get_article',
      'get_feeds',
      'get_categories',
      'get_reading_stats',
      'mark_as_read',
      'toggle_like',
      'toggle_bookmark',
      'summarize_article',
      'translate_article',
    ]))
  })

  it('rejects a write-mutating tool call for a read-only token', async () => {
    const token = createToken('read')
    const res = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: mcpHeaders(token),
      payload: {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'mark_as_read', arguments: { article_id: 1 } },
      },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.result.isError).toBe(true)
    expect(body.result.content[0].text).toMatch(/write.*scope/i)
  })

  it('rejects a GET request in stateless mode', async () => {
    const token = createToken('read')
    const res = await app.inject({
      method: 'GET',
      url: '/mcp',
      headers: { authorization: `Bearer ${token}`, accept: 'text/event-stream' },
    })
    expect(res.statusCode).toBe(405)
  })

  it('rejects a DELETE request in stateless mode', async () => {
    const token = createToken('read')
    const res = await app.inject({
      method: 'DELETE',
      url: '/mcp',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(405)
  })
})
