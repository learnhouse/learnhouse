/**
 * Plan-based feature restriction utilities for the frontend.
 *
 * Mirrors the backend plan hierarchy and provides utilities for
 * checking feature availability based on organization plan.
 */

export type PlanLevel = 'free' | 'standard' | 'pro' | 'enterprise'

// Plan hierarchy (lower index = lower tier)
export const PLAN_HIERARCHY: PlanLevel[] = ['free', 'standard', 'pro', 'enterprise']

// Feature to required plan mapping
export const FEATURE_PLAN_REQUIREMENTS: Record<string, PlanLevel> = {
  usergroups: 'standard',
  payments: 'standard',
  ai: 'standard',
  communities: 'standard',
  certifications: 'pro',
  roles: 'pro',
  api_tokens: 'pro',
  scorm: 'enterprise',
  audit_logs: 'enterprise',
}

/**
 * Check if the current plan meets or exceeds the required plan level.
 *
 * @param currentPlan - The organization's current plan
 * @param requiredPlan - The minimum required plan for the feature
 * @returns True if currentPlan >= requiredPlan in the hierarchy
 */
export function planMeetsRequirement(
  currentPlan: PlanLevel,
  requiredPlan: PlanLevel
): boolean {
  const currentIndex = PLAN_HIERARCHY.indexOf(currentPlan)
  const requiredIndex = PLAN_HIERARCHY.indexOf(requiredPlan)
  return currentIndex >= requiredIndex
}

/**
 * Get the required plan level for a specific feature.
 *
 * @param featureKey - The feature identifier (e.g., 'api_tokens', 'audit_logs')
 * @returns The required plan level, or undefined if no restriction
 */
export function getRequiredPlanForFeature(featureKey: string): PlanLevel | undefined {
  return FEATURE_PLAN_REQUIREMENTS[featureKey]
}

/**
 * Check if a feature is available for the given plan.
 *
 * @param featureKey - The feature identifier
 * @param currentPlan - The organization's current plan
 * @returns True if the feature is available, false otherwise
 */
export function isFeatureAvailable(featureKey: string, currentPlan: PlanLevel): boolean {
  const requiredPlan = getRequiredPlanForFeature(featureKey)
  if (!requiredPlan) {
    // No restriction, feature is available to all plans
    return true
  }
  return planMeetsRequirement(currentPlan, requiredPlan)
}
