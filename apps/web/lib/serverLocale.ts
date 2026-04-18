import { cookies, headers } from 'next/headers'

export const RTL_LANGS = new Set(['he', 'ar', 'fa', 'ur'])

export const SUPPORTED_LANGS = new Set([
  'en', 'he', 'fr', 'de', 'es', 'ar', 'ja', 'pt', 'ru', 'zh',
  'hi', 'ko', 'it', 'tr', 'vi', 'id', 'pl', 'nl', 'th', 'bn',
])

export const DEFAULT_LANG = 'he'

export const LOCALE_COOKIE = 'i18next'

export async function getServerLocale(): Promise<string> {
  const cookieStore = await cookies()
  const fromCookie = cookieStore.get(LOCALE_COOKIE)?.value
  if (fromCookie) {
    const code = fromCookie.split('-')[0].toLowerCase()
    if (SUPPORTED_LANGS.has(code)) return code
  }

  const hdrs = await headers()
  const accept = hdrs.get('accept-language')
  if (accept) {
    for (const part of accept.split(',')) {
      const code = part.split(';')[0].trim().split('-')[0].toLowerCase()
      if (SUPPORTED_LANGS.has(code)) return code
    }
  }

  return DEFAULT_LANG
}

export function getDir(lang: string): 'rtl' | 'ltr' {
  return RTL_LANGS.has(lang) ? 'rtl' : 'ltr'
}
