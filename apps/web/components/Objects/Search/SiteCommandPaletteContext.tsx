'use client'
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

interface SiteCommandPaletteValue {
  open: boolean
  setOpen: (_open: boolean) => void
  toggle: () => void
}

const SiteCommandPaletteContext = createContext<SiteCommandPaletteValue | null>(null)

/**
 * Open state for the learner-facing command palette plus its shortcut.
 * ⌘K on Apple keyboards and Ctrl K everywhere else both toggle it, so the
 * same handler serves macOS, Windows and Linux.
 */
export function SiteCommandPaletteProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const toggle = useCallback(() => setOpen((v) => !v), [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return
      if (e.key.toLowerCase() !== 'k') return
      e.preventDefault()
      setOpen((v) => !v)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const value = useMemo(() => ({ open, setOpen, toggle }), [open, toggle])
  return (
    <SiteCommandPaletteContext.Provider value={value}>{children}</SiteCommandPaletteContext.Provider>
  )
}

export function useSiteCommandPalette() {
  const ctx = useContext(SiteCommandPaletteContext)
  if (!ctx) throw new Error('useSiteCommandPalette must be used within SiteCommandPaletteProvider')
  return ctx
}
