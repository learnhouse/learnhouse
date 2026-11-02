'use client'
import { useOrg } from '@components/Contexts/OrgContext'
import { getDeploymentMode } from '@services/config/config'
import { planMeetsRequirement, type PlanLevel } from '@services/plans/plans'
import { usePlan } from '@components/Hooks/usePlan'

/**
 * Pro and above are white-labelled: no LearnHouse marks anywhere the org's
 * learners or staff can see them. EE is white-label by license.
 */
export function isWhiteLabelPlan(plan: PlanLevel): boolean {
  if (getDeploymentMode() === 'ee') return true
  return plan !== 'oss' && planMeetsRequirement(plan, 'pro')
}

/**
 * Whether LearnHouse branding (logo marks, "made with" badges) should render
 * for the current org.
 *
 *   1. EE / Pro+  → hidden.
 *   2. SaaS free  → always shown.
 *   3. Otherwise  → the admin's watermark toggle (default on).
 */
export function useShowLearnHouseBranding(): boolean {
  const org = useOrg() as any
  const plan = usePlan()
  if (isWhiteLabelPlan(plan)) return false
  if (plan === 'free') return true
  const watermark =
    org?.config?.config?.customization?.general?.watermark ??
    org?.config?.config?.general?.watermark
  return watermark !== false
}
