'use client'

import React, { useEffect, useState } from 'react'
import i18n from '../../lib/i18n'
import { useTranslation } from 'react-i18next'

export default function I18nProvider({ children }: { children: React.ReactNode }) {
  const { i18n: i18nInstance } = useTranslation()
  const [isReady, setIsReady] = useState(i18n.isInitialized)

  useEffect(() => {
    // Wait for i18n to be fully initialized
    if (i18n.isInitialized) {
      setIsReady(true)
    } else {
      const handleInitialized = () => {
        setIsReady(true)
      }
      i18n.on('initialized', handleInitialized)
      return () => {
        i18n.off('initialized', handleInitialized)
      }
    }
  }, [])

  // Also listen for language changes to trigger re-renders
  useEffect(() => {
    const handleLanguageChanged = () => {
      // Force a re-render when language changes
      setIsReady(true)
    }
    i18n.on('languageChanged', handleLanguageChanged)
    return () => {
      i18n.off('languageChanged', handleLanguageChanged)
    }
  }, [])

  // Show nothing while i18n is initializing to prevent flash of wrong language
  if (!isReady) {
    return null
  }

  return <>{children}</>
}

