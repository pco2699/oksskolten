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
  it('renders nothing when not installable on non-iOS', () => {
    const { container } = renderComponent()
    expect(container.innerHTML).toBe('')
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
