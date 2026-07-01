export const AUTH_EXPIRED_EVENT = 'learnhouse:auth-expired'
export const AUTH_REFRESHED_EVENT = 'learnhouse:auth-refreshed'

type AuthExpiredDetail = {
  callbackUrl?: string
  reason?: string
}

type AuthRefreshedDetail = {
  access_token?: string
  expiry?: number
}

let lastAuthExpiredAt = 0
const AUTH_EXPIRED_DEBOUNCE_MS = 1500

export function dispatchAuthExpired(detail: AuthExpiredDetail = {}) {
  if (typeof window === 'undefined') return

  const now = Date.now()
  if (now - lastAuthExpiredAt < AUTH_EXPIRED_DEBOUNCE_MS) {
    return
  }
  lastAuthExpiredAt = now

  window.dispatchEvent(new CustomEvent<AuthExpiredDetail>(AUTH_EXPIRED_EVENT, { detail }))
}

export function dispatchAuthRefreshed(detail: AuthRefreshedDetail = {}) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<AuthRefreshedDetail>(AUTH_REFRESHED_EVENT, { detail }))
}
