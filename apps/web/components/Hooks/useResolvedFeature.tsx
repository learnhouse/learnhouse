import { useOrg } from '@components/Contexts/OrgContext'
import { usePlan } from '@components/Hooks/usePlan'
import { PlanLevel, planMeetsRequirement } from '@services/plans/plans'
import { FeatureKey } from '@services/features/featureMetadata'

export interface ResolvedFeatureState {
  /** Effective enabled flag from the backend (plan + overrides + admin toggles + packs). */
  enabled: boolean
  /** Minimum plan tier required by the backend. */
  requiredPlan: PlanLevel | null
  /** The current org plan. */
  currentPlan: PlanLevel
  /** True when the current plan meets the gate's minimum requirement. */
  meetsPlan: boolean
  /**
   * Why the gate blocks the user — undefined when the feature is granted.
   * `plan` = upgrade needed; `disabled` = plan is OK but feature is toggled off.
   */
  reason?: 'plan' | 'disabled'
}

/**
 * Centralized read of org.config.config.resolved_features for one feature.
 * Replaces ad-hoc `org?.config?.config?.resolved_features?.X` lookups.
 */
export function useResolvedFeature(feature: FeatureKey): ResolvedFeatureState {
  const currentPlan = usePlan()
  const org = useOrg() as any
  const rf = org?.config?.config?.resolved_features?.[feature]
  const requiredPlan = (rf?.required_plan ?? null) as PlanLevel | null
  const enabled = rf?.enabled !== false
  const meetsPlan = requiredPlan ? planMeetsRequirement(currentPlan, requiredPlan) : true

  let reason: 'plan' | 'disabled' | undefined
  if (!meetsPlan) reason = 'plan'
  else if (!enabled) reason = 'disabled'

  return { enabled, requiredPlan, currentPlan, meetsPlan, reason }
}
