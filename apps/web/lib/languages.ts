import type { Direction } from './direction'

export interface Language {
  code: string
  translationKey: string
  nativeName: string
  /** Text direction of the language. Behaviour lives in lib/direction.ts. */
  dir: Direction
}

export const AVAILABLE_LANGUAGES: Language[] = [
  { code: 'en', translationKey: 'common.english', nativeName: 'English', dir: 'ltr' },
  { code: 'fr', translationKey: 'common.french', nativeName: 'Français', dir: 'ltr' },
  { code: 'de', translationKey: 'common.german', nativeName: 'Deutsch', dir: 'ltr' },
  { code: 'es', translationKey: 'common.spanish', nativeName: 'Español', dir: 'ltr' },
  { code: 'ar', translationKey: 'common.arabic', nativeName: 'العربية', dir: 'rtl' },
  { code: 'ja', translationKey: 'common.japanese', nativeName: '日本語', dir: 'ltr' },
  { code: 'pt', translationKey: 'common.portuguese', nativeName: 'Português', dir: 'ltr' },
  { code: 'ru', translationKey: 'common.russian', nativeName: 'Русский', dir: 'ltr' },
  { code: 'zh', translationKey: 'common.chinese', nativeName: '简体中文', dir: 'ltr' },
  { code: 'hi', translationKey: 'common.hindi', nativeName: 'हिन्दी', dir: 'ltr' },
  { code: 'ko', translationKey: 'common.korean', nativeName: '한국어', dir: 'ltr' },
  { code: 'it', translationKey: 'common.italian', nativeName: 'Italiano', dir: 'ltr' },
  { code: 'tr', translationKey: 'common.turkish', nativeName: 'Türkçe', dir: 'ltr' },
  { code: 'vi', translationKey: 'common.vietnamese', nativeName: 'Tiếng Việt', dir: 'ltr' },
  { code: 'id', translationKey: 'common.indonesian', nativeName: 'Bahasa Indonesia', dir: 'ltr' },
  { code: 'pl', translationKey: 'common.polish', nativeName: 'Polski', dir: 'ltr' },
  { code: 'uk', translationKey: 'common.ukrainian', nativeName: 'Українська', dir: 'ltr' },
  { code: 'nl', translationKey: 'common.dutch', nativeName: 'Nederlands', dir: 'ltr' },
  { code: 'th', translationKey: 'common.thai', nativeName: 'ไทย', dir: 'ltr' },
  { code: 'bn', translationKey: 'common.bengali', nativeName: 'বাংলা', dir: 'ltr' },
  { code: 'sk', translationKey: 'common.slovak', nativeName: 'Slovenčina', dir: 'ltr' },
  { code: 'fa', translationKey: 'common.persian', nativeName: 'فارسی', dir: 'rtl' },
]

export const getLanguageByCode = (code: string): Language | undefined => {
  return AVAILABLE_LANGUAGES.find(lang => lang.code === code)
}

export const getCurrentLanguageNativeName = (currentLang: string): string => {
  const language = getLanguageByCode(currentLang)
  return language?.nativeName || 'English'
}
