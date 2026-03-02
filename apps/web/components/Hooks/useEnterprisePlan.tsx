import { usePlan } from '@components/Hooks/usePlan'
import { planMeetsRequirement } from '@services/plans/plans'

/**
 * Hook to check if the organization has an enterprise plan.
 * Used to gate enterprise-only features like SCORM import.
 */
function useEnterprisePlan() {
  const plan = usePlan()
  const isEnterprise = planMeetsRequirement(plan, 'enterprise')

  return {
    plan,
    isEnterprise,
  }
}

export default useEnterprisePlan
