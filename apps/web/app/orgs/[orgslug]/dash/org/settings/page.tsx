'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { DEFAULT_SETTINGS_TAB } from './settingsTabs'

// /dash/org/settings opens the first tab, Overview.
export default function OrgSettingsIndex() {
  const router = useRouter()
  useEffect(() => {
    router.replace(`/dash/org/settings/${DEFAULT_SETTINGS_TAB}${window.location.search}${window.location.hash}`)
  }, [router])
  return null
}
