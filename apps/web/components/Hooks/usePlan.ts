'use client'
import { useOrg } from '@components/Contexts/OrgContext'
import { getDeploymentMode } from '@services/config/config'
import type { PlanLevel } from '@services/plans/plans'

/**
 * Single source of truth for the current org's effective plan.
 *
 * - Returns 'oss' in OSS mode (display label, not used in plan hierarchy checks)
 * - Returns 'enterprise' in EE mode (all features unlocked)
 * - Returns the DB plan in SaaS mode
 */
export function usePlan(): PlanLevel {
  const org = useOrg() as any
  const mode = getDeploymentMode()
  if (mode === 'oss') return 'oss'
  if (mode === 'ee') return 'enterprise'
  return (org?.config?.config?.cloud?.plan || 'free') as PlanLevel
}
