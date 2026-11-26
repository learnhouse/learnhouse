'use client'
import { useOrg } from '@components/Contexts/OrgContext'
import { isWhiteLabelPlan } from '@services/plans/plans'
import { usePlan } from '@components/Hooks/usePlan'
import { showLearnHouseBranding } from '@/lib/branding'

export { isWhiteLabelPlan, showLearnHouseBranding }

export function useShowLearnHouseBranding(): boolean {
  const org = useOrg() as any
  const plan = usePlan()
  return showLearnHouseBranding(org, plan)
}
