import { isWhiteLabelPlan, type PlanLevel } from '@services/plans/plans'

type GeneralConfig = { watermark?: boolean; watermark_opt_in?: boolean } | undefined

function readGeneral(org: any, key: keyof NonNullable<GeneralConfig>): boolean | undefined {
  const v2: GeneralConfig = org?.config?.config?.customization?.general
  const v1: GeneralConfig = org?.config?.config?.general
  return v2?.[key] ?? v1?.[key]
}

/**
 * Whether LearnHouse branding (logo marks, "made with" badges) should render
 * for the current org.
 *
 *   1. EE / Pro+  → hidden unless the admin turned the badge on.
 *   2. SaaS free  → always shown.
 *   3. Otherwise  → the admin's watermark toggle (default on).
 */
export function showLearnHouseBranding(org: any, plan: PlanLevel, mode?: string): boolean {
  if (isWhiteLabelPlan(plan, mode)) {
    return readGeneral(org, 'watermark_opt_in') === true && readGeneral(org, 'watermark') !== false
  }
  if (plan === 'free') return true
  return readGeneral(org, 'watermark') !== false
}

