// Replaces apps/web/lib/i18n: no language detector, no global instance, no
// 22 full locale files. See currentI18n() in ../i18n.
import type { i18n as I18n } from 'i18next'
import { currentI18n } from '../i18n'

const i18n = new Proxy({} as I18n, {
  get(_target, key) {
    const instance = currentI18n() as any
    const value = instance[key]
    return typeof value === 'function' ? value.bind(instance) : value
  },
})

export const initialLocaleReady = Promise.resolve()

export async function changeLanguage(lng: string) {
  await currentI18n().changeLanguage(lng)
}

export default i18n
