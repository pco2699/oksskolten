#!/usr/bin/env node
/**
 * MCP stdio server that exposes RSS Reader tools to Claude Code.
 *
 * Usage:
 *   tsx server/chat/mcp-server.ts
 *
 * When TOOL_LOG_PATH is set, tool execution results are appended to that file
 * so the Claude Code adapter can reconstruct tool_use/tool_result blocks.
 *
 * Tool registration itself lives in `./mcp-factory.js`, shared with the HTTP
 * endpoint at `server/routes/mcp.ts` — this file only wires it to stdio.
 */
import { logger } from '../logger.js'

const log = logger.child('mcp-server')

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { TOOLS } from './tools.js'
import { createMcpServer } from './mcp-factory.js'

log.error('boot', {
  pid: process.pid,
  toolCount: TOOLS.length,
  toolLogPath: process.env.TOOL_LOG_PATH ?? null,
})

// stdio is a trusted local channel (only ever wired up to a local Claude Code
// process), so every tool — including write-mutating ones — is allowed.
const server = createMcpServer()

const transport = new StdioServerTransport()
log.error('connecting stdio transport', { pid: process.pid })
await server.connect(transport)
log.error('connected stdio transport', { pid: process.pid })
