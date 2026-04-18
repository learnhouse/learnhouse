'use client'

import { useTranslation } from 'react-i18next'

const DEFAULT_LOCALE = 'he-IL'

function normalizeLocale(locale?: string | null): string {
  if (!locale) return DEFAULT_LOCALE
  const code = locale.split('-')[0].toLowerCase()
  // Expand bare language codes to full locale tags where it matters for formatting.
  if (code === 'he') return 'he-IL'
  if (code === 'ar') return 'ar-EG'
  if (code === 'en') return 'en-US'
  return locale
}

/**
 * Format a money amount in the given currency.
 * Locale defaults to he-IL; pass i18n.language from useTranslation() for per-user locale.
 */
export function formatMoney(amount: number, currency: string, locale?: string): string {
  return new Intl.NumberFormat(normalizeLocale(locale), {
    style: 'currency',
    currency,
  }).format(amount)
}

/**
 * Format a date (accepts Date | ISO string | epoch ms).
 * Locale defaults to he-IL.
 */
export function formatDate(
  date: Date | string | number,
  locale?: string,
  opts: Intl.DateTimeFormatOptions = { dateStyle: 'medium' }
): string {
  const d = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date
  return new Intl.DateTimeFormat(normalizeLocale(locale), opts).format(d)
}

/**
 * Client-side hook: returns the current i18next language, suitable for passing to
 * formatMoney/formatDate. For server components, use getServerLocale() from lib/serverLocale.
 */
export function useLocale(): string {
  const { i18n } = useTranslation()
  return i18n.language || DEFAULT_LOCALE
}
