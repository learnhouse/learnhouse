/**
 * Plan-based feature restriction utilities for the frontend.
 *
 * Mirrors the backend plan hierarchy and provides utilities for
 * checking feature availability based on organization plan.
 *
 * Single source of truth:
 *   - Plan access    → DB plan (hierarchy below)
 *   - Deployment mode → learnhouse_mode cookie (set by proxy from backend /instance/info)
 *     'saas': plan-based gating | 'ee': all features | 'oss': EE features blocked
 */

import { getDeploymentMode } from '@services/config/config'

export type PlanLevel = 'free' | 'personal' | 'family' | 'standard' | 'pro' | 'enterprise' | 'oss'

// Plan hierarchy for SaaS mode (lower index = lower tier).
// 'oss' is kept as a display-only type value (not in hierarchy) for OSS mode label rendering.
export const PLAN_HIERARCHY: PlanLevel[] = ['free', 'personal', 'family', 'standard', 'pro', 'enterprise']

// Features blocked in OSS mode — require EE or SaaS/enterprise plan
const OSS_BLOCKED_FEATURES = new Set(['sso', 'audit_logs', 'payments', 'analytics_advanced', 'scorm'])

// Feature to required plan mapping
export const FEATURE_PLAN_REQUIREMENTS: Record<string, PlanLevel> = {
  usergroups: 'personal',
  ai: 'personal',
  boards: 'personal',
  playgrounds: 'pro',
  payments: 'standard',
  communities: 'standard',
  seo: 'standard',
  versioning: 'standard',
  podcasts: 'standard',
  custom_domains: 'pro',
  analytics: 'standard',
  certifications: 'pro',
  docs: 'pro',
  roles: 'pro',
  api_tokens: 'pro',
  analytics_advanced: 'enterprise',
  course_analytics: 'pro',
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
  personal: {
    courses: 0, // Unlimited
    members: 1,
    admin_seats: 1,
  },
  family: {
    courses: 0, // Unlimited
    members: 4,
    admin_seats: 4,
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
  // 'oss' is a display-only plan value — limits are always unlimited in OSS mode
  oss: {
    courses: 0, // Unlimited
    members: 0, // Unlimited
    admin_seats: 0, // Unlimited
  },
}

/**
 * Get the limit for a specific resource based on plan.
 */
export function getPlanLimit(plan: PlanLevel, resource: string): number {
  return PLAN_LIMITS[plan]?.[resource] ?? 0
}

/**
 * Check if the current usage is at or over the plan limit.
 * Uses the DB plan only — no env var bypass.
 */
export function isLimitReached(plan: PlanLevel, resource: string, currentUsage: number): boolean {
  const limit = getPlanLimit(plan, resource)
  if (limit === 0) return false // 0 = unlimited (includes 'oss' and 'enterprise' plans)
  return currentUsage >= limit
}

/**
 * Get remaining quota for a resource.
 */
export function getRemainingQuota(plan: PlanLevel, resource: string, currentUsage: number): number {
  const limit = getPlanLimit(plan, resource)
  if (limit === 0) return -1 // Unlimited
  return Math.max(0, limit - currentUsage)
}

/**
 * Check if the current plan meets or exceeds the required plan level.
 * Only used in SaaS mode — EE/OSS bypass is handled in isFeatureAvailable().
 */
export function planMeetsRequirement(
  currentPlan: PlanLevel,
  requiredPlan: PlanLevel
): boolean {
  if (currentPlan === 'oss') return requiredPlan !== 'enterprise'
  const currentIndex = PLAN_HIERARCHY.indexOf(currentPlan)
  const requiredIndex = PLAN_HIERARCHY.indexOf(requiredPlan)
  return currentIndex >= requiredIndex
}

/**
 * Get the required plan level for a specific feature.
 */
export function getRequiredPlanForFeature(featureKey: string): PlanLevel | undefined {
  return FEATURE_PLAN_REQUIREMENTS[featureKey]
}

/**
 * Check if a feature is available for the given plan.
 *
 * Uses 3-mode logic:
 * - OSS: EE-only features blocked, all others allowed
 * - EE: all features allowed
 * - SaaS: normal plan hierarchy check
 */
export function isFeatureAvailable(featureKey: string, currentPlan: PlanLevel): boolean {
  const mode = getDeploymentMode()
  if (mode === 'oss') return !OSS_BLOCKED_FEATURES.has(featureKey)
  if (mode === 'ee') return true
  // SaaS: normal plan check
  const required = getRequiredPlanForFeature(featureKey)
  if (!required) return true
  return planMeetsRequirement(currentPlan, required)
}
