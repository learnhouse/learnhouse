// One switch per AI surface, set by org admins in Settings > AI. Mirrors
// apps/api/src/security/features_utils/ai_features.py (AI_FEATURES): the API
// enforces every switch, the web only hides what is off.

export const AI_FEATURE_GROUPS = {
  assistants: ['atlas', 'atlas_scheduled', 'ai_editor'],
  authoring: ['course_builder', 'editor_ai', 'magic_blocks', 'quiz_generation', 'assignment_generation', 'course_import', 'seo'],
  learners: ['ask_ai', 'ai_grading', 'messaging_agents', 'plays'],
  content: ['translations', 'image_generation', 'voice', 'video_ai', 'live_session_summary', 'boards'],
  integrations: ['landing_builder', 'newsletter', 'mcp_tools'],
} as const

export type AIFeatureGroup = keyof typeof AI_FEATURE_GROUPS
export type AIFeatureKey = (typeof AI_FEATURE_GROUPS)[AIFeatureGroup][number]

export const AI_GROUP_ORDER: AIFeatureGroup[] = ['assistants', 'authoring', 'learners', 'content', 'integrations']
export const AI_FEATURE_KEYS: AIFeatureKey[] = AI_GROUP_ORDER.flatMap((g) => [...AI_FEATURE_GROUPS[g]])

/** Surfaces that only exist with the enterprise code (EE and SaaS). */
export const AI_EE_FEATURES: ReadonlySet<AIFeatureKey> = new Set<AIFeatureKey>([
  'atlas',
  'atlas_scheduled',
  'ai_editor',
  'plays',
  'live_session_summary',
  'boards',
  'newsletter',
])

export const MAX_MONTHLY_CREDIT_CAP = 10_000_000

export interface AISettings {
  enabled: boolean
  available: boolean
  disabled_by: 'org' | 'platform' | null
  /** What the admin chose, kept while the master switch is off. */
  switches: Record<AIFeatureKey, boolean>
  /** Effective state: master switch applied. */
  features: Record<AIFeatureKey, boolean>
  ask_ai_staff_only: boolean
  monthly_credit_cap: number
}

function obj(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : {}
}

function allKeys(value: (_key: AIFeatureKey) => boolean): Record<AIFeatureKey, boolean> {
  return Object.fromEntries(AI_FEATURE_KEYS.map((k) => [k, value(k)])) as Record<AIFeatureKey, boolean>
}

/**
 * The org's AI settings from its config. Prefers the API's resolved copy
 * (config.resolved_ai, or the admin settings route's body); an older payload
 * without it is read from the stored toggles, where a missing switch means on.
 */
export function readAISettings(config: unknown): AISettings {
  const cfg = obj(config)
  const resolved = obj(cfg.resolved_ai)
  if (resolved.features) {
    // The org payload carries only the effective booleans; the admin-only
    // settings route adds switches, disabled_by and the monthly cap.
    const chosen = obj(resolved.switches ?? resolved.features)
    return {
      enabled: Boolean(resolved.enabled),
      available: resolved.available !== false,
      disabled_by: resolved.disabled_by ?? null,
      switches: allKeys((k) => chosen[k] !== false),
      features: allKeys((k) => Boolean(resolved.enabled) && resolved.features[k] !== false),
      ask_ai_staff_only: Boolean(resolved.ask_ai_staff_only),
      monthly_credit_cap: Number(resolved.monthly_credit_cap) || 0,
    }
  }

  const isV2 = String(cfg.config_version || '').startsWith('2')
  const toggle = isV2 ? obj(obj(cfg.admin_toggles).ai) : obj(obj(cfg.features).ai)
  const master = obj(obj(cfg.resolved_features).ai)
  const enabled =
    master.enabled !== undefined
      ? Boolean(master.enabled)
      : isV2
        ? !toggle.disabled && !toggle.org_disabled
        : toggle.enabled !== false
  const raw = obj(toggle.features)
  const switches = allKeys((k) => raw[k] !== false)
  if (toggle.copilot_enabled === false) switches.ask_ai = false
  return {
    enabled,
    available: master.available !== false,
    disabled_by: master.disabled_by ?? null,
    switches,
    features: allKeys((k) => enabled && switches[k]),
    ask_ai_staff_only: Boolean(toggle.ask_ai_staff_only),
    monthly_credit_cap: Number(toggle.monthly_credit_cap) || 0,
  }
}

/** The feature keys a deployment shows (EE-only surfaces hidden in OSS). */
export function visibleFeatures(group: AIFeatureGroup, mode: string): AIFeatureKey[] {
  return AI_FEATURE_GROUPS[group].filter((k) => mode !== 'oss' || !AI_EE_FEATURES.has(k))
}

/** How many of a group's shown switches are on. */
export function groupCount(settings: Pick<AISettings, 'switches'>, keys: AIFeatureKey[]): { on: number; total: number } {
  return { on: keys.filter((k) => settings.switches[k]).length, total: keys.length }
}

/** Learner Ask AI for one member: off when the org turned it off, or limited it to staff. */
export function askAIAvailable(settings: AISettings | null, isStaff: boolean | null | undefined): boolean {
  if (!settings?.features.ask_ai) return false
  return !settings.ask_ai_staff_only || isStaff === true
}

/** The monthly cap typed in the settings form: '' or 0 is no cap; null when invalid. */
export function parseCreditCap(input: string): number | null {
  const text = input.trim()
  if (text === '') return 0
  if (!/^\d+$/.test(text)) return null
  const value = Number(text)
  return value <= MAX_MONTHLY_CREDIT_CAP ? value : null
}

/** The error code of an AI 403 (detail.code), or null for anything else. */
export function aiErrorCode(body: unknown): string | null {
  const detail = obj(obj(body).detail)
  return typeof detail.code === 'string' && detail.code.startsWith('AI_') ? detail.code : null
}
