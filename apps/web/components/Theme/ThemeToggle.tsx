'use client'

import React, { useEffect, useState } from 'react'
import { useTheme } from 'next-themes'
import { Moon, Sun } from 'lucide-react'

/**
 * ZekaHouse dark-mode activation toggle.
 *
 * This is the *activation layer* for dark mode: the codebase already ships
 * ~133 `dark:` Tailwind variants and a full `.dark` design-token block in
 * globals.css, but nothing ever put the `.dark` class on <html>. next-themes'
 * ThemeProvider (mounted in Providers.tsx) does that; this control flips it.
 *
 * Rendered as a discreet floating button so it touches only Providers.tsx —
 * keeping the change additive and low-conflict against upstream. Relocate it
 * into HeaderProfileBox / an account menu whenever that's desired.
 */
export default function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  // Avoid hydration mismatch: theme is only known client-side.
  useEffect(() => setMounted(true), [])

  const isDark = resolvedTheme === 'dark'

  return (
    <button
      type="button"
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      className="fixed bottom-4 left-4 z-[9997] flex h-10 w-10 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-700 shadow-md transition-colors hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800"
    >
      {/* Render a stable icon until mounted to keep SSR/CSR markup identical. */}
      {mounted && isDark ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  )
}
