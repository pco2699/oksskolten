import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { requireAuth } from '../auth.js'
import { createMcpServer } from '../chat/mcp-factory.js'
import { logger } from '../logger.js'

const log = logger.child('mcp-http')

/**
 * MCP endpoint over Streamable HTTP, so remote clients (Claude Desktop via
 * `mcp-remote`, or any other Streamable HTTP-capable MCP client) can reach
 * the same tools as the stdio server without SSH.
 *
 * Runs in STATELESS mode: a fresh McpServer + transport is created for every
 * request (`sessionIdGenerator: undefined`) and torn down once the response
 * completes. This is sufficient for tools-only usage and avoids in-memory
 * session bookkeeping entirely. Because there is no server-side session:
 *   - GET (used for server-initiated notifications in stateful mode) and
 *   - DELETE (used to terminate a session)
 * are not meaningful here and return 405, as the Streamable HTTP spec allows.
 *
 * Auth: same bearer-token mechanism as `/api/*` (see `server/auth.ts`). Any
 * valid `ok_...` token (or an authenticated browser session) may connect;
 * write-mutating tools additionally require the token's 'write' scope.
 */
export async function mcpRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth)

  app.post('/mcp', async (request, reply) => {
    await handleMcpRequest(request, reply)
  })

  app.get('/mcp', async (_request, reply) => {
    reply
      .status(405)
      .header('Allow', 'POST')
      .send({ error: 'Method Not Allowed: this endpoint runs in stateless mode (no SSE notification stream)' })
  })

  app.delete('/mcp', async (_request, reply) => {
    reply
      .status(405)
      .header('Allow', 'POST')
      .send({ error: 'Method Not Allowed: this endpoint runs in stateless mode (no sessions to terminate)' })
  })
}

async function handleMcpRequest(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  // Same convention as requireWriteScope: a JWT/browser session (no apiKeyScopes)
  // is fully trusted; an API key must carry 'write' scope to run mutating tools.
  const allowWrites = !request.apiKeyScopes || request.apiKeyScopes.includes('write')

  const server = createMcpServer({ allowWrites })
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })

  // Bypass Fastify's own response handling: the SDK transport writes directly
  // to the raw Node ServerResponse.
  reply.hijack()

  reply.raw.on('close', () => {
    void server.close()
    void transport.close()
  })

  try {
    await server.connect(transport)
    await transport.handleRequest(request.raw, reply.raw, request.body)
  } catch (err) {
    log.error('MCP request handling error', err)
    if (!reply.raw.headersSent) {
      reply.raw.writeHead(500, { 'Content-Type': 'application/json' })
      reply.raw.end(JSON.stringify({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error' },
        id: null,
      }))
    }
  }
}
