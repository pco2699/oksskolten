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
