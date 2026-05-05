'use client'
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

interface CommandPaletteValue {
  open: boolean
  setOpen: (open: boolean) => void
  toggle: () => void
}

const CommandPaletteContext = createContext<CommandPaletteValue | null>(null)

export function CommandPaletteProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)

  const toggle = useCallback(() => setOpen((v) => !v), [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const value = useMemo<CommandPaletteValue>(() => ({ open, setOpen, toggle }), [open, toggle])

  return <CommandPaletteContext.Provider value={value}>{children}</CommandPaletteContext.Provider>
}

export function useCommandPalette() {
  const ctx = useContext(CommandPaletteContext)
  if (!ctx) {
    throw new Error('useCommandPalette must be used within CommandPaletteProvider')
  }
  return ctx
}
