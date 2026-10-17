import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

// --- Mocks ---
const mockMutate = vi.fn()
let swrReturn: { data: any; error: any; isLoading: boolean }

vi.mock('swr', () => ({
  default: (_key: string, _fetcher: any, _opts: any) => ({
    ...swrReturn,
    mutate: mockMutate,
  }),
}))

vi.mock('../../lib/auth', () => ({
  getAuthToken: vi.fn(() => 'test-token'),
  setAuthToken: vi.fn(),
  AUTH_LOGOUT_EVENT: 'reader:auth-logout',
}))

vi.mock('../../pages/login-page', () => ({
  LoginPage: ({ onLogin }: { onLogin: (token: string) => void }) => (
    <div data-testid="login-page">
      <button onClick={() => onLogin('new-token')}>Login</button>
    </div>
  ),
}))

import { AuthGate } from './auth-gate'
import { setAuthToken, getAuthToken, AUTH_LOGOUT_EVENT } from '../../lib/auth'
import { ApiError } from '../../lib/api-base'

describe('AuthGate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // clearAllMocks() does not reset a mock's return value, only its call
    // history, so re-establish the default explicitly to avoid leaking a
    // per-test override (e.g. mockReturnValue(null)) into later tests.
    vi.mocked(getAuthToken).mockReturnValue('test-token')
    swrReturn = { data: undefined, error: undefined, isLoading: true }
    // Ensure no oauth_code in URL
    window.history.replaceState({}, '', '/')
  })

  it('shows loading spinner while authenticating', () => {
    swrReturn = { data: undefined, error: undefined, isLoading: true }
    render(<AuthGate><div>App Content</div></AuthGate>)

    expect(screen.getByLabelText('Loading')).toBeTruthy()
    expect(screen.queryByText('App Content')).toBeNull()
    expect(screen.queryByTestId('login-page')).toBeNull()
  })

  it('shows children when authenticated', () => {
    swrReturn = { data: { email: 'user@example.com' }, error: undefined, isLoading: false }
    render(<AuthGate><div>App Content</div></AuthGate>)

    expect(screen.getByText('App Content')).toBeTruthy()
    expect(screen.queryByTestId('login-page')).toBeNull()
  })

  it('shows LoginPage on a genuine 401 while online', () => {
    // getAuthToken mock returns 'test-token' by default, i.e. we have a
    // session token but the server says it is no longer valid.
    swrReturn = { data: undefined, error: new ApiError('Unauthorized', 401, {}), isLoading: false }
    render(<AuthGate><div>App Content</div></AuthGate>)

    expect(screen.getByTestId('login-page')).toBeTruthy()
    expect(screen.queryByText('App Content')).toBeNull()
  })

  it('shows LoginPage when no data', () => {
    swrReturn = { data: undefined, error: undefined, isLoading: false }
    render(<AuthGate><div>App Content</div></AuthGate>)

    expect(screen.getByTestId('login-page')).toBeTruthy()
  })

  it('renders children on network failure when a session token exists (offline PWA)', () => {
    // A dropped connection makes fetch() reject with a plain error that has
    // no HTTP status attached, unlike ApiError.
    swrReturn = { data: undefined, error: new TypeError('Failed to fetch'), isLoading: false }
    render(<AuthGate><div>App Content</div></AuthGate>)

    expect(screen.getByText('App Content')).toBeTruthy()
    expect(screen.queryByTestId('login-page')).toBeNull()
  })

  it('shows LoginPage on network failure when there is no session token', () => {
    vi.mocked(getAuthToken).mockReturnValue(null)
    swrReturn = { data: undefined, error: new TypeError('Failed to fetch'), isLoading: false }
    render(<AuthGate><div>App Content</div></AuthGate>)

    expect(screen.getByTestId('login-page')).toBeTruthy()
    expect(screen.queryByText('App Content')).toBeNull()
  })

  it('calls setAuthToken and mutate on login', async () => {
    swrReturn = { data: undefined, error: new ApiError('Unauthorized', 401, {}), isLoading: false }
    render(<AuthGate><div>App Content</div></AuthGate>)

    const loginBtn = screen.getByText('Login')
    loginBtn.click()

    expect(setAuthToken).toHaveBeenCalledWith('new-token')
    expect(mockMutate).toHaveBeenCalled()
  })

  it('clears data on logout event', () => {
    swrReturn = { data: { email: 'user@example.com' }, error: undefined, isLoading: false }
    render(<AuthGate><div>App Content</div></AuthGate>)

    window.dispatchEvent(new Event(AUTH_LOGOUT_EVENT))

    expect(mockMutate).toHaveBeenCalledWith(undefined, { revalidate: false })
  })

  it('exchanges OAuth code from URL', async () => {
    swrReturn = { data: undefined, error: undefined, isLoading: false }

    window.history.replaceState({}, '', '/?oauth_code=abc123')

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ token: 'oauth-token' }),
    }))

    render(<AuthGate><div>App Content</div></AuthGate>)

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/api/oauth/github/token', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ code: 'abc123' }),
      }))
    })

    await waitFor(() => {
      expect(setAuthToken).toHaveBeenCalledWith('oauth-token')
      expect(mockMutate).toHaveBeenCalled()
    })

    // URL should be cleaned
    expect(window.location.search).not.toContain('oauth_code')
  })

  it('handles OAuth exchange failure gracefully', async () => {
    swrReturn = { data: undefined, error: undefined, isLoading: false }

    window.history.replaceState({}, '', '/?oauth_code=bad')

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({}),
    }))

    render(<AuthGate><div>App Content</div></AuthGate>)

    await waitFor(() => {
      expect(fetch).toHaveBeenCalled()
    })

    // Should not crash, LoginPage shows via error state
    expect(screen.getByTestId('login-page')).toBeTruthy()
  })

  it('does not exchange when no oauth_code in URL', () => {
    swrReturn = { data: { email: 'user@example.com' }, error: undefined, isLoading: false }

    vi.stubGlobal('fetch', vi.fn())

    render(<AuthGate><div>App Content</div></AuthGate>)

    // fetch should not have been called for OAuth exchange
    // (it might be called by other things, but not with /api/oauth path)
    const fetchCalls = vi.mocked(fetch).mock.calls
    const oauthCalls = fetchCalls.filter(c => String(c[0]).includes('/api/oauth'))
    expect(oauthCalls).toHaveLength(0)
  })
})
