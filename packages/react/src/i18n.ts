import i18next from 'i18next'
import type { i18n as I18n } from 'i18next'
import { initReactI18next } from 'react-i18next'
// Generated at build time from apps/web/locales: only the keys the bundled
// blocks use, one chunk per language (see scripts/build.mjs).
import { EN, LOADERS } from './generated/locales'

export const SUPPORTED_LOCALES = ['en', ...Object.keys(LOADERS)]

// Each provider/renderer gets its own instance so the host app's i18next (if
// any) is never touched, and two embeds can use different languages.
export function createI18n(): I18n {
  const instance = i18next.createInstance()
  void instance.use(initReactI18next).init({
    resources: { en: { common: EN } },
    lng: 'en',
    fallbackLng: 'en',
    ns: ['common'],
    defaultNS: 'common',
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
    initAsync: false,
  })
  return instance
}

const pending = new WeakMap<I18n, Map<string, Promise<void>>>()

// Loads a language bundle once per instance, even when called concurrently,
// so a late duplicate load can never overwrite `messages` applied after it.
function loadBundle(instance: I18n, code: string): Promise<void> {
  if (code === 'en' || !LOADERS[code]) return Promise.resolve()
  let byCode = pending.get(instance)
  if (!byCode) pending.set(instance, (byCode = new Map()))
  let promise = byCode.get(code)
  if (!promise) {
    promise = LOADERS[code]()
      .then((mod) => {
        instance.addResourceBundle(code, 'common', mod.default ?? mod, true, false)
      })
      .catch((error) => console.warn(`[@learnhouse/react] could not load locale "${code}"`, error))
    byCode.set(code, promise)
  }
  return promise
}

export async function applyLocale(instance: I18n, locale: string, messages?: Record<string, any>) {
  const code = locale.split('-')[0]
  await loadBundle(instance, code)
  if (messages) instance.addResourceBundle(code, 'common', messages, true, true)
  if (instance.language !== code) await instance.changeLanguage(code)
}

// Web modules that translate outside React (`i18n.t(...)` in error paths)
// import the app's global instance; the shim hands them the most recently
// rendered renderer's instance instead.
let current: I18n | null = null
export function setCurrentI18n(instance: I18n) {
  current = instance
}
export function currentI18n(): I18n {
  return (current ??= createI18n())
}
