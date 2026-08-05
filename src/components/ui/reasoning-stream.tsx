import { useEffect, useRef } from 'react'
import { Loader2 } from 'lucide-react'
import { useI18n } from '../../lib/i18n'

interface ReasoningStreamProps {
  /** Raw reasoning text accumulated so far. */
  text: string
}

/**
 * Live view of a model's reasoning tokens. Rendered as plain text rather than
 * Markdown — reasoning arrives as a half-finished stream of thought, and parsing
 * it mid-flight produces more flicker than structure. The box is capped and
 * pinned to the bottom so it reads as a ticker of current progress, not a
 * transcript to scroll back through.
 */
export function ReasoningStream({ text }: ReasoningStreamProps) {
  const { t } = useI18n()
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [text])

  if (!text) return null

  return (
    <div className="rounded-lg border border-border bg-bg-card px-3 py-2">
      <div className="flex items-center gap-2 text-xs text-muted select-none mb-1">
        <Loader2 className="w-3 h-3 animate-spin" />
        {t('ai.reasoning')}
      </div>
      <div
        ref={scrollRef}
        className="max-h-24 overflow-y-auto text-xs text-muted/80 whitespace-pre-wrap break-words leading-relaxed"
      >
        {text}
      </div>
    </div>
  )
}
