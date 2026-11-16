// The console theme is the app-wide Light / Dark choice
// (lib/theme/colorScheme.ts); these names are kept for the console's own
// switch. THEME_STORAGE_KEY is the console's old per-browser key, read once by
// AdminTheme to carry a Dark choice over, then removed.

import type { ColorScheme } from '@/lib/theme/colorScheme'

export type AdminThemePref = ColorScheme
export type AdminResolvedTheme = ColorScheme

export const THEME_STORAGE_KEY = 'lh:admin:theme'

export function isThemePref(v: unknown): v is AdminThemePref {
  return v === 'light' || v === 'dark'
}
