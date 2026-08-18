import { useCallback, useSyncExternalStore } from 'react'

/**
 * Captures the browser's `beforeinstallprompt` event so the app can offer its
 * own "Install app" button (Settings > About) at any time.
 *
 * The event is stored in a module-level store because the browser may fire it
 * before React mounts the settings page (e.g. right after page load).
 *
 * Note: we intentionally do NOT call `preventDefault()` on the event, so
 * Chrome on Android still shows its native mini-infobar on first visit. This
 * hook only keeps a reference to the event so we can also trigger the install
 * dialog from our own UI.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
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

if (typeof window !== 'undefined') {
  installed = isStandalone()

  window.addEventListener('beforeinstallprompt', (e) => {
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
  return () => listeners.delete(callback)
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
