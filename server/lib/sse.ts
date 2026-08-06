import type { FastifyReply } from 'fastify'

/** Comment frame sent periodically to keep idle proxies from closing the stream. */
const HEARTBEAT_INTERVAL_MS = 15_000

export interface SSEStream {
  send: (data: Record<string, unknown>) => void
  end: () => void
  /** True once the client has gone away and writes are being dropped. */
  readonly closed: boolean
}

/**
 * Start an SSE (Server-Sent Events) response stream.
 *
 * Handles the two things a long-lived AI stream needs beyond the headers:
 * a heartbeat, so a proxy does not close a connection that is quiet while the
 * model thinks, and disconnect tracking, so writes stop once the client is gone
 * instead of erroring against a destroyed socket.
 */
export function startSSE(reply: FastifyReply): SSEStream {
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    // Disable proxy buffering (nginx and friends) so deltas arrive incrementally.
    'X-Accel-Buffering': 'no',
  })

  let closed = false

  const heartbeat = setInterval(() => {
    if (closed) return
    // A comment frame: ignored by EventSource, but keeps the socket warm.
    reply.raw.write(': keep-alive\n\n')
  }, HEARTBEAT_INTERVAL_MS)
  // Do not hold the event loop open on account of the heartbeat alone.
  heartbeat.unref?.()

  const teardown = () => {
    if (closed) return
    closed = true
    clearInterval(heartbeat)
  }

  reply.raw.on('close', teardown)
  reply.raw.on('error', teardown)

  return {
    get closed() { return closed },
    send(data: Record<string, unknown>) {
      if (closed) return
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`)
    },
    end() {
      if (closed) return
      teardown()
      reply.raw.end()
    },
  }
}
