/**
 * Shared MCP server factory backing both the stdio entrypoint
 * (`server/chat/mcp-server.ts`) and the HTTP endpoint (`server/routes/mcp.ts`).
 *
 * Keeping tool registration in one place means stdio and HTTP transports can
 * never drift: both wrap the same `TOOLS` definitions from `./tools.js`.
 */
import fs from 'node:fs'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { logger } from '../logger.js'
import { TOOLS } from './tools.js'

const log = logger.child('mcp-server')

/**
 * Tool names that mutate state (mark/like/bookmark, or persist an AI-generated
 * summary/translation). Gated on the API key 'write' scope over HTTP; unrestricted
 * over stdio, which is only ever wired up to a trusted local Claude Code process.
 */
export const WRITE_TOOL_NAMES: ReadonlySet<string> = new Set([
  'mark_as_read',
  'mark_articles_as_read',
  'toggle_like',
  'toggle_bookmark',
  'summarize_article',
  'summarize_articles',
  'translate_article',
])

/**
 * Convert a flat JSON Schema properties object to a zod shape.
 * Supports: string, number, boolean (the types used in tools.ts inputSchema).
 */
export function jsonSchemaToZod(
  schema: { type: 'object'; properties: Record<string, any>; required?: string[] },
): Record<string, z.ZodTypeAny> {
  const shape: Record<string, z.ZodTypeAny> = {}
  const required = new Set(schema.required ?? [])

  for (const [key, prop] of Object.entries(schema.properties)) {
    let zodType: z.ZodTypeAny
    switch (prop.type) {
      case 'number':
        zodType = z.number()
        break
      case 'boolean':
        zodType = z.boolean()
        break
      case 'array':
        if (prop.items?.type === 'number') {
          zodType = z.array(z.number())
        } else if (prop.items?.type === 'string') {
          zodType = z.array(z.string())
        } else {
          throw new Error(`Unsupported array item type: ${prop.items?.type}`)
        }
        break
      case 'string':
        zodType = z.string()
        break
      default:
        throw new Error(`Unsupported type: ${prop.type}`)
    }

    if (prop.description) {
      zodType = zodType.describe(prop.description)
    }

    if (!required.has(key)) {
      zodType = zodType.optional()
    }

    shape[key] = zodType
  }

  return shape
}

export interface CreateMcpServerOptions {
  /**
   * Whether write-mutating tools (see `WRITE_TOOL_NAMES`) may execute on this
   * server instance. Omit for trusted local contexts (stdio) where every tool
   * is allowed. Set to `false` for HTTP callers whose API key lacks 'write' scope.
   */
  allowWrites?: boolean
}

/**
 * Build a fresh `McpServer` with every tool from `TOOLS` registered.
 *
 * A new instance should be created per connection (stdio: once at process
 * boot; HTTP stateless mode: once per request) — `McpServer` is not designed
 * to be shared across unrelated transports/sessions.
 */
export function createMcpServer(options: CreateMcpServerOptions = {}): McpServer {
  const server = new McpServer({ name: 'oksskolten', version: '1.0.0' })

  for (const tool of TOOLS) {
    const shape = jsonSchemaToZod(tool.inputSchema)
    server.tool(tool.name, tool.description, shape, async (input) => {
      if (options.allowWrites === false && WRITE_TOOL_NAMES.has(tool.name)) {
        return {
          content: [{
            type: 'text' as const,
            text: `Tool "${tool.name}" requires an API token with the "write" scope.`,
          }],
          isError: true,
        }
      }

      log.debug('tool start', { name: tool.name, input })
      const result = await tool.execute(input as Record<string, unknown>)

      // Log tool execution for the Claude Code adapter to reconstruct
      if (process.env.TOOL_LOG_PATH) {
        await fs.promises.appendFile(
          process.env.TOOL_LOG_PATH,
          JSON.stringify({ name: tool.name, input, result }) + '\n',
        )
      }

      log.debug('tool done', { name: tool.name })
      return { content: [{ type: 'text' as const, text: result }] }
    })
  }

  return server
}
