import { useCallback, useEffect, useSyncExternalStore } from 'react'

/**
 * Captures the browser's `beforeinstallprompt` event so the app can offer its
 * own "Install app" button (Settings > About) at any time.
 *
 * The event is stored in a module-level store because the browser may fire it
 * before React mounts the settings page (e.g. right after page load).
 *
 * We call `preventDefault()` on the event: that is what tells the browser we
 * are deferring the prompt, and it is the only supported way to keep the event
 * usable for a later `prompt()` call. (Chrome dropped the mini-infobar in 76 —
 * on Android it now surfaces installability through the omnibox/menu instead,
 * so nothing is lost by preventing the default.)
 */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

interface RelatedApplication {
  platform?: string
  url?: string
  id?: string
}

export type InstallOutcome = 'accepted' | 'dismissed' | 'unavailable'

let deferredPrompt: BeforeInstallPromptEvent | null = null
let installed = false
const listeners = new Set<() => void>()

function isStandalone(): boolean {
  if (window.matchMedia('(display-mode: standalone)').matches) return true
  // iOS Safari never fires beforeinstallprompt; it reports standalone here
  return (window.navigator as Navigator & { standalone?: boolean }).standalone === true
}

function notify() {
  for (const listener of listeners) listener()
}

/**
 * Asks the browser whether our own PWA is already installed.
 *
 * This matters on Android Chrome: once the app is installed, Chrome stops
 * firing `beforeinstallprompt` entirely, and a regular browser tab still
 * reports `display-mode: browser`. Without this check the About section can
 * tell neither "installable" nor "installed" apart and shows nothing at all.
 *
 * Requires `related_applications: [{ platform: 'webapp', url: <manifest> }]`
 * in the manifest; unsupported browsers simply leave the state unchanged.
 */
async function detectInstalledRelatedApp(): Promise<void> {
  const getInstalledRelatedApps = (
    navigator as Navigator & {
      getInstalledRelatedApps?: () => Promise<RelatedApplication[]>
    }
  ).getInstalledRelatedApps
  if (typeof getInstalledRelatedApps !== 'function') return
  try {
    const apps = await getInstalledRelatedApps.call(navigator)
    if (apps.some((app) => app.platform === 'webapp')) {
      installed = true
      notify()
    }
  } catch {
    // Not supported / not allowed in this context — leave the state as is
  }
}

if (typeof window !== 'undefined') {
  installed = isStandalone()

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferredPrompt = e as BeforeInstallPromptEvent
    notify()
  })

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null
    installed = true
    notify()
  })

  const displayMode = window.matchMedia('(display-mode: standalone)')
  displayMode.addEventListener('change', (e) => {
    installed = e.matches
    notify()
  })
}

function subscribe(callback: () => void) {
  listeners.add(callback)
  return () => {
    listeners.delete(callback)
  }
}

function getSnapshot() {
  return deferredPrompt !== null
}

function getInstalledSnapshot() {
  return installed
}

/** Test-only: reset the module-level store between tests. */
export function __resetInstallPromptForTests() {
  deferredPrompt = null
  installed = isStandalone()
  notify()
}

export function useInstallPrompt() {
  const canInstall = useSyncExternalStore(subscribe, getSnapshot)
  const isInstalled = useSyncExternalStore(subscribe, getInstalledSnapshot)

  useEffect(() => {
    if (installed) return
    void detectInstalledRelatedApp()
  }, [])

  const promptInstall = useCallback(async (): Promise<InstallOutcome> => {
    const event = deferredPrompt
    if (!event) return 'unavailable'
    await event.prompt()
    const { outcome } = await event.userChoice
    // The event can only be used once; drop it after a successful install
    if (outcome === 'accepted') {
      deferredPrompt = null
      installed = true
      notify()
    }
    return outcome
  }, [])

  return { canInstall, isInstalled, promptInstall }
}
