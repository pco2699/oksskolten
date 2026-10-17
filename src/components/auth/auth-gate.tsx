import { useCallback, useEffect, useState } from 'react'
import useSWR from 'swr'
import { AUTH_LOGOUT_EVENT, getAuthToken, setAuthToken } from '../../lib/auth'
import { ApiError } from '../../lib/api-base'
import { LoginPage } from '../../pages/login-page'

// AuthGate uses its own fetcher that does NOT redirect on 401.
// The global fetcher calls window.location.href = '/' on 401, which causes
// an infinite reload loop when unauthenticated. AuthGate handles 401 by
// showing LoginPage instead.
//
// The fetcher also distinguishes "server rejected the session" from
// "network unreachable": a non-ok response throws ApiError (carries an HTTP
// status), while a dropped connection makes fetch() itself reject with a
// plain TypeError (no status). The render gate below uses that distinction
// to render cached content optimistically while offline, instead of
// bouncing a previously-signed-in user to the login form.
const meFetcher = (url: string) => {
  const token = getAuthToken()
  return fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  }).then(r => {
    if (!r.ok) throw new ApiError('Unauthorized', r.status, {})
    return r.json()
  })
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [exchanging, setExchanging] = useState(false)
  const { data, error, isLoading, mutate } = useSWR<{ email: string }>('/api/me', meFetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: true,
    errorRetryCount: 0,
  })

  const handleLogin = useCallback((token: string) => {
    setAuthToken(token)
    void mutate()
  }, [mutate])

  useEffect(() => {
    const handleLogout = () => {
      void mutate(undefined, { revalidate: false })
    }

    window.addEventListener(AUTH_LOGOUT_EVENT, handleLogout)
    return () => window.removeEventListener(AUTH_LOGOUT_EVENT, handleLogout)
  }, [mutate])

  // OAuth exchange code handling
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const code = params.get('oauth_code')
    if (!code) return

    // Clean URL immediately
    params.delete('oauth_code')
    const clean = params.toString()
    window.history.replaceState({}, '', clean ? `/?${clean}` : '/')

    setExchanging(true)
    fetch('/api/oauth/github/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    })
      .then(res => res.ok ? res.json() : Promise.reject())
      .then(data => {
        setAuthToken(data.token)
        void mutate()
      })
      .catch(() => { /* LoginPage will show via error state */ })
      .finally(() => setExchanging(false))
  }, [mutate])

  if (isLoading || exchanging) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg text-text">
        <div className="rounded-full border-2 border-border border-t-accent h-8 w-8 animate-spin" aria-label="Loading" />
      </div>
    )
  }
  if (error) {
    // Server explicitly rejected the session (e.g. 401): show the login form.
    if (error instanceof ApiError) return <LoginPage onLogin={handleLogin} />

    // Otherwise this is a network failure (fetch rejected, no HTTP status).
    // If we previously established a session, render optimistically so the
    // app keeps working offline against the service worker's cached API
    // responses. `revalidateOnReconnect` reconciles the real auth state
    // once connectivity returns. Never do this for someone with no token.
    if (getAuthToken()) return <>{children}</>

    return <LoginPage onLogin={handleLogin} />
  }
  if (!data) return <LoginPage onLogin={handleLogin} />

  return <>{children}</>
}
