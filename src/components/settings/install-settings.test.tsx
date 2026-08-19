import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import { LocaleContext } from '../../lib/i18n'
import { __resetInstallPromptForTests } from '../../hooks/use-install-prompt'
import { InstallSettings } from './install-settings'

// --- navigator mock ---
const originalNavigator = window.navigator

function stubNavigator(overrides: Partial<Navigator>) {
  Object.defineProperty(window, 'navigator', {
    value: { ...originalNavigator, ...overrides },
    writable: true,
    configurable: true,
  })
}

function dispatchBeforeInstallPrompt() {
  const event = new Event('beforeinstallprompt')
  Object.assign(event, {
    prompt: vi.fn().mockResolvedValue(undefined),
    userChoice: Promise.resolve({ outcome: 'accepted' }),
  })
  window.dispatchEvent(event)
}

function renderComponent() {
  return render(
    <LocaleContext.Provider value={{ locale: 'en', setLocale: () => {} }}>
      <InstallSettings />
    </LocaleContext.Provider>,
  )
}

beforeEach(() => {
  __resetInstallPromptForTests()
  stubNavigator({ platform: 'Win32', userAgent: 'Mozilla/5.0 (Windows NT 10.0)' })
})

afterAll(() => {
  Object.defineProperty(window, 'navigator', {
    value: originalNavigator,
    writable: true,
    configurable: true,
  })
})

describe('InstallSettings', () => {
  it('shows the manual hint when not installable on non-iOS', () => {
    renderComponent()
    expect(
      screen.getByText(
        'If no install button appears, use your browser menu \u2192 Install app (Add to Home screen). It also stays hidden once the app is installed',
      ),
    ).toBeTruthy()
  })

  it('shows the installed badge when the browser reports the PWA as installed', async () => {
    stubNavigator({
      platform: 'Linux armv8l',
      userAgent: 'Mozilla/5.0 (Linux; Android 14)',
      getInstalledRelatedApps: vi
        .fn()
        .mockResolvedValue([{ platform: 'webapp', url: '/manifest.webmanifest' }]),
    } as Partial<Navigator>)
    renderComponent()
    await waitFor(() => expect(screen.getByText('Installed')).toBeTruthy())
  })

  it('renders the install button when installable', () => {
    renderComponent()
    act(() => dispatchBeforeInstallPrompt())
    expect(screen.getByText('Install')).toBeTruthy()
    expect(screen.getByText('Install as an app you can launch from your home screen in one tap')).toBeTruthy()
  })

  it('shows installed badge after accepting the install dialog', async () => {
    renderComponent()
    act(() => dispatchBeforeInstallPrompt())
    fireEvent.click(screen.getByText('Install'))
    await waitFor(() => expect(screen.getByText('Installed')).toBeTruthy())
  })

  it('shows the iOS hint instead of the button on iPhone', () => {
    stubNavigator({
      platform: 'iPhone',
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
    })
    renderComponent()
    expect(
      screen.getByText('On iPhone/iPad, install via Share → Add to Home Screen'),
    ).toBeTruthy()
  })
})
