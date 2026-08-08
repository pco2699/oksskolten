export function formatDate(iso: string | null, locale: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', timeZone: 'UTC' }
  if (d.getUTCFullYear() !== new Date().getUTCFullYear()) {
    opts.year = 'numeric'
  }
  return d.toLocaleDateString(locale, opts)
}

export function formatRelativeDate(iso: string | null, locale: string, opts?: { justNow?: string }): string {
  if (!iso) return ''
  const d = new Date(iso)
  const diffSec = Math.floor((Date.now() - d.getTime()) / 1000)
  if (diffSec < 60) return opts?.justNow ?? 'just now'
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return rtf.format(-diffMin, 'minute')
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return rtf.format(-diffHr, 'hour')
  const diffDay = Math.floor(diffHr / 24)
  if (diffDay < 30) return rtf.format(-diffDay, 'day')
  return formatDate(iso, locale)
}

export function formatDetailDate(iso: string | null, locale: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}
