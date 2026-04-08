'use client'

import React, { useEffect, useState } from 'react'
import i18n, { initialLocaleReady } from '../../lib/i18n'
import { useTranslation } from 'react-i18next'

export default function I18nProvider({ children }: { children: React.ReactNode }) {
  const { i18n: i18nInstance } = useTranslation()
  const [isReady, setIsReady] = useState(false)
  const [, setLang] = useState(i18n.language)

  useEffect(() => {
    // Wait for both i18n initialization AND the detected locale bundle to load
    const waitForReady = async () => {
      if (!i18n.isInitialized) {
        await new Promise<void>((resolve) => {
          i18n.on('initialized', () => resolve())
        })
      }
      await initialLocaleReady
      setIsReady(true)
    }
    waitForReady()
  }, [])

  // Listen for language changes to force re-render of the entire tree
  useEffect(() => {
    const handleLanguageChanged = (lng: string) => {
      setLang(lng)
    }
    i18n.on('languageChanged', handleLanguageChanged)
    return () => {
      i18n.off('languageChanged', handleLanguageChanged)
    }
  }, [])

  // Show nothing while i18n + locale resources are loading
  if (!isReady) {
    return null
  }

  return <>{children}</>
}
