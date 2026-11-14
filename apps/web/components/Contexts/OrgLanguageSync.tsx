'use client'

import { useEffect } from 'react'
import { useOrg } from './OrgContext'
import i18n, { changeLanguage } from '@/lib/i18n'

const USER_PICKED_KEY = 'i18nextLng_userPicked'

/** `locale` (e.g. from an embed's ?locale=) wins over the organization's default and the visitor's pick. */
export default function OrgLanguageSync({ locale }: { locale?: string | null } = {}) {
  const org = useOrg() as any

  const orgDefault: string | undefined =
    org?.config?.config?.customization?.general?.default_language ||
    org?.config?.config?.general?.default_language

  useEffect(() => {
    if (locale) {
      if (i18n.language.split('-')[0] !== locale) changeLanguage(locale)
      return
    }
    if (!orgDefault) return

    let userPicked: string | null = null
    try {
      userPicked = localStorage.getItem(USER_PICKED_KEY)
    } catch {
      // Storage blocked (private mode, sandboxed frame): fall back to the org default.
    }
    if (userPicked) return

    if (i18n.language.split('-')[0] !== orgDefault) {
      changeLanguage(orgDefault)
    }
  }, [orgDefault, locale])

  return null
}
