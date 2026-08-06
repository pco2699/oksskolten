import { lookup } from 'node:dns/promises'
import { lookup as dnsLookup, type LookupAddress } from 'node:dns'
import net from 'node:net'
import { Agent } from 'undici'
import { assertResponseSize } from './response-limits.js'

/**
 * True for addresses that must never be reachable from a user-supplied URL:
 * loopback, RFC1918, link-local (including the cloud metadata endpoint),
 * carrier-grade NAT, and their IPv6 equivalents.
 *
 * Input must already be a canonical IP literal — use `parseIpLiteral` first, so
 * that alternate encodings (decimal, octal, hex) cannot slip past these checks.
 */
export function isPrivateIP(ip: string): boolean {
  const version = net.isIP(ip)
  if (version === 4) return isPrivateIPv4(ip)
  if (version === 6) return isPrivateIPv6(ip)
  // Not a canonical IP literal — treat as unsafe rather than guessing.
  return true
}

function isPrivateIPv4(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number)
  if (a === 0) return true                            // 0.0.0.0/8 "this network"
  if (a === 10) return true                           // RFC1918
  if (a === 127) return true                          // loopback
  if (a === 169 && b === 254) return true             // link-local + metadata
  if (a === 172 && b >= 16 && b <= 31) return true    // RFC1918
  if (a === 192 && b === 168) return true             // RFC1918
  if (a === 100 && b >= 64 && b <= 127) return true   // RFC6598 CGNAT
  if (a === 192 && b === 0) return true               // RFC6890 protocol assignments
  if (a >= 224) return true                           // multicast + reserved + broadcast
  return false
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase()
  if (lower === '::' || lower === '::1') return true   // unspecified / loopback
  if (/^f[cd]/.test(lower)) return true                // fc00::/7 unique local
  if (/^fe[89ab]/.test(lower)) return true             // fe80::/10 link-local
  if (/^ff/.test(lower)) return true                   // multicast

  // IPv4-mapped (::ffff:127.0.0.1) and IPv4-compatible forms tunnel an IPv4
  // address through IPv6 notation and would otherwise skip every check above.
  const mapped = lower.match(/^::(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/)
  if (mapped) return isPrivateIPv4(mapped[1])
  // ::ffff:7f00:1 — the same mapping written as hex groups.
  const hexMapped = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
  if (hexMapped) {
    const high = parseInt(hexMapped[1], 16)
    const low = parseInt(hexMapped[2], 16)
    return isPrivateIPv4([high >> 8, high & 0xff, low >> 8, low & 0xff].join('.'))
  }
  return false
}

/**
 * Return the canonical IP literal for a URL hostname, or null if the hostname
 * is a name that needs DNS resolution.
 *
 * `URL.hostname` leaves alternate IPv4 encodings intact — `2130706433`,
 * `0x7f.1` and `127.1` are all 127.0.0.1 to the resolver but none of them look
 * like an IP to a naive dotted-quad test. Anything numeric-looking is decoded
 * here so it reaches `isPrivateIP` in canonical form.
 */
export function parseIpLiteral(hostname: string): string | null {
  // Bracketed IPv6 literal: [::1]
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    const inner = hostname.slice(1, -1)
    return net.isIP(inner) ? inner : inner // return as-is; isPrivateIP rejects non-IPs
  }
  if (net.isIP(hostname)) return hostname

  // Alternate IPv4 encodings: dotted or bare, decimal / octal / hex parts.
  const parts = hostname.split('.')
  if (parts.length > 4 || parts.some((p) => p === '')) return null

  const values: number[] = []
  for (const part of parts) {
    let value: number
    if (/^0[xX][0-9a-fA-F]+$/.test(part)) value = parseInt(part, 16)
    else if (/^0[0-7]+$/.test(part)) value = parseInt(part, 8)
    else if (/^\d+$/.test(part)) value = parseInt(part, 10)
    else return null // contains letters — a real hostname
    if (!Number.isFinite(value) || value < 0) return null
    values.push(value)
  }

  // The last part absorbs the remaining octets: 127.1 -> 127.0.0.1,
  // 2130706433 -> 127.0.0.1.
  const last = values.pop()
  if (last === undefined) return null
  const maxLast = 2 ** (8 * (4 - values.length))
  if (last >= maxLast) return null
  if (values.some((v) => v > 255)) return null

  const octets = [...values]
  for (let i = 4 - values.length - 1; i >= 0; i--) {
    octets.push((last >> (8 * i)) & 0xff)
  }
  return octets.join('.')
}

/**
 * Resolve a hostname to every address it maps to.
 * Returns an empty list when resolution fails, so the caller can let the real
 * fetch surface the DNS error.
 */
async function resolveAll(hostname: string): Promise<string[]> {
  try {
    const results = await lookup(hostname, { all: true })
    return results.map((r) => r.address)
  } catch {
    return []
  }
}

/**
 * Reject a URL that points at a private address.
 *
 * Every resolved address is checked, not just the first: a hostname with both a
 * public and a private A record would otherwise pass on the public one.
 *
 * This is an up-front check for a clear error message; `safeFetch` additionally
 * re-validates at connect time, which is what actually closes the rebinding
 * window (see `ssrfDispatcher`).
 */
export async function assertSafeUrl(url: string): Promise<void> {
  const parsed = new URL(url)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Blocked URL: disallowed protocol ${parsed.protocol}`)
  }
  const hostname = parsed.hostname
  if (hostname === 'localhost' || hostname.endsWith('.local') || hostname.endsWith('.internal') || hostname.endsWith('.localhost')) {
    throw new Error(`Blocked URL: private hostname ${hostname}`)
  }

  const literal = parseIpLiteral(hostname)
  if (literal) {
    if (isPrivateIP(literal)) throw new Error(`Blocked URL: private IP ${literal}`)
    return
  }

  for (const address of await resolveAll(hostname)) {
    if (isPrivateIP(address)) {
      throw new Error(`Blocked URL: ${hostname} resolves to private IP ${address}`)
    }
  }
}

/**
 * Dispatcher that re-checks the resolved address at connect time.
 *
 * `assertSafeUrl` alone is check-then-use: it resolves the hostname, and the
 * connection then resolves it a second time. An attacker controlling DNS with a
 * short TTL can answer public on the first lookup and private on the second
 * (DNS rebinding). Validating inside the connect `lookup` hook removes the
 * second resolution entirely — the address that is validated is the address
 * that gets connected to.
 */
const ssrfDispatcher = new Agent({
  connect: {
    lookup(hostname, options, callback) {
      dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
        if (err) return callback(err, '', 0)
        const list = addresses as LookupAddress[]
        if (list.length === 0) {
          return callback(new Error(`Blocked URL: ${hostname} did not resolve`), '', 0)
        }
        for (const entry of list) {
          if (isPrivateIP(entry.address)) {
            return callback(new Error(`Blocked URL: ${hostname} resolves to private IP ${entry.address}`), '', 0)
          }
        }
        // Mirror the shape the caller asked for.
        if (options.all) return callback(null, list as never, 0)
        return callback(null, list[0].address, list[0].family)
      })
    },
  },
})

const MAX_REDIRECTS = 5
// Only actual redirect statuses per RFC 7231/7538.
// Excludes 300 (Multiple Choices) and 304 (Not Modified).
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

/**
 * Fetch with SSRF protection on the initial URL and on every redirect hop.
 *
 * Redirects are followed manually (`redirect: 'manual'`) because the platform
 * fetch would otherwise follow a 302 into private address space without any
 * further checks — and, for callers that set auth headers, would forward those
 * headers to the internal target.
 */
export async function safeFetch(url: string, init?: RequestInit): Promise<Response> {
  await assertSafeUrl(url)
  let currentUrl = url
  for (let i = 0; i < MAX_REDIRECTS; i++) {
    // `dispatcher` is an undici extension to RequestInit that Node's global
    // fetch honors but does not declare in its types.
    const res = await fetch(currentUrl, { ...init, redirect: 'manual', dispatcher: ssrfDispatcher } as RequestInit)
    if (REDIRECT_STATUSES.has(res.status)) {
      const location = res.headers.get('location')
      if (!location) throw new Error(`Redirect without Location header from ${currentUrl}`)
      currentUrl = new URL(location, currentUrl).href
      await assertSafeUrl(currentUrl)
      continue
    }
    assertResponseSize(res)
    return res
  }
  throw new Error(`Too many redirects (max ${MAX_REDIRECTS})`)
}
