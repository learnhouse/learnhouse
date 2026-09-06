import { useOrg } from '@components/Contexts/OrgContext'
import { usePlan } from '@components/Hooks/usePlan'
import { PlanLevel } from '@services/plans/plans'
import { FeatureKey, getFeatureMeta } from '@services/features/featureMetadata'
import { GateReason, resolveGateReason } from '@lib/features/gateReason'

export interface ResolvedFeatureState {
  /** Effective enabled flag from the backend (plan + overrides + admin toggles + packs). */
  enabled: boolean
  /** Minimum plan tier required by the backend. */
  requiredPlan: PlanLevel | null
  /** The current org plan. */
  currentPlan: PlanLevel
  /** True when the current plan meets the gate's minimum requirement. */
  meetsPlan: boolean
  /** True while the org config has not arrived yet — nothing is decided. */
  loading: boolean
  /**
   * Why the gate blocks the user — undefined when the feature is granted.
   * `plan` = upgrade needed; `disabled` = plan is OK but feature is toggled off.
   */
  reason?: GateReason
}

export interface UseResolvedFeatureOptions {
  /**
   * For a surface that HOSTS the toggle controlling this very feature: keep it
   * rendered while the feature is off, so the switch that turns it back on
   * stays reachable. Plan gating still applies.
   */
  allowWhenDisabled?: boolean
}

/**
 * Centralized read of org.config.config.resolved_features for one feature.
 * Replaces ad-hoc `org?.config?.config?.resolved_features?.X` lookups.
 */
export function useResolvedFeature(
  feature: FeatureKey,
  options?: UseResolvedFeatureOptions
): ResolvedFeatureState {
  const currentPlan = usePlan()
  const org = useOrg() as any

  const gate = resolveGateReason({
    resolved: org?.config?.config?.resolved_features?.[feature],
    catalogPlan: getFeatureMeta(feature)?.upsellPlan,
    currentPlan,
    orgLoaded: Boolean(org),
    allowWhenDisabled: options?.allowWhenDisabled,
  })

  return { ...gate, currentPlan }
}
