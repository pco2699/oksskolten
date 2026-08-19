import { useState } from 'react'
import { Check, Download } from 'lucide-react'
import { useI18n } from '../../lib/i18n'
import { useInstallPrompt } from '../../hooks/use-install-prompt'

function isIOS(): boolean {
  if (/iPhone|iPad|iPod/.test(navigator.userAgent)) return true
  // iPadOS 13+ reports as Mac with touch points
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
}

/**
 * "Install app" section shown on the Settings > About tab.
 *
 * Chrome/Edge fire `beforeinstallprompt` when the PWA meets installability
 * criteria; the useInstallPrompt hook captures it so we can re-trigger the
 * native install dialog from this button (works even after the one-time
 * browser install hint has been dismissed).
 *
 * There are several reasons the event may never arrive — iOS Safari has no
 * equivalent, the app is already installed, or the browser only offers install
 * from its own menu — so this section always renders a manual hint rather than
 * nothing at all. Rendering nothing made the section look broken on Android
 * Chrome whenever the event was absent.
 */
export function InstallSettings() {
  const { t } = useI18n()
  const { canInstall, isInstalled, promptInstall } = useInstallPrompt()
  const [busy, setBusy] = useState(false)

  if (isInstalled) {
    return (
      <div className="mt-6 flex items-center gap-1.5 text-sm text-muted select-none">
        <Check size={14} className="text-accent" />
        {t('install.installed')}
      </div>
    )
  }

  if (!canInstall) {
    return (
      <p className="mt-6 max-w-xs text-center text-xs text-muted select-none">
        {isIOS() ? t('install.iosHint') : t('install.manualHint')}
      </p>
    )
  }

  return (
    <div className="mt-6 flex flex-col items-center gap-2 select-none">
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          try {
            await promptInstall()
          } finally {
            setBusy(false)
          }
        }}
        className="inline-flex items-center gap-1.5 px-4 py-1.5 text-sm rounded-lg bg-accent text-white hover:opacity-90 transition-opacity disabled:opacity-50"
      >
        <Download size={14} strokeWidth={2} />
        {t('install.button')}
      </button>
      <p className="max-w-xs text-center text-xs text-muted">{t('install.desc')}</p>
    </div>
  )
}
