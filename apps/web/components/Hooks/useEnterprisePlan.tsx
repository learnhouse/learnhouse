import { useOrg } from '@components/Contexts/OrgContext'

/**
 * Hook to check if the organization has an enterprise plan.
 * Used to gate enterprise-only features like SCORM import.
 */
function useEnterprisePlan() {
  const org = useOrg() as any

  const plan = org?.config?.config?.cloud?.plan || 'free'
  const isEnterprise = plan === 'enterprise'

  return {
    plan,
    isEnterprise,
  }
}

export default useEnterprisePlan
