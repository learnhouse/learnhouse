'use client'
import { useMemo } from 'react'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { isFeatureAvailable } from '@services/plans/plans'
import { sitePages } from './registry'
import type { SitePageMeta } from './types'

/**
 * The registry filtered down to what this visitor can actually open: the
 * org's enabled features, its menu configuration (a builtin the org hid from
 * its menu is hidden here too) and whether the visitor is signed in.
 */
export function useSitePages(): SitePageMeta[] {
  const org = useOrg() as any
  const session = useLHSession() as any
  const config = org?.config?.config
  const resolvedFeatures = config?.resolved_features
  const menuItems: any[] | undefined =
    config?.customization?.menu?.items ?? config?.general?.menu?.items
  const copilotEnabled = config?.admin_toggles?.ai?.copilot_enabled !== false
  const isAuthenticated = session?.status === 'authenticated'

  return useMemo(() => {
    const featureEnabled = (key: string) => {
      const rf = resolvedFeatures?.[key]
      if (rf) return rf.enabled === true
      return isFeatureAvailable(key)
    }
    const hiddenInMenu = (type: string) =>
      Array.isArray(menuItems) &&
      menuItems.some((item) => item?.type === type && item?.enabled === false)

    return sitePages.filter((page) => {
      if (page.requiresAuth && !isAuthenticated) return false
      if (page.featureKey && !featureEnabled(page.featureKey)) return false
      if (page.menuType && hiddenInMenu(page.menuType)) return false
      if (page.requiresCopilot && !copilotEnabled) return false
      return true
    })
  }, [resolvedFeatures, menuItems, copilotEnabled, isAuthenticated])
}
