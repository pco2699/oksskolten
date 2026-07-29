import { useI18n } from '../../lib/i18n'

interface YouTubeEmbedProps {
  videoId: string
  title?: string
}

/**
 * Responsive 16:9 YouTube player embedded via youtube-nocookie.com.
 *
 * Rendered as a real React element (not injected through the markdown/sanitize
 * pipeline) since sanitizeHtml strips iframes on purpose.
 */
export function YouTubeEmbed({ videoId, title }: YouTubeEmbedProps) {
  const { t } = useI18n()

  return (
    <div className="aspect-video w-full border border-border rounded-lg overflow-hidden mb-6">
      <iframe
        className="w-full h-full"
        src={`https://www.youtube-nocookie.com/embed/${videoId}`}
        title={title || t('article.youtubePlayer')}
        loading="lazy"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
      />
    </div>
  )
}
