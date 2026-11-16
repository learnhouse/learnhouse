// The SaaS free trial: every new organization runs on TRIAL_PLAN for
// TRIAL_DAYS, no card needed (apps/api/src/services/plans/trial.py is the
// source; tests/plans-trial.test.ts checks these mirror it). Self-hosted
// installs have no trial; the API answers `{ trial: null }` there.
import { getAPIUrl } from '@services/config/config'
import { apiFetch } from '@services/utils/ts/requests'

export const TRIAL_PLAN = 'pro'
export const TRIAL_DAYS = 14

export type TrialStatus = 'active' | 'converted' | 'expired' | 'ended'

export interface OrgTrial {
  plan: string
  status: TrialStatus
  active: boolean
  started_at: string
  ends_at: string
  days_left: number
  length_days: number
  ended_at: string | null
  converted_plan: string | null
}

export function getOrgTrial(orgId: number | string, token: string): Promise<{ trial: OrgTrial | null }> {
  return apiFetch(`${getAPIUrl()}orgs/${orgId}/trial`, token)
}

/** How far through the trial we are (0-100), for a progress bar. */
export function trialProgress(trial: Pick<OrgTrial, 'started_at' | 'ends_at'>, now: number = Date.now()): number {
  const start = Date.parse(trial.started_at)
  const end = Date.parse(trial.ends_at)
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return 0
  return Math.max(0, Math.min(100, Math.round(((now - start) / (end - start)) * 100)))
}
