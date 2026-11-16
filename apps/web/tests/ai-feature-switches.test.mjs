// Settings > AI: reading the org's per-feature AI switches (resolved by the
// API or from older stored toggles), the groups shown per edition, Ask AI for
// staff only, the monthly cap input and AI error codes.

import { describe, expect, test } from 'bun:test'
import {
  AI_EE_FEATURES,
  AI_FEATURE_GROUPS,
  AI_FEATURE_KEYS,
  AI_GROUP_ORDER,
  aiErrorCode,
  askAIAvailable,
  groupCount,
  parseCreditCap,
  readAISettings,
  visibleFeatures,
} from '../lib/ai/aiFeatures.ts'

const v2 = (ai, resolvedAI) => ({
  config_version: '2.0',
  admin_toggles: ai === undefined ? {} : { ai },
  resolved_features: resolvedAI === undefined ? undefined : { ai: resolvedAI },
})

describe('catalog', () => {
  test('mirrors the API groups (23 switches, 5 groups)', () => {
    expect(AI_GROUP_ORDER).toEqual(['assistants', 'authoring', 'learners', 'content', 'integrations'])
    expect(AI_FEATURE_KEYS.length).toBe(23)
    expect(new Set(AI_FEATURE_KEYS).size).toBe(23)
    for (const key of AI_EE_FEATURES) expect(AI_FEATURE_KEYS).toContain(key)
  })
  test('OSS hides the enterprise-only surfaces', () => {
    expect(visibleFeatures('assistants', 'oss')).toEqual([])
    expect(visibleFeatures('assistants', 'ee')).toEqual([...AI_FEATURE_GROUPS.assistants])
    expect(visibleFeatures('learners', 'oss')).toEqual(['ask_ai', 'ai_grading', 'messaging_agents'])
    expect(visibleFeatures('content', 'saas')).toContain('boards')
  })
})

describe('readAISettings', () => {
  test('defaults: everything on', () => {
    const s = readAISettings(v2())
    expect(s.enabled).toBe(true)
    expect(Object.values(s.features).every(Boolean)).toBe(true)
    expect(s.ask_ai_staff_only).toBe(false)
    expect(s.monthly_credit_cap).toBe(0)
    expect(readAISettings(null).enabled).toBe(true)
  })

  test('the public org payload (effective booleans only)', () => {
    const s = readAISettings({ resolved_ai: { enabled: true, features: { atlas: false }, ask_ai_staff_only: true } })
    expect(s.features.atlas).toBe(false)
    expect(s.features.voice).toBe(true)
    expect(s.switches.atlas).toBe(false)
    expect(s.ask_ai_staff_only).toBe(true)
    expect(s.disabled_by).toBe(null)
  })

  test('the admin route body (switches kept while the master is off)', () => {
    const s = readAISettings({
      resolved_ai: {
        enabled: false,
        disabled_by: 'org',
        switches: { voice: false },
        features: { voice: false },
        monthly_credit_cap: 500,
      },
    })
    expect(s.enabled).toBe(false)
    expect(s.switches.atlas).toBe(true)
    expect(s.switches.voice).toBe(false)
    expect(Object.values(s.features).some(Boolean)).toBe(false)
    expect(s.monthly_credit_cap).toBe(500)
    expect(s.disabled_by).toBe('org')
  })

  test('older payloads read the stored toggles', () => {
    expect(readAISettings(v2({ org_disabled: true })).enabled).toBe(false)
    expect(readAISettings(v2({ disabled: true })).enabled).toBe(false)
    expect(readAISettings(v2({}, { enabled: false, available: false, disabled_by: null })).available).toBe(false)
    const s = readAISettings(v2({ copilot_enabled: false, features: { seo: false }, ask_ai_staff_only: true, monthly_credit_cap: '12' }))
    expect(s.switches.ask_ai).toBe(false)
    expect(s.features.seo).toBe(false)
    expect(s.ask_ai_staff_only).toBe(true)
    expect(s.monthly_credit_cap).toBe(12)
    const v1 = readAISettings({ config_version: '1.0', features: { ai: { enabled: false } } })
    expect(v1.enabled).toBe(false)
    expect(readAISettings({ config_version: '1.0', features: {} }).enabled).toBe(true)
  })
})

describe('helpers', () => {
  test('groupCount counts the shown switches that are on', () => {
    const s = readAISettings(v2({ features: { atlas: false } }))
    expect(groupCount(s, visibleFeatures('assistants', 'ee'))).toEqual({ on: 2, total: 3 })
  })

  test('askAIAvailable honours the staff-only setting', () => {
    const open = readAISettings(v2())
    const staffOnly = readAISettings(v2({ ask_ai_staff_only: true }))
    const off = readAISettings(v2({ features: { ask_ai: false } }))
    expect(askAIAvailable(open, false)).toBe(true)
    expect(askAIAvailable(staffOnly, false)).toBe(false)
    expect(askAIAvailable(staffOnly, null)).toBe(false)
    expect(askAIAvailable(staffOnly, true)).toBe(true)
    expect(askAIAvailable(off, true)).toBe(false)
    expect(askAIAvailable(null, true)).toBe(false)
  })

  test('parseCreditCap', () => {
    expect(parseCreditCap('')).toBe(0)
    expect(parseCreditCap('  250 ')).toBe(250)
    expect(parseCreditCap('2.5')).toBe(null)
    expect(parseCreditCap('-1')).toBe(null)
    expect(parseCreditCap('abc')).toBe(null)
    expect(parseCreditCap('10000001')).toBe(null)
  })

  test('aiErrorCode reads the 403 body', () => {
    expect(aiErrorCode({ detail: { code: 'AI_FEATURE_DISABLED', feature: 'atlas' } })).toBe('AI_FEATURE_DISABLED')
    expect(aiErrorCode({ detail: 'AI is not enabled' })).toBe(null)
    expect(aiErrorCode({ detail: { code: 'OTHER' } })).toBe(null)
    expect(aiErrorCode(null)).toBe(null)
  })
})
