/**
 * Body-size limits for outbound fetches.
 *
 * Kept separate from `ssrf.ts` and `http.ts` so both can depend on it without
 * a cycle (`http.ts` already imports `safeFetch` from `ssrf.ts`).
 */

/** Refuse bodies larger than this — an unbounded read is an OOM vector. */
export const MAX_RESPONSE_BYTES = 10 * 1024 * 1024 // 10 MB

export class ResponseTooLargeError extends Error {
  constructor(bytes: number | string) {
    super(`Response too large (${bytes} bytes, max ${MAX_RESPONSE_BYTES})`)
    this.name = 'ResponseTooLargeError'
  }
}

/**
 * Reject an oversized response before its body is buffered.
 *
 * Only the advertised length can be checked here; `readCapped` enforces the
 * real limit while streaming, for servers that omit Content-Length.
 */
export function assertResponseSize(res: Response): void {
  const declared = res.headers.get('content-length')
  if (declared && Number(declared) > MAX_RESPONSE_BYTES) {
    throw new ResponseTooLargeError(declared)
  }
}

/**
 * Read a response body, aborting once it exceeds `MAX_RESPONSE_BYTES`.
 * Returns the raw bytes so the caller can decode with the right charset.
 */
export async function readCapped(res: Response): Promise<Uint8Array> {
  assertResponseSize(res)
  // No stream available (or a stubbed Response) — fall back to a buffered read.
  if (!res.body?.getReader) return new Uint8Array(await res.arrayBuffer())

  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel()
        throw new ResponseTooLargeError(`>${MAX_RESPONSE_BYTES}`)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}
