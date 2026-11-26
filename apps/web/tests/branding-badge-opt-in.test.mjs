// The "Made with LearnHouse" badge: always on for free SaaS orgs, the admin's
// toggle below Pro, and off on Pro+ / EE unless the admin turns it on.

import { describe, expect, test } from 'bun:test'

const { showLearnHouseBranding } = await import('../lib/branding.ts')

const v2 = (general) => ({ config: { config: { config_version: '2.0', customization: { general } } } })
const v1 = (general) => ({ config: { config: { general } } })

describe('showLearnHouseBranding', () => {
  test('free SaaS orgs always show it', () => {
    expect(showLearnHouseBranding(v2({ watermark: false }), 'free', 'saas')).toBe(true)
    expect(showLearnHouseBranding({}, 'free', 'saas')).toBe(true)
  })

  test('standard follows the toggle, default on', () => {
    expect(showLearnHouseBranding(v2({}), 'standard', 'saas')).toBe(true)
    expect(showLearnHouseBranding(v2({ watermark: false }), 'standard', 'saas')).toBe(false)
    expect(showLearnHouseBranding(v1({ watermark: false }), 'standard', 'saas')).toBe(false)
  })

  test('pro and business hide it by default, even with the stored default watermark', () => {
    for (const plan of ['pro', 'business', 'enterprise']) {
      expect(showLearnHouseBranding(v2({}), plan, 'saas')).toBe(false)
      expect(showLearnHouseBranding(v2({ watermark: true }), plan, 'saas')).toBe(false)
    }
  })

  test('pro and business show it once the admin opts in', () => {
    for (const plan of ['pro', 'business', 'enterprise']) {
      expect(showLearnHouseBranding(v2({ watermark: true, watermark_opt_in: true }), plan, 'saas')).toBe(true)
      expect(showLearnHouseBranding(v1({ watermark: true, watermark_opt_in: true }), plan, 'saas')).toBe(true)
      expect(showLearnHouseBranding(v2({ watermark: false, watermark_opt_in: false }), plan, 'saas')).toBe(false)
    }
  })

  test('EE installs can opt in too', () => {
    expect(showLearnHouseBranding(v2({}), 'enterprise', 'ee')).toBe(false)
    expect(showLearnHouseBranding(v2({ watermark: true, watermark_opt_in: true }), 'enterprise', 'ee')).toBe(true)
  })

  test('OSS keeps the toggle', () => {
    expect(showLearnHouseBranding(v2({}), 'oss', 'oss')).toBe(true)
    expect(showLearnHouseBranding(v2({ watermark: false }), 'oss', 'oss')).toBe(false)
  })
})
