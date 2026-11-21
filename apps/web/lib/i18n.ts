'use client'

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import en from '../locales/en.json';
import { loadDateLocale } from './format';

const LOCALE_LOADERS: Record<string, () => Promise<{ default: any }>> = {
  fr: () => import('../locales/fr.json'),
  de: () => import('../locales/de.json'),
  es: () => import('../locales/es.json'),
  ar: () => import('../locales/ar.json'),
  ja: () => import('../locales/ja.json'),
  pt: () => import('../locales/pt.json'),
  ru: () => import('../locales/ru.json'),
  zh: () => import('../locales/zh.json'),
  hi: () => import('../locales/hi.json'),
  ko: () => import('../locales/ko.json'),
  it: () => import('../locales/it.json'),
  tr: () => import('../locales/tr.json'),
  vi: () => import('../locales/vi.json'),
  id: () => import('../locales/id.json'),
  pl: () => import('../locales/pl.json'),
  uk: () => import('../locales/uk.json'),
  nl: () => import('../locales/nl.json'),
  th: () => import('../locales/th.json'),
  bn: () => import('../locales/bn.json'),
  fa: () => import('../locales/fa.json'),
  sk: () => import('../locales/sk.json'),
};

// Only bundle English; lazy-load all other locales on demand
const resources = {
  en: { common: en },
};

// The server always renders English (it can't read the visitor's
// localStorage pick). If a locale bundle lands before React hydrates, the first
// client render is in that language and hydration fails (React #418), which
// throws away the server HTML. So bundles that arrive before hydration wait
// here until I18nProvider has mounted (markHydrated) and the browser is idle:
// Suspense boundaries hydrate in later tasks than the root, and idle time is
// the first point where all of that work is done.
let hydrated = typeof window === 'undefined'
let releaseScheduled = false
let pendingBundles: Array<() => void> = []

function releasePendingBundles() {
  hydrated = true
  const run = pendingBundles
  pendingBundles = []
  run.forEach((add) => add())
}

export function markHydrated() {
  if (hydrated || releaseScheduled) return
  releaseScheduled = true
  const idle = (window as any).requestIdleCallback as
    | ((cb: () => void, opts?: { timeout: number }) => number)
    | undefined
  if (idle) idle(releasePendingBundles, { timeout: 1500 })
  else window.setTimeout(releasePendingBundles, 300)
}

async function loadLocale(lng: string) {
  const code = lng.split('-')[0]
  if (code === 'en' || !LOCALE_LOADERS[code]) return;
  if (i18n.hasResourceBundle(code, 'common')) return;

  try {
    const mod = await LOCALE_LOADERS[code]();
    const add = () => i18n.addResourceBundle(code, 'common', mod.default, true, true);
    if (hydrated) add();
    else pendingBundles.push(add);
  } catch (e) {
    console.warn(`Failed to load locale: ${lng}`, e);
  }
}

// A sandboxed iframe without allow-same-origin throws on any document.cookie
// access, and the detector's cookie lookup doesn't catch it: i18n init failed
// and embedded pages rendered nothing. Leave cookies out when they can't be read.
function cookiesReadable(): boolean {
  if (typeof document === 'undefined') return true
  try {
    void document.cookie
    return true
  } catch {
    return false
  }
}
const canUseCookies = cookiesReadable()

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'en',
    ns: ['common'],
    defaultNS: 'common',
    interpolation: {
      escapeValue: false, // react already safes from xss
    },
    detection: {
      order: canUseCookies
        ? ['localStorage', 'cookie', 'querystring', 'navigator', 'path', 'subdomain']
        : ['localStorage', 'querystring', 'navigator', 'path', 'subdomain'],
      caches: canUseCookies ? ['localStorage', 'cookie'] : ['localStorage'],
      lookupLocalStorage: 'i18nextLng',
      lookupCookie: 'i18next',
    },
    react: {
      useSuspense: false,
      // Non-English bundles arrive after the first render (see loadLocale).
      // Adding a bundle doesn't change the language, so without this the `t`
      // from useTranslation keeps its identity and anything memoized on it
      // (useMemo(..., [t])) stays in English until a full reload. Re-rendering
      // on the store's 'added' event hands every consumer a fresh `t`.
      bindI18nStore: 'added',
    }
  });

// Load the detected language if it's not English. Rendering doesn't wait for
// it: English shows first and useTranslation consumers re-render when the
// bundle is added (bindI18nStore above). The promise is exported for callers
// that need the translations in place before acting.
// The date locale rides along: dayjs keeps its own registry, and without this
// every "2 hours ago" renders in English no matter the language.
export const initialLocaleReady = Promise.all([
  loadLocale(i18n.language.split('-')[0]),
  loadDateLocale(i18n.language),
]).then(() => undefined);

/**
 * Switch language safely: preloads the bundle before switching
 * so the UI never flashes English as a fallback.
 */
/** Every UI language the app ships. */
export const SUPPORTED_LANGUAGES = ['en', ...Object.keys(LOCALE_LOADERS)]

export async function changeLanguage(lng: string) {
  await Promise.all([loadLocale(lng), loadDateLocale(lng)])
  return i18n.changeLanguage(lng)
}

export default i18n;
