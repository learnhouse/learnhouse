export interface Language {
  code: string
  translationKey: string
  nativeName: string
}

export const AVAILABLE_LANGUAGES: Language[] = [
  { code: 'en', translationKey: 'common.english', nativeName: 'English' },
  { code: 'fr', translationKey: 'common.french', nativeName: 'Français' },
  { code: 'de', translationKey: 'common.german', nativeName: 'Deutsch' },
  { code: 'es', translationKey: 'common.spanish', nativeName: 'Español' },
  { code: 'ar', translationKey: 'common.arabic', nativeName: 'العربية' },
  { code: 'ja', translationKey: 'common.japanese', nativeName: '日本語' },
  { code: 'pt', translationKey: 'common.portuguese', nativeName: 'Português' },
  { code: 'ru', translationKey: 'common.russian', nativeName: 'Русский' },
  { code: 'zh', translationKey: 'common.chinese', nativeName: '简体中文' },
  { code: 'hi', translationKey: 'common.hindi', nativeName: 'हिन्दी' },
  { code: 'ko', translationKey: 'common.korean', nativeName: '한국어' },
  { code: 'it', translationKey: 'common.italian', nativeName: 'Italiano' },
  { code: 'tr', translationKey: 'common.turkish', nativeName: 'Türkçe' },
  { code: 'vi', translationKey: 'common.vietnamese', nativeName: 'Tiếng Việt' },
  { code: 'id', translationKey: 'common.indonesian', nativeName: 'Bahasa Indonesia' },
  { code: 'pl', translationKey: 'common.polish', nativeName: 'Polski' },
  { code: 'nl', translationKey: 'common.dutch', nativeName: 'Nederlands' },
  { code: 'th', translationKey: 'common.thai', nativeName: 'ไทย' },
  { code: 'bn', translationKey: 'common.bengali', nativeName: 'বাংলা' },
]

export const getLanguageByCode = (code: string): Language | undefined => {
  return AVAILABLE_LANGUAGES.find(lang => lang.code === code)
}

export const getCurrentLanguageNativeName = (currentLang: string): string => {
  const language = getLanguageByCode(currentLang)
  return language?.nativeName || 'English'
}

