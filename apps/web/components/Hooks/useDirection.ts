'use client'

import { useTranslation } from 'react-i18next'
import { directionForLanguage, dirMultiplier, type Direction } from '@/lib/direction'

/**
 * Current UI text direction, reactive to language changes.
 *
 * Subscribes via `useTranslation` rather than a new context: I18nProvider
 * already re-renders the tree on `languageChanged`, and react-i18next listens
 * to that same event.
 *
 * ⚠ THE ONE RULE
 * On the server `i18n.language` is always `en`, so the first render is always
 * `ltr`. Therefore this hook must NEVER choose between two different DOM
 * structures — that's a guaranteed hydration mismatch.
 *
 *   OK:  x={20 * dx}                    (motion animates post-mount)
 *   OK:  dir={dir} / data-foo={isRTL}   (attribute only)
 *   OK:  className={isRTL ? 'rotate-180' : ''}   (transform only, no layout)
 *   NOT: {isRTL ? <Left /> : <Right />}          (different trees)
 *
 * If you genuinely need a structural swap, gate it behind a `mounted` flag —
 * see components/Utils/LanguageSwitcher.tsx for the pattern.
 */
export function useDirection(): { dir: Direction; isRTL: boolean; x: 1 | -1 } {
  const { i18n } = useTranslation()
  const dir = directionForLanguage(i18n.language)

  return { dir, isRTL: dir === 'rtl', x: dirMultiplier(dir) }
}

export default useDirection
