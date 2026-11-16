'use client'

/*
 The Light / Dark choice (lib/theme/colorScheme.ts), as React state.

 - The painted scheme lives on <html data-theme>; theme-init.js set it before
   the first paint, so this provider only mirrors it (useSyncExternalStore:
   the server and the hydration pass render "light", then the real value).
 - setColorScheme paints, saves to this browser, and for a signed-in user
   saves to the account (PUT /users/me/preferences) so other browsers follow.
 - When the session arrives with an account choice that differs from this
   browser's, the account wins (once per account value: a later switch here
   is not undone by a session refetch).
 - Other tabs follow through the storage event.
*/

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getAPIUrl } from '@services/config/config'
import { RequestBodyWithAuthHeader } from '@services/utils/ts/requests'
import {
  THEME_CHANGE_EVENT,
  THEME_COLOR,
  THEME_STORAGE_KEY,
  applyColorScheme,
  currentColorScheme,
  isColorScheme,
  readStoredColorScheme,
  storeColorScheme,
  type ColorScheme,
} from '@/lib/theme/colorScheme'

type Ctx = {
  colorScheme: ColorScheme
  setColorScheme: (_scheme: ColorScheme) => void
  toggleColorScheme: () => void
}

const ColorSchemeContext = createContext<Ctx>({
  colorScheme: 'light',
  setColorScheme: () => {},
  toggleColorScheme: () => {},
})

function subscribe(onChange: () => void) {
  window.addEventListener(THEME_CHANGE_EVENT, onChange)
  return () => window.removeEventListener(THEME_CHANGE_EVENT, onChange)
}

export async function saveAccountColorScheme(scheme: ColorScheme, accessToken: string): Promise<boolean> {
  try {
    const res = await fetch(
      `${getAPIUrl()}users/me/preferences`,
      RequestBodyWithAuthHeader('PUT', { theme: scheme }, null, accessToken)
    )
    return res.ok
  } catch {
    return false
  }
}

export default function ColorSchemeProvider({ children }: { children: React.ReactNode }) {
  const colorScheme = useSyncExternalStore(subscribe, currentColorScheme, () => 'light' as ColorScheme)
  const session = useLHSession()
  const accessToken: string | undefined = session?.data?.tokens?.access_token
  const accountScheme: unknown = session?.data?.user?.ui_preferences?.theme
  const userId: unknown = session?.data?.user?.id
  const seen = useRef<string | null>(null)

  // The <meta name="theme-color"> Next rendered is light; match the painted scheme.
  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta) meta.setAttribute('content', THEME_COLOR[currentColorScheme()])
  }, [])

  // Account → this browser.
  useEffect(() => {
    if (session?.status !== 'authenticated' || !isColorScheme(accountScheme)) return
    const key = `${String(userId)}:${accountScheme}`
    if (seen.current === key) return
    seen.current = key
    if (accountScheme !== readStoredColorScheme() || accountScheme !== currentColorScheme()) {
      storeColorScheme(accountScheme)
      applyColorScheme(accountScheme)
    }
  }, [session?.status, accountScheme, userId])

  // Other tabs.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== THEME_STORAGE_KEY) return
      applyColorScheme(isColorScheme(e.newValue) ? e.newValue : 'light')
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const setColorScheme = useCallback(
    (scheme: ColorScheme) => {
      storeColorScheme(scheme)
      applyColorScheme(scheme)
      if (session?.status === 'authenticated' && accessToken) {
        seen.current = `${String(userId)}:${scheme}`
        void saveAccountColorScheme(scheme, accessToken)
      }
    },
    [session?.status, accessToken, userId]
  )

  const toggleColorScheme = useCallback(() => {
    setColorScheme(currentColorScheme() === 'dark' ? 'light' : 'dark')
  }, [setColorScheme])

  const value = useMemo(() => ({ colorScheme, setColorScheme, toggleColorScheme }), [colorScheme, setColorScheme, toggleColorScheme])
  return <ColorSchemeContext.Provider value={value}>{children}</ColorSchemeContext.Provider>
}

export function useColorScheme() {
  return useContext(ColorSchemeContext)
}
