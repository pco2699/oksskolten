const STORAGE_KEY = 'auth_token'

let _token: string | null = null
let _cached = false

export const AUTH_LOGOUT_EVENT = 'reader:auth-logout'

// localStorage is shared across tabs, so a login or logout elsewhere makes this
// tab's in-memory copy wrong. `storage` only fires in *other* tabs, which is
// exactly the case the cache cannot otherwise notice.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== STORAGE_KEY && e.key !== null) return
    _token = null
    _cached = false
    if (e.key === STORAGE_KEY && e.newValue === null) {
      window.dispatchEvent(new Event(AUTH_LOGOUT_EVENT))
    }
  })
}

export function getAuthToken(): string | null {
  if (!_cached) {
    _token = localStorage.getItem(STORAGE_KEY)
    _cached = true
  }
  return _token
}

export function setAuthToken(token: string | null): void {
  _token = token
  _cached = true
  if (token) {
    localStorage.setItem(STORAGE_KEY, token)
  } else {
    localStorage.removeItem(STORAGE_KEY)
  }
}

export function logoutClient(): void {
  setAuthToken(null)
  window.history.replaceState({}, '', '/')
  window.dispatchEvent(new Event(AUTH_LOGOUT_EVENT))
}
