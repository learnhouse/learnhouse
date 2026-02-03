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
  seo: 'standard',
  versioning: 'standard',
  podcasts: 'standard',
  certifications: 'pro',
  roles: 'pro',
  api_tokens: 'pro',
  scorm: 'enterprise',
  audit_logs: 'enterprise',
  sso: 'enterprise',
}

// Plan-based resource limits (0 = unlimited)
// NOTE: These are fallback values. Always fetch from /orgs/{org_id}/usage API for accurate limits.
export const PLAN_LIMITS: Record<PlanLevel, Record<string, number>> = {
  free: {
    courses: 3,
    members: 30,
    admin_seats: 1,
  },
  standard: {
    courses: 0, // Unlimited
    members: 500,
    admin_seats: 2,
  },
  pro: {
    courses: 0, // Unlimited
    members: 2000,
    admin_seats: 10,
  },
  enterprise: {
    courses: 0, // Unlimited
    members: 0, // Unlimited
    admin_seats: 0, // Unlimited
  },
}

/**
 * Get the limit for a specific resource based on plan.
 *
 * @param plan - The organization's current plan
 * @param resource - The resource type (e.g., 'courses', 'members')
 * @returns The limit (0 means unlimited)
 */
export function getPlanLimit(plan: PlanLevel, resource: string): number {
  return PLAN_LIMITS[plan]?.[resource] ?? 0
}

/**
 * Check if the current usage is at or over the plan limit.
 *
 * @param plan - The organization's current plan
 * @param resource - The resource type
 * @param currentUsage - Current usage count
 * @returns True if limit is reached (creation should be blocked)
 */
export function isLimitReached(plan: PlanLevel, resource: string, currentUsage: number): boolean {
  const limit = getPlanLimit(plan, resource)
  if (limit === 0) return false // Unlimited
  return currentUsage >= limit
}

/**
 * Get remaining quota for a resource.
 *
 * @param plan - The organization's current plan
 * @param resource - The resource type
 * @param currentUsage - Current usage count
 * @returns Remaining count, or -1 for unlimited
 */
export function getRemainingQuota(plan: PlanLevel, resource: string, currentUsage: number): number {
  const limit = getPlanLimit(plan, resource)
  if (limit === 0) return -1 // Unlimited
  return Math.max(0, limit - currentUsage)
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
