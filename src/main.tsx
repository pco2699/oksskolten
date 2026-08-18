import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import { toast } from 'sonner'
import App from './app'
import './index.css'
import { flushOfflineQueue } from './lib/offlineQueue'
import { translate } from './lib/i18n'
// Capture the browser's beforeinstallprompt event at startup (before the
// lazily-loaded settings page mounts) so its install button can trigger the
// native install dialog at any time.
import './hooks/use-install-prompt'

const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    toast(translate('toast.newVersion'), {
      duration: Infinity,
      action: {
        label: translate('toast.reload'),
        onClick: () => updateSW(true),
      },
    })
  },
})

window.addEventListener('online', () => flushOfflineQueue().catch(() => {}))
if (navigator.onLine) flushOfflineQueue().catch(() => {})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
