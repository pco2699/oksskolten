import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useInstallPrompt, __resetInstallPromptForTests } from './use-install-prompt'

function dispatchBeforeInstallPrompt(outcome: 'accepted' | 'dismissed') {
  const event = new Event('beforeinstallprompt')
  Object.assign(event, {
    prompt: vi.fn().mockResolvedValue(undefined),
    userChoice: Promise.resolve({ outcome }),
  })
  window.dispatchEvent(event)
}

function dispatchAppInstalled() {
  window.dispatchEvent(new Event('appinstalled'))
}

beforeEach(() => {
  localStorage.clear()
  __resetInstallPromptForTests()
})

describe('useInstallPrompt', () => {
  it('starts as not installable and not installed', () => {
    const { result } = renderHook(() => useInstallPrompt())
    expect(result.current.canInstall).toBe(false)
    expect(result.current.isInstalled).toBe(false)
  })

  it('becomes installable when beforeinstallprompt fires', () => {
    const { result } = renderHook(() => useInstallPrompt())
    act(() => dispatchBeforeInstallPrompt('accepted'))
    expect(result.current.canInstall).toBe(true)
    expect(result.current.isInstalled).toBe(false)
  })

  it('reports installed when appinstalled fires', () => {
    const { result } = renderHook(() => useInstallPrompt())
    act(() => dispatchAppInstalled())
    expect(result.current.isInstalled).toBe(true)
    expect(result.current.canInstall).toBe(false)
  })

  it('promptInstall returns unavailable when no event was captured', async () => {
    const { result } = renderHook(() => useInstallPrompt())
    let outcome: string | undefined
    await act(async () => {
      outcome = await result.current.promptInstall()
    })
    expect(outcome).toBe('unavailable')
  })

  it('promptInstall triggers the native dialog and installs on accept', async () => {
    const { result } = renderHook(() => useInstallPrompt())
    act(() => dispatchBeforeInstallPrompt('accepted'))
    expect(result.current.canInstall).toBe(true)

    let outcome: string | undefined
    await act(async () => {
      outcome = await result.current.promptInstall()
    })
    expect(outcome).toBe('accepted')
    expect(result.current.canInstall).toBe(false)
    expect(result.current.isInstalled).toBe(true)
  })

  it('keeps the event for retry when the user dismisses the dialog', async () => {
    const { result } = renderHook(() => useInstallPrompt())
    act(() => dispatchBeforeInstallPrompt('dismissed'))

    let outcome: string | undefined
    await act(async () => {
      outcome = await result.current.promptInstall()
    })
    expect(outcome).toBe('dismissed')
    // Still installable so the button can be used again
    expect(result.current.canInstall).toBe(true)
    expect(result.current.isInstalled).toBe(false)
  })

  it('defers the browser prompt so the event stays usable', () => {
    renderHook(() => useInstallPrompt())
    const event = new Event('beforeinstallprompt', { cancelable: true })
    Object.assign(event, {
      prompt: vi.fn().mockResolvedValue(undefined),
      userChoice: Promise.resolve({ outcome: 'accepted' }),
    })
    act(() => {
      window.dispatchEvent(event)
    })
    expect(event.defaultPrevented).toBe(true)
  })

  it('remembers an install so a later browser tab still reports it', () => {
    renderHook(() => useInstallPrompt())
    act(() => dispatchAppInstalled())
    expect(localStorage.getItem('pwa_installed')).toBe('1')

    // A plain browser tab opened later: no event, no standalone display mode
    act(() => __resetInstallPromptForTests())
    const reopened = renderHook(() => useInstallPrompt())
    expect(reopened.result.current.isInstalled).toBe(true)
    expect(reopened.result.current.canInstall).toBe(false)
  })

  it('clears a stale marker when the browser offers to install again', () => {
    localStorage.setItem('pwa_installed', '1')
    act(() => __resetInstallPromptForTests())
    const { result } = renderHook(() => useInstallPrompt())
    expect(result.current.isInstalled).toBe(true)

    // beforeinstallprompt only fires for an app that is not installed, so it is
    // proof that a marker left behind by an uninstall is out of date
    act(() => dispatchBeforeInstallPrompt('accepted'))
    expect(result.current.isInstalled).toBe(false)
    expect(result.current.canInstall).toBe(true)
    expect(localStorage.getItem('pwa_installed')).toBeNull()
  })

  it('survives blocked site data, which throws instead of no-opping', () => {
    const blocked = () => {
      throw new DOMException('site data blocked', 'SecurityError')
    }
    const realStorage = window.localStorage
    vi.stubGlobal('localStorage', {
      getItem: blocked,
      setItem: blocked,
      removeItem: blocked,
      clear: blocked,
    })
    try {
      // This module is imported during startup, so a throw here breaks boot
      act(() => __resetInstallPromptForTests())
      const { result } = renderHook(() => useInstallPrompt())
      expect(result.current.isInstalled).toBe(false)

      // The badge still works within the session, it just is not remembered
      act(() => dispatchAppInstalled())
      expect(result.current.isInstalled).toBe(true)
    } finally {
      vi.stubGlobal('localStorage', realStorage)
    }
  })

  it('reflects standalone display mode as installed', async () => {
    // jsdom setup stubs matchMedia with matches: false; emulate standalone here
    const realMatchMedia = window.matchMedia
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: true,
      media: '(display-mode: standalone)',
      addEventListener: () => {},
      removeEventListener: () => {},
    })))
    __resetInstallPromptForTests()
    const { result } = renderHook(() => useInstallPrompt())
    await waitFor(() => expect(result.current.isInstalled).toBe(true))
    vi.stubGlobal('matchMedia', realMatchMedia)
  })
})
