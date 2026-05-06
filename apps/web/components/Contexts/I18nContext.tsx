'use client'

import React, { useEffect, useState } from 'react'
import i18n from '../../lib/i18n'

export default function I18nProvider({ children }: { children: React.ReactNode }) {
  const [, setLang] = useState(i18n.language)

  // Listen for language changes to force re-render of the entire tree.
  // (English is bundled at module load; non-English bundles load lazily and
  // translations swap in when ready via react-i18next's `useSuspense: false`
  // — no need to block initial render on the locale fetch.)
  useEffect(() => {
    const handleLanguageChanged = (lng: string) => {
      setLang(lng)
    }
    i18n.on('languageChanged', handleLanguageChanged)
    return () => {
      i18n.off('languageChanged', handleLanguageChanged)
    }
  }, [])

  return <>{children}</>
}
