import { useOrg } from '@components/Contexts/OrgContext'
import { usePlan } from '@components/Hooks/usePlan'
import { PlanLevel, planMeetsRequirement } from '@services/plans/plans'
import { FeatureKey, getFeatureMeta } from '@services/features/featureMetadata'

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

  // Plan requirement: prefer the backend's resolved value, but FALL BACK to the
  // authoritative feature catalog (FEATURE_METADATA.upsellPlan) when the backend
  // omits this feature or uses a mismatched key. This guarantees every catalog
  // feature gates by its declared tier even if `resolved_features` is incomplete
  // (e.g. custom_domains / seo / webhooks / api_access were missing server-side),
  // and new catalog features auto-gate without a backend change.
  const catalogPlan = getFeatureMeta(feature)?.upsellPlan
  const catalogRequired =
    catalogPlan && catalogPlan !== 'free' && catalogPlan !== 'oss'
      ? (catalogPlan as PlanLevel)
      : null
  const requiredPlan = (rf?.required_plan ?? catalogRequired) as PlanLevel | null
  const enabled = rf?.enabled !== false
  const meetsPlan = requiredPlan ? planMeetsRequirement(currentPlan, requiredPlan) : true

  let reason: 'plan' | 'disabled' | undefined
  if (!meetsPlan) reason = 'plan'
  else if (!enabled) reason = 'disabled'

  return { enabled, requiredPlan, currentPlan, meetsPlan, reason }
}
