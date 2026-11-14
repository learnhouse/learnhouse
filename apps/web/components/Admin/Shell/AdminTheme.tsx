'use client'
import React from 'react'
import './adminDark.css'

// The platform console follows the app-wide Light / Dark choice
// (lib/theme/colorScheme.ts, ColorSchemeProvider): one switch, manual only,
// saved to the account. The console renders inside
// <div data-adm-theme="light|dark">; adminDark.css keys its dark look off
// <html data-theme="dark"> (set before paint by theme-init.js) together with
// that marker, so portals follow, the first paint is right, and nothing
// lingers after leaving /admin.

import { useColorScheme } from '@components/Contexts/ColorSchemeContext'
import { readStoredColorScheme } from '@/lib/theme/colorScheme'
import { THEME_STORAGE_KEY as LEGACY_STORAGE_KEY, type AdminResolvedTheme, type AdminThemePref } from './themeConfig'

export type { AdminThemePref, AdminResolvedTheme }

const Ctx = React.createContext<{ pref: AdminThemePref; resolved: AdminResolvedTheme; setPref: (_p: AdminThemePref) => void }>({
  pref: 'light',
  resolved: 'light',
  setPref: () => {},
})

export function useAdminTheme() {
  return React.useContext(Ctx)
}

export default function AdminTheme({ children }: { children?: React.ReactNode }) {
  const { colorScheme, setColorScheme } = useColorScheme()

  // One-time carry-over: a console that was set to Dark on its own switch
  // keeps it when the app has no choice of its own yet.
  React.useEffect(() => {
    try {
      const legacy = window.localStorage.getItem(LEGACY_STORAGE_KEY)
      if (legacy === null) return
      window.localStorage.removeItem(LEGACY_STORAGE_KEY)
      if (legacy === 'dark' && readStoredColorScheme() === 'light') setColorScheme('dark')
    } catch {
      // storage blocked
    }
  }, [setColorScheme])

  const value = React.useMemo(
    () => ({ pref: colorScheme, resolved: colorScheme, setPref: setColorScheme }),
    [colorScheme, setColorScheme]
  )
  return (
    <Ctx.Provider value={value}>
      <div data-adm-theme={colorScheme} className="contents">
        {children}
      </div>
    </Ctx.Provider>
  )
}
