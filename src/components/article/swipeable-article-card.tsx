import { useRef } from 'react'
import { motion, useMotionValue, useTransform, type PanInfo } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { ArticleCard, type ArticleDisplayConfig } from './article-card'
import { articleUrlToPath } from '../../lib/url'
import type { ArticleListItem } from '../../../shared/types'
import type { LayoutName } from '../../data/layouts'

interface SwipeableArticleCardProps extends ArticleDisplayConfig {
  article: ArticleListItem
  layout?: LayoutName
  isFeatured?: boolean
  onClick?: (e: React.MouseEvent<HTMLAnchorElement>) => void
  onToggleBookmark?: () => void
  onToggleLike?: () => void
}

const SWIPE_THRESHOLD = 80
const VELOCITY_THRESHOLD = 500

export function SwipeableArticleCard({
  article,
  layout,
  isFeatured,
  dateMode,
  indicatorStyle,
  showUnreadIndicator,
  showThumbnails,
  onClick: onClickProp,
  onToggleBookmark,
  onToggleLike,
}: SwipeableArticleCardProps) {
  const navigate = useNavigate()
  const x = useMotionValue(0)
  const isDragging = useRef(false)

  // Background indicator opacity based on drag distance
  const leftOpacity = useTransform(x, [-SWIPE_THRESHOLD, 0], [1, 0])

  const handleDragEnd = (_: unknown, info: PanInfo) => {
    const { offset, velocity } = info
    isDragging.current = false

    // Left swipe → open article
    if (offset.x < -SWIPE_THRESHOLD || velocity.x < -VELOCITY_THRESHOLD) {
      void navigate(articleUrlToPath(article.url))
      return
    }
  }

  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    // Let browser handle Cmd+Click, Ctrl+Click natively (open in new tab)
    if (e.metaKey || e.ctrlKey || e.button === 1) return
    e.preventDefault()
    // Only navigate if not dragging
    if (!isDragging.current) {
      if (onClickProp) { onClickProp(e) }
      else { void navigate(articleUrlToPath(article.url)) }
    }
  }

  return (
    <div className="relative overflow-hidden select-none">
      {/* Left swipe background (open article) */}
      <motion.div
        className="absolute inset-0 flex items-center justify-end pr-6 bg-accent/20"
        style={{ opacity: leftOpacity }}
      >
        <ArrowRight className="w-5 h-5 text-accent" />
      </motion.div>

      {/* Draggable card */}
      <motion.div
        style={{ x }}
        drag="x"
        dragConstraints={{ left: 0, right: 0 }}
        dragSnapToOrigin
        dragElastic={0.3}
        onDragStart={() => { isDragging.current = true }}
        onDragEnd={handleDragEnd}
        className="relative bg-bg"
      >
        <ArticleCard
          article={article}
          layout={layout}
          isFeatured={isFeatured}
          dateMode={dateMode}
          indicatorStyle={indicatorStyle}
          showUnreadIndicator={showUnreadIndicator}
          showThumbnails={showThumbnails}
          onClick={handleClick}
          onToggleBookmark={onToggleBookmark}
          onToggleLike={onToggleLike}
        />
      </motion.div>
    </div>
  )
}
