import { usePlan } from '@components/Hooks/usePlan'
import { useOrg } from '@components/Contexts/OrgContext'
import { planMeetsRequirement } from '@services/plans/plans'

/**
 * Hook to check if the organization has an enterprise plan.
 * Uses resolved_features from the API as source of truth.
 */
function useEnterprisePlan() {
  const plan = usePlan()
  const org = useOrg() as any
  const rf = org?.config?.config?.resolved_features
  // Check if any enterprise-gated feature is enabled, or fall back to plan check
  const isEnterprise = rf?.sso?.enabled === true || rf?.audit_logs?.enabled === true || rf?.scorm?.enabled === true || planMeetsRequirement(plan, 'enterprise')

  return {
    plan,
    isEnterprise,
  }
}

export default useEnterprisePlan
