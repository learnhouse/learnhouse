import type { AutomationAction, AutomationCondition, AutomationSchema } from '@services/ee/platform/types'
import { actionParams } from './shared'

// Turns the API's validation messages ("action 2 (Schedule deletion): grace_days:
// must be a whole number between 3 and 30", "condition 1: …") into inline
// errors on the field they are about, worded with labels instead of keys.

export interface RuleErrors {
  /** action index → { param key or '' for the whole action → message } */
  actions: Record<number, Record<string, string>>
  /** condition index → message */
  conditions: Record<number, string>
}

export const NO_ERRORS: RuleErrors = { actions: {}, conditions: {} }

const WHERE = /^(action|condition) (\d+)([\s\S]*)$/

export function parseRuleError(
  message: string,
  schema: AutomationSchema | undefined,
  actions: AutomationAction[],
  conditions: AutomationCondition[]
): { errors: RuleErrors; summary: { kind: 'action' | 'condition'; index: number; label: string; field?: string; message: string } } | null {
  const m = WHERE.exec(message.trim())
  if (!m) return null
  const kind = m[1] as 'action' | 'condition'
  const index = Number(m[2]) - 1
  let rest = m[3]
  if (kind === 'condition') {
    rest = rest.replace(/^:\s*/, '')
    const c = conditions[index]
    const field = (Array.isArray(schema?.fields) ? schema!.fields : []).find((f) => f.key === c?.field)
    // "Plan (plan) must be one of…" → "Plan must be one of…"
    if (field) rest = rest.replace(` (${field.key})`, '').replace(new RegExp(`\\b${field.key}\\b`, 'g'), field.label || field.key)
    return {
      errors: { actions: {}, conditions: { [index]: rest } },
      summary: { kind, index, label: field?.label || c?.field || '', message: rest },
    }
  }
  const action = actions[index]
  const def = (Array.isArray(schema?.actions) ? schema!.actions : []).find((a) => a.type === action?.type)
  // Strip " (<action label>): " — the label itself may contain parentheses.
  if (def?.label && rest.startsWith(` (${def.label}): `)) rest = rest.slice(def.label.length + 5)
  else rest = rest.replace(/^ \((?:[^()]|\([^()]*\))*\): /, '').replace(/^:\s*/, '')
  const params = actionParams(def)
  const known = (k: string) => params.some((p) => p.name === k)
  let key = ''
  let mm: RegExpExecArray | null
  if ((mm = /^([a-z_]+):\s*([\s\S]*)$/.exec(rest)) && known(mm[1])) {
    key = mm[1] // "grace_days: must be…"
    rest = mm[2]
  } else if ((mm = /^'([a-z_]+)'\s+([\s\S]*)$/.exec(rest)) && known(mm[1])) {
    key = mm[1] // "'reason' is required"
    rest = mm[2]
  } else {
    // "Grace period (days) (grace_days): must be…" or "Grace period (days): …" (labels can hold parentheses).
    const p = params.find((x) => rest.startsWith(`${x.label} (${x.name})`)) ?? params.find((x) => x.label && rest.startsWith(x.label))
    if (p) {
      key = p.name
      rest = rest.slice(p.label!.length).replace(new RegExp(`^\\s*\\(${p.name}\\)`), '').replace(/^[:\s]+/, '')
    }
  }
  const param = params.find((p) => p.name === key)
  return {
    errors: { actions: { [index]: { [key]: rest } }, conditions: {} },
    summary: { kind, index, label: def?.label || action?.type || '', field: param?.label || key || undefined, message: rest },
  }
}

/**
 * Number params and number condition values as numbers (the API rejects "24"),
 * empty values dropped.
 */
export function coerceRule<T extends { actions: AutomationAction[]; conditions: AutomationCondition[] }>(draft: T, schema?: AutomationSchema): T {
  const fields = Array.isArray(schema?.fields) ? schema!.fields : []
  const defs = Array.isArray(schema?.actions) ? schema!.actions : []
  const num = (v: unknown) => {
    if (typeof v === 'number') return Number.isFinite(v) ? v : undefined
    if (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v))) return Number(v)
    return v === '' ? undefined : v
  }
  const conditions = draft.conditions.map((c) => {
    const f = fields.find((x) => x.key === c.field)
    if (f && (f.type === 'number' || f.type === 'integer' || f.type === 'int') && !Array.isArray(c.value)) return { ...c, value: num(c.value) }
    return c
  })
  const actions = draft.actions.map((a) => {
    const params = actionParams(defs.find((d) => d.type === a.type))
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(a.params ?? {})) {
      const p = params.find((x) => x.name === k)
      const isNum = p && (p.schema.type === 'integer' || p.schema.type === 'number')
      const value = isNum ? num(v) : v
      if (value === undefined || value === '' || value === null) continue
      out[k] = value
    }
    return { ...a, params: out }
  })
  return { ...draft, conditions, actions }
}
