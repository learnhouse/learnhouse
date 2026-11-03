/**
 * Why a feature gate blocks, as a pure function.
 *
 * Kept out of the hook so the rules can be tested directly and so a surface
 * that hosts the toggle for its own feature can opt out of the `disabled`
 * branch without duplicating the plan logic.
 */

import { PlanLevel, planMeetsRequirement } from '../../services/plans/plans'

export type GateReason = 'plan' | 'disabled'

/** Who turned an available feature off: the org itself, or the platform (superadmin). */
export type DisabledBy = 'org' | 'platform'

export interface ResolvedFeaturePayload {
  enabled?: boolean
  /** In the org's plan (or comp-granted). False means an upgrade is needed. */
  available?: boolean
  limit?: number
  required_plan?: string | null
  /** Cheapest plan that includes the feature, when it is not available. */
  upgrade_plan?: string | null
  disabled_by?: DisabledBy | null
}

export interface GateReasonInput {
  /** org.config.config.resolved_features[feature], or undefined/null when absent. */
  resolved?: ResolvedFeaturePayload | null
  /** FEATURE_METADATA[feature].upsellPlan, the catalog fallback. */
  catalogPlan?: string | null
  /** Current org plan from usePlan(). */
  currentPlan: PlanLevel
  /** False while the org (and therefore resolved_features) has not loaded yet. */
  orgLoaded?: boolean
  /**
   * Opt-in escape hatch for a surface that HOSTS the toggle controlling this
   * very feature. Suppresses ONLY the 'disabled' reason. Never suppresses 'plan'.
   */
  allowWhenDisabled?: boolean
}

export interface GateReasonResult {
  /** Effective enabled flag from the backend (plan + overrides + admin toggles + packs). */
  enabled: boolean
  /**
   * Plan tier that unlocks the feature. When the backend reports it, this is
   * the plan that actually includes it (upgrade_plan), not the nominal tier.
   */
  requiredPlan: PlanLevel | null
  /** True when the current plan meets the gate's minimum requirement. */
  meetsPlan: boolean
  /** True while the org config has not arrived yet; nothing is decided. */
  loading: boolean
  /**
   * Why the gate blocks the user, or undefined when the feature is granted.
   * `plan` = upgrade needed; `disabled` = plan is OK but feature is toggled off.
   */
  reason?: GateReason
  /** Set with reason 'disabled' when the backend says who turned it off. */
  disabledBy?: DisabledBy
}

export function resolveGateReason(input: GateReasonInput): GateReasonResult {
  const { resolved, catalogPlan, currentPlan, orgLoaded, allowWhenDisabled } = input
  const loading = orgLoaded === false

  // Plan requirement: prefer the backend's resolved value, but FALL BACK to the
  // authoritative feature catalog (FEATURE_METADATA.upsellPlan) when the backend
  // omits this feature or uses a mismatched key. This guarantees every catalog
  // feature gates by its declared tier even if `resolved_features` is incomplete
  // (e.g. custom_domains / seo / webhooks / api_access were missing server-side),
  // and new catalog features auto-gate without a backend change. The fallback is
  // held back while the org is loading: an org that owns the feature has no
  // resolved value yet, and applying the catalog tier there flashes an upgrade
  // card (and reports an upgrade impression) for a feature it already pays for.
  const catalogRequired =
    catalogPlan && catalogPlan !== 'free' && catalogPlan !== 'oss'
      ? (catalogPlan as PlanLevel)
      : null
  const enabled = resolved?.enabled !== false

  // `available` is the backend's direct answer to "is this in the plan". The
  // nominal tier comparison below cannot answer it: plans are not strictly
  // nested (boards are in Personal but not Standard), so a Standard org "meets"
  // the Personal requirement and a locked feature would read as switched off.
  let requiredPlan: PlanLevel | null
  let meetsPlan: boolean
  if (typeof resolved?.available === 'boolean') {
    meetsPlan = resolved.available
    requiredPlan = (meetsPlan
      ? resolved.required_plan ?? null
      : resolved.upgrade_plan ?? resolved.required_plan ?? catalogRequired) as PlanLevel | null
  } else {
    requiredPlan = (resolved?.required_plan ?? (loading ? null : catalogRequired)) as PlanLevel | null
    meetsPlan = requiredPlan ? planMeetsRequirement(currentPlan, requiredPlan) : true
  }

  let reason: GateReason | undefined
  if (!meetsPlan) reason = 'plan'
  else if (!enabled && !allowWhenDisabled) reason = 'disabled'

  const disabledBy = reason === 'disabled' ? resolved?.disabled_by ?? undefined : undefined

  return { enabled, requiredPlan, meetsPlan, loading, reason, disabledBy }
}
