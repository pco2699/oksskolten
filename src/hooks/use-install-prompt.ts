import { useCallback, useSyncExternalStore } from 'react'

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

export type InstallOutcome = 'accepted' | 'dismissed' | 'unavailable'

/**
 * Remembers that this origin has been launched as an installed app.
 *
 * A browser tab cannot otherwise tell "installed" from "not installable":
 * once the PWA is installed the browser stops firing `beforeinstallprompt`,
 * and the tab still reports `display-mode: browser`. Android shares storage
 * between Chrome and the installed WebAPK, so opening the app once is enough
 * for later browser tabs to know.
 *
 * `navigator.getInstalledRelatedApps()` would answer this directly, but it
 * requires the manifest to list itself under `related_applications`, and that
 * entry makes Chrome for Android drop "Install app" from its menu entirely.
 * Not being able to install at all is far worse than a missing badge.
 */
const INSTALLED_KEY = 'pwa_installed'

let deferredPrompt: BeforeInstallPromptEvent | null = null
let installed = false
const listeners = new Set<() => void>()

function isStandalone(): boolean {
  if (window.matchMedia('(display-mode: standalone)').matches) return true
  // iOS Safari never fires beforeinstallprompt; it reports standalone here
  return (window.navigator as Navigator & { standalone?: boolean }).standalone === true
}

/** Storage throws rather than no-ops when the user blocks site data. */
function readInstalledMarker(): boolean {
  try {
    return localStorage.getItem(INSTALLED_KEY) === '1'
  } catch {
    return false
  }
}

function writeInstalledMarker(value: boolean) {
  try {
    if (value) localStorage.setItem(INSTALLED_KEY, '1')
    else localStorage.removeItem(INSTALLED_KEY)
  } catch {
    // Site data blocked — the badge just falls back to the manual hint
  }
}

function setInstalled(value: boolean) {
  installed = value
  writeInstalledMarker(value)
  notify()
}

function notify() {
  for (const listener of listeners) listener()
}

if (typeof window !== 'undefined') {
  installed = isStandalone() || readInstalledMarker()
  if (isStandalone()) writeInstalledMarker(true)

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferredPrompt = e as BeforeInstallPromptEvent
    // The browser only offers to install what is not installed yet, so this is
    // also how a marker left behind by an uninstall gets cleared.
    setInstalled(false)
  })

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null
    setInstalled(true)
  })

  const displayMode = window.matchMedia('(display-mode: standalone)')
  displayMode.addEventListener('change', (e) => {
    if (e.matches) setInstalled(true)
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

/**
 * Test-only: reset the module-level store between tests. Re-reads the stored
 * marker exactly like a fresh page load, so a test can set one up and then
 * assert what a newly opened tab would see.
 */
export function __resetInstallPromptForTests() {
  deferredPrompt = null
  installed = isStandalone() || readInstalledMarker()
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
      setInstalled(true)
    }
    return outcome
  }, [])

  return { canInstall, isInstalled, promptInstall }
}
