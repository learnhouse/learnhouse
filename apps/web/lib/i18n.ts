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

async function loadLocale(lng: string) {
  const code = lng.split('-')[0]
  if (code === 'en' || !LOCALE_LOADERS[code]) return;
  if (i18n.hasResourceBundle(code, 'common')) return;

  try {
    const mod = await LOCALE_LOADERS[code]();
    i18n.addResourceBundle(code, 'common', mod.default, true, true);
  } catch (e) {
    console.warn(`Failed to load locale: ${lng}`, e);
  }
}

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
      order: ['localStorage', 'cookie', 'querystring', 'navigator', 'path', 'subdomain'],
      caches: ['localStorage', 'cookie'],
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
