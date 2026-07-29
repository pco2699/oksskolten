import { useI18n } from '../../lib/i18n'
import type { KeyBindings } from '../../hooks/use-keyboard-navigation'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from './dialog'

interface KeyboardShortcutsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  keyBindings: KeyBindings
}

/** Feedly-style '?' help overlay listing all keyboard shortcuts. */
export function KeyboardShortcutsDialog({ open, onOpenChange, keyBindings }: KeyboardShortcutsDialogProps) {
  const { t } = useI18n()

  const rows: Array<{ keys: string[]; label: string }> = [
    { keys: [keyBindings.next, keyBindings.prev], label: t('shortcuts.next') + ' / ' + t('shortcuts.prev') },
    { keys: ['o', 'Enter'], label: t('shortcuts.open') },
    { keys: [keyBindings.openExternal, 'v'], label: t('shortcuts.openExternal') },
    { keys: [keyBindings.bookmark, 's'], label: t('shortcuts.bookmark') },
    { keys: ['m'], label: t('shortcuts.toggleRead') },
    { keys: ['Shift', 'A'], label: t('shortcuts.markAllRead') },
    { keys: ['Esc'], label: t('shortcuts.close') },
    { keys: ['?'], label: t('shortcuts.showHelp') },
  ]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('shortcuts.title')}</DialogTitle>
        </DialogHeader>
        <ul className="space-y-2">
          {rows.map((row, i) => (
            <li key={i} className="flex items-center justify-between gap-4 text-sm">
              <span className="text-text">{row.label}</span>
              <span className="flex items-center gap-1 shrink-0">
                {row.keys.map((key, j) => (
                  <kbd
                    key={j}
                    className="min-w-[1.5rem] px-1.5 py-0.5 text-center text-xs font-mono rounded border border-border bg-bg-card text-muted"
                  >
                    {key}
                  </kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  )
}
