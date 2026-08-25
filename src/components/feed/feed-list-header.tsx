import { useNavigate } from 'react-router-dom'
import { IconButton } from '@/components/ui/icon-button'
import { useI18n } from '../../lib/i18n'

interface FeedListHeaderProps {
  onClose: () => void
  onCollapse: () => void
}

export function FeedListHeader({ onClose, onCollapse }: FeedListHeaderProps) {
  const navigate = useNavigate()
  const { t } = useI18n()

  return (
    <div className="flex items-center justify-between px-4 pb-2 shrink-0" style={{ paddingTop: 'calc(var(--safe-area-inset-top) + 12px)' }}>
      <button
        onClick={() => { void navigate('/all'); onClose() }}
        className="flex items-center gap-2 outline-none transition-opacity hover:opacity-70"
      >
        <span className="text-[26px] font-semibold tracking-tight text-text font-logo" aria-label={t('header.title')}>{t('header.title')}</span>
      </button>
      <div className="flex items-center gap-1">
        <IconButton onClick={onCollapse} className="hidden md:flex">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="1.5" y="1.5" width="13" height="13" rx="2" />
            <path d="M6 1.5v13" />
          </svg>
        </IconButton>
      </div>
    </div>
  )
}
