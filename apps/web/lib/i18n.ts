'use client'

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import en from '../locales/en.json';
import fr from '../locales/fr.json';
import de from '../locales/de.json';
import es from '../locales/es.json';
import ar from '../locales/ar.json';
import ja from '../locales/ja.json';
import pt from '../locales/pt.json';
import ru from '../locales/ru.json';
import zh from '../locales/zh.json';
import hi from '../locales/hi.json';
import ko from '../locales/ko.json';
import it from '../locales/it.json';
import tr from '../locales/tr.json';
import vi from '../locales/vi.json';
import id from '../locales/id.json';
import pl from '../locales/pl.json';
import nl from '../locales/nl.json';
import th from '../locales/th.json';
import bn from '../locales/bn.json';

const resources = {
  en: {
    common: en
  },
  fr: {
    common: fr
  },
  de: {
    common: de
  },
  es: {
    common: es
  },
  ar: {
    common: ar
  },
  ja: {
    common: ja
  },
  pt: {
    common: pt
  },
  ru: {
    common: ru
  },
  zh: {
    common: zh
  },
  hi: {
    common: hi
  },
  ko: {
    common: ko
  },
  it: {
    common: it
  },
  tr: {
    common: tr
  },
  vi: {
    common: vi
  },
  id: {
    common: id
  },
  pl: {
    common: pl
  },
  nl: {
    common: nl
  },
  th: {
    common: th
  },
  bn: {
    common: bn
  }
};

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
      order: ['querystring', 'cookie', 'localStorage', 'navigator', 'path', 'subdomain'],
      caches: ['localStorage', 'cookie'],
    }
  });

export default i18n;
