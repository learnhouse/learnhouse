import type { CSSProperties } from 'react'
import type { LearnHouseTheme } from './types'

const px = (v: string | number | undefined) => (typeof v === 'number' ? `${v}px` : v)

/** Theme → CSS custom properties on the renderer root (read by styles in index.css). */
export function themeToStyle(theme: LearnHouseTheme = {}): CSSProperties {
  const vars: Record<string, string | undefined> = {
    '--lh-accent': theme.accent,
    '--lh-bg': theme.background,
    '--lh-text': theme.text,
    '--lh-muted': theme.mutedText,
    '--lh-border': theme.border,
    '--lh-font': theme.fontFamily,
    '--lh-heading-font': theme.headingFontFamily,
    '--lh-code-font': theme.codeFontFamily,
    '--lh-font-size': px(theme.fontSize),
    '--lh-radius': px(theme.radius),
    '--lh-content-width': theme.contentWidth === 'none' ? 'none' : px(theme.contentWidth),
    '--lh-padding': px(theme.padding),
    ...theme.cssVariables,
  }
  return Object.fromEntries(Object.entries(vars).filter(([, v]) => v !== undefined)) as CSSProperties
}

export function resolveMode(mode: LearnHouseTheme['mode']): 'light' | 'dark' {
  if (mode === 'dark') return 'dark'
  if (mode === 'auto' && typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
    return 'dark'
  }
  return 'light'
}

const RTL = new Set(['ar', 'fa', 'he', 'ur'])
export const isRtl = (locale: string) => RTL.has(locale.split('-')[0])
