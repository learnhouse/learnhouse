/**
 * Plan utilities for the frontend.
 *
 * All plan data (feature configs, limits, requirements) lives in the API.
 * The frontend reads `resolved_features` from the org config returned by the API.
 *
 * This file only provides:
 *   - PlanLevel type
 *   - Plan hierarchy for UI comparisons (plan badges, upgrade prompts)
 *   - Deployment mode helpers (OSS/EE bypass)
 *   - fetchPlanLimits() — fetches per-plan resource limits from the API
 */

import { getDeploymentMode, getServerAPIUrl } from '@services/config/config'

export type PlanLevel = 'free' | 'personal' | 'family' | 'standard' | 'pro' | 'enterprise' | 'oss'

// Plan hierarchy for SaaS mode (lower index = lower tier).
// 'oss' is kept as a display-only type value (not in hierarchy) for OSS mode label rendering.
export const PLAN_HIERARCHY: PlanLevel[] = ['free', 'personal', 'family', 'standard', 'pro', 'enterprise']

// Features blocked in OSS mode — require EE or SaaS/enterprise plan
const OSS_BLOCKED_FEATURES = new Set(['sso', 'audit_logs', 'payments', 'analytics_advanced', 'scorm'])

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
 * Check if a feature is available based on deployment mode.
 *
 * In SaaS mode, feature availability is determined by `resolved_features`
 * from the API — this function only handles mode-level bypass:
 * - OSS: EE-only features blocked, all others allowed
 * - EE: all features allowed
 * - SaaS: always returns true (callers should check resolved_features)
 */
export function isFeatureAvailable(featureKey: string, _currentPlan?: PlanLevel): boolean {
  const mode = getDeploymentMode()
  if (mode === 'oss') return !OSS_BLOCKED_FEATURES.has(featureKey)
  if (mode === 'ee') return true
  // SaaS: resolved_features from the API is the source of truth.
  // Return true here — callers gate on resolved_features separately.
  return true
}

// ---------------------------------------------------------------------------
// Plan limit types and fetching
// ---------------------------------------------------------------------------

export interface PlanLimitEntry {
  courses: number     // 0 = unlimited
  members: number     // 0 = unlimited
  admin_seats: number
  ai_credits: number  // 0 = no access, -1 = unlimited
}

// String keys — intentionally not PlanLevel. The API returns 'personal-family'
// while PlanLevel currently has 'family'; using string avoids that mismatch here.
export type PlanLimitsMap = Record<string, PlanLimitEntry>

// Safety-net fallback mirroring apps/api/src/security/features_utils/plans.py.
// Used only when the API is unreachable. ai_credits values come from
// AI_CREDIT_LIMITS (distinct from PLAN_FEATURE_CONFIGS["features"]["ai"]["limit"]).
const STATIC_PLAN_LIMITS: PlanLimitsMap = {
  free:              { courses: 1,   members: 10,   admin_seats: 1,   ai_credits: 0    },
  personal:          { courses: 0,   members: 1,    admin_seats: 1,   ai_credits: 500  },
  'personal-family': { courses: 0,   members: 4,    admin_seats: 4,   ai_credits: 3000 },
  standard:          { courses: 0,   members: 500,  admin_seats: 2,   ai_credits: 1000 },
  pro:               { courses: 0,   members: 1000, admin_seats: 10,  ai_credits: 3000 },
  enterprise:        { courses: 0,   members: 0,    admin_seats: 100, ai_credits: -1   },
}

/**
 * Fetch per-plan resource limits from the API.
 * Falls back to STATIC_PLAN_LIMITS when the API is unreachable so callers
 * never throw — the onboarding page stays functional regardless of backend
 * connectivity.
 *
 * Always called server-side (Next.js server action); uses getServerAPIUrl()
 * which always returns a full URL, never a relative path.
 */
export async function fetchPlanLimits(): Promise<PlanLimitsMap> {
  try {
    const response = await fetch(`${getServerAPIUrl()}plans`)
    if (!response.ok) throw new Error(`GET /api/v1/plans returned ${response.status}`)
    return response.json()
  } catch (err) {
    console.error('[plans] fetchPlanLimits failed, using static fallback:', err)
    return STATIC_PLAN_LIMITS
  }
}
