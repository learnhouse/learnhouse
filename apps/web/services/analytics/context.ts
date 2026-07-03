'use client'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useOrg, useOrgMembership } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { usePlan } from '@components/Hooks/usePlan'
import { getDeploymentMode } from '@services/config/config'

/**
 * Standard properties auto-attached to EVERY analytics event. Call-sites must
 * never pass these — they're injected by useLHAnalytics from app context.
 *
 * All hooks used here are provider-safe (useOrg/useOrgMembership/usePlan return
 * defaults when their provider is absent), so this works on any surface,
 * including public/unauthenticated pages.
 */
export interface StandardProps {
  org_id?: number
  org_slug?: string
  plan: string
  deployment_mode: string
  surface?: string
  viewport: 'mobile' | 'tablet' | 'desktop'
  is_authenticated: boolean
  is_org_member: boolean
  user_role: string
  interface_language: string
  app_version: string
  [key: string]: unknown
}

function getViewport(): 'mobile' | 'tablet' | 'desktop' {
  if (typeof window === 'undefined') return 'desktop'
  const w = window.innerWidth
  if (w < 640) return 'mobile'
  if (w < 1024) return 'tablet'
  return 'desktop'
}

function highestRole(session: any, orgId?: number): string {
  const user = session?.data?.user
  if (user?.is_superadmin) return 'superadmin'
  const roles = session?.data?.roles
  if (Array.isArray(roles)) {
    const forOrg = orgId ? roles.find((r: any) => r?.org?.id === orgId) : roles[0]
    const roleName = forOrg?.role?.name ?? forOrg?.role
    if (roleName) return String(roleName)
  }
  return session?.status === 'authenticated' ? 'member' : 'guest'
}

export function useStandardProps(surface?: string): StandardProps {
  const org = useOrg() as any
  const { isUserPartOfTheOrg } = useOrgMembership()
  const session = useLHSession() as any
  const plan = usePlan()
  const { i18n } = useTranslation()

  const isAuthenticated = session?.status === 'authenticated'
  const orgId = org?.id as number | undefined

  return useMemo<StandardProps>(
    () => ({
      org_id: orgId,
      org_slug: org?.slug,
      plan,
      deployment_mode: getDeploymentMode(),
      surface,
      viewport: getViewport(),
      is_authenticated: isAuthenticated,
      is_org_member: isAuthenticated ? isUserPartOfTheOrg : false,
      user_role: highestRole(session, orgId),
      interface_language: i18n?.language || 'en',
      app_version: process.env.NEXT_PUBLIC_BUILD_ID || process.env.BUILD_ID || 'dev',
    }),
    // session object identity changes on every auth update; depend on stable bits
    [orgId, org?.slug, plan, surface, isAuthenticated, isUserPartOfTheOrg, i18n?.language, session?.data?.user?.user_uuid],
  )
}
