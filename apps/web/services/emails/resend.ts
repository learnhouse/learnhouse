import 'server-only'
import { Resend } from 'resend'
import * as React from 'react'
import { isSaaSMode } from '@lib/saas'
import { LearnHouseEmail, type LearnHouseEmailProps } from '@components/Emails/LearnHouseEmail'

// Resend transactional email. Lazy singleton so a keyless build/deploy never
// throws at import time. `send()` renders the shared React Email template and is
// the single choke point every specific mail (welcome, purchase, plan change…)
// goes through — see services/billing/emails.ts for the typed wrappers.
//
// Disabled gracefully: with no RESEND_API_KEY, send() logs and resolves without
// throwing, so callers stay fire-and-forget and unconfigured deploys don't error.

let _resend: Resend | null = null

function resend(): Resend | null {
  if (_resend) return _resend
  const key = process.env.RESEND_API_KEY
  if (!key) return null
  _resend = new Resend(key)
  return _resend
}

/** Whether transactional email is configured. */
export function isEmailEnabled(): boolean {
  return Boolean(process.env.RESEND_API_KEY)
}

const DEFAULT_FROM =
  process.env.RESEND_FROM_EMAIL || 'LearnHouse <hello@emails.learnhouse.app>'

export interface SendResult {
  ok: boolean
  id?: string
  skipped?: boolean
}

/**
 * Render the shared template and send. Never throws — returns { ok, skipped }.
 * `skipped: true` means email is disabled (no key), not an error.
 */
export async function send(
  to: string | string[],
  subject: string,
  props: LearnHouseEmailProps,
  from: string = DEFAULT_FROM,
): Promise<SendResult> {
  // SaaS-only: transactional email never sends on OSS/self-hosted, even if a
  // RESEND_API_KEY happens to be present.
  if (!(await isSaaSMode())) {
    return { ok: false, skipped: true }
  }
  const client = resend()
  if (!client) {
    console.log(`[email] skipped (RESEND_API_KEY unset): "${subject}" -> ${Array.isArray(to) ? to.join(',') : to}`)
    return { ok: false, skipped: true }
  }
  try {
    const { data, error } = await client.emails.send({
      from,
      to: Array.isArray(to) ? to : [to],
      subject,
      react: React.createElement(LearnHouseEmail, props),
    })
    if (error) {
      console.error('[email] Resend error:', error)
      return { ok: false }
    }
    return { ok: true, id: data?.id }
  } catch (err) {
    console.error('[email] send failed:', err)
    return { ok: false }
  }
}

// Plan → accent color, shared by billing emails so the accent matches the app.
export const PLAN_COLORS: Record<string, string> = {
  free: '#737373',
  personal: '#3b82f6',
  'personal-family': '#3b82f6',
  standard: '#8b5cf6',
  pro: '#7c3aed',
  enterprise: '#171717',
}

export function planColor(plan?: string): string {
  return (plan && PLAN_COLORS[plan]) || '#171717'
}
