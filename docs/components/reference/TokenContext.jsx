'use client'

import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { TOKEN_STORAGE_KEY } from '../../lib/reference/config'

/**
 * Holds the visitor's API token (paste once, used everywhere).
 * Stored only in localStorage — never sent anywhere except as the
 * Authorization header of playground requests the visitor triggers.
 */
const TokenContext = createContext({ token: '', setToken: () => {}, clearToken: () => {} })

export function TokenProvider({ children }) {
  const [token, setTokenState] = useState('')

  // Hydration-safe: read localStorage after mount, sync across tabs.
  useEffect(() => {
    try {
      setTokenState(localStorage.getItem(TOKEN_STORAGE_KEY) || '')
    } catch {}
    const onStorage = (e) => {
      if (e.key === TOKEN_STORAGE_KEY) setTokenState(e.newValue || '')
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const setToken = useCallback((value) => {
    const trimmed = (value || '').trim()
    setTokenState(trimmed)
    try {
      if (trimmed) localStorage.setItem(TOKEN_STORAGE_KEY, trimmed)
      else localStorage.removeItem(TOKEN_STORAGE_KEY)
    } catch {}
  }, [])

  const clearToken = useCallback(() => setToken(''), [setToken])

  return (
    <TokenContext.Provider value={{ token, setToken, clearToken }}>
      {children}
    </TokenContext.Provider>
  )
}

export function useApiToken() {
  return useContext(TokenContext)
}
