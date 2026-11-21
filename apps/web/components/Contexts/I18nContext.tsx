'use client'

import React, { useEffect, useState } from 'react'
import i18n, { markHydrated } from '../../lib/i18n'
import { applyDocumentDirection } from '../../lib/direction'

export default function I18nProvider({ children }: { children: React.ReactNode }) {
  const [, setLang] = useState(i18n.language)

  // Listen for language changes to force re-render of the entire tree.
  // (English is bundled at module load; non-English bundles load lazily and
  // useTranslation consumers re-render when one is added, via the
  // `bindI18nStore: 'added'` option in lib/i18n.ts, so there is no need to
  // block initial render on the locale fetch.)
  //
  // This is also where <html lang/dir> is kept in sync. public/dir-init.js sets
  // it before first paint; the mount-time call below reconciles the two in case
  // that script was blocked, or i18next resolved a different fallback than the
  // raw detector value. It runs post-hydration, so it can't cause a mismatch.
  useEffect(() => {
    // Hydration is done: the visitor's language bundle may now apply (see
    // markHydrated in lib/i18n.ts).
    markHydrated()
    applyDocumentDirection(i18n.language)

    const handleLanguageChanged = (lng: string) => {
      applyDocumentDirection(lng)
      setLang(lng)
    }
    i18n.on('languageChanged', handleLanguageChanged)
    return () => {
      i18n.off('languageChanged', handleLanguageChanged)
    }
  }, [])

  return <>{children}</>
}
