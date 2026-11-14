/*
 Color scheme (Light / Dark) for the whole app.

 Manual only: the scheme never follows the OS. Light is the default and stays
 exactly the look the app always had; dark is opt-in from the user menu, the
 account settings, the command palette or the public header.

 How it is applied
   <html data-theme="dark">   set before first paint by public/theme-init.js
                              (inlined in the root layout), and by
                              applyColorScheme() when the user switches.
   styles/dark.css            everything keyed off that attribute: the soft
                              dark palette, Tailwind palette remaps, and the
                              per-surface fixes.

 Where it is kept
   localStorage `lh:theme`    this browser, read before paint (no flash, no
                              cookie, so pages stay static).
   user.ui_preferences.theme  the account, so a signed-in user gets it on every
                              browser (synced by ColorSchemeProvider).

 Keep THEME_STORAGE_KEY and the exempt routes in sync with
 public/theme-init.js, which runs before any bundle and cannot import this
 (tests/color-scheme.test.mjs checks both).
*/

export type ColorScheme = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'lh:theme'
/** Fired on window after the scheme changes in this tab. */
export const THEME_CHANGE_EVENT = 'lh:theme-change'
/** Browser chrome color (mobile address bar) per scheme. */
export const THEME_COLOR: Record<ColorScheme, string> = { light: '#ffffff', dark: '#0b0b0c' }

export function isColorScheme(value: unknown): value is ColorScheme {
  return value === 'light' || value === 'dark'
}

/**
 Routes that never take the user's scheme: embeds render inside someone
 else's page and follow the host (bgcolor / block theme detection).
*/
export function isThemeExempt(pathname: string): boolean {
  return /^\/embed\//.test(pathname)
}

export function readStoredColorScheme(): ColorScheme {
  try {
    const v = window.localStorage.getItem(THEME_STORAGE_KEY)
    return isColorScheme(v) ? v : 'light'
  } catch {
    return 'light'
  }
}

export function storeColorScheme(scheme: ColorScheme): void {
  try {
    if (scheme === 'light') window.localStorage.removeItem(THEME_STORAGE_KEY)
    else window.localStorage.setItem(THEME_STORAGE_KEY, scheme)
  } catch {
    // storage blocked (private mode): the choice lasts for this page only
  }
}

/** The scheme currently painted (what <html> carries). */
export function currentColorScheme(): ColorScheme {
  if (typeof document === 'undefined') return 'light'
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'
}

/** Paints `scheme` on <html> and tells listeners. No-op on exempt routes. */
export function applyColorScheme(scheme: ColorScheme): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (isThemeExempt(window.location.pathname)) return
  if (scheme === 'dark') {
    root.setAttribute('data-theme', 'dark')
    root.style.colorScheme = 'dark'
  } else {
    root.removeAttribute('data-theme')
    root.style.removeProperty('color-scheme')
  }
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', THEME_COLOR[scheme])
  window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, { detail: scheme }))
}
