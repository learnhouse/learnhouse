// Shared vocabulary for dynamic content. The API evaluates rules and resolves
// variables (apps/api/src/services/courses/activities/dynamic_content.py);
// this file mirrors its tables so the editor only offers what the server
// understands. Anything the server doesn't know hides the block.

export type FieldType = 'set' | 'string' | 'locale' | 'number' | 'bool' | 'date' | 'audience'

export type RuleValue = string | number | string[] | number[] | null | undefined

export interface Condition {
  field: string
  op: string
  value?: RuleValue
}

export interface RuleGroup {
  match?: 'all' | 'any'
  negate?: boolean
  conditions: Array<Condition | RuleGroup>
}

export const DEFAULT_RULES: RuleGroup = { match: 'all', conditions: [] }

export interface FieldDef {
  field: string
  type: FieldType
  label: string
  // Fields whose value is picked from org data rather than typed
  picker?: 'usergroups' | 'roles' | 'activities' | 'audiences'
}

export const FIELDS: FieldDef[] = [
  { field: 'audience', type: 'audience', label: 'Saved audience', picker: 'audiences' },
  { field: 'user.groups', type: 'set', label: 'User group', picker: 'usergroups' },
  { field: 'user.role', type: 'string', label: 'Role', picker: 'roles' },
  { field: 'user.signed_in', type: 'bool', label: 'Signed in' },
  { field: 'user.email_domain', type: 'string', label: 'Email domain' },
  { field: 'user.account_days', type: 'number', label: 'Days since sign-up' },
  { field: 'course.enrolled', type: 'bool', label: 'Enrolled in course' },
  { field: 'course.completed', type: 'bool', label: 'Completed the course' },
  { field: 'enrollment.days', type: 'number', label: 'Days since enrollment' },
  { field: 'progress.percent', type: 'number', label: 'Course progress (%)' },
  { field: 'progress.completed_count', type: 'number', label: 'Activities completed' },
  { field: 'progress.completed_activities', type: 'set', label: 'Completed activities', picker: 'activities' },
  { field: 'date.today', type: 'date', label: 'Date' },
  { field: 'user.locale', type: 'locale', label: 'Language' },
  { field: 'user.bucket', type: 'number', label: 'Audience split (0-99)' },
]

export const OPS: Record<FieldType, string[]> = {
  set: ['contains_any', 'contains_all', 'contains_none'],
  string: ['in', 'not_in'],
  locale: ['in', 'not_in'],
  number: ['gte', 'lte', 'gt', 'lt', 'eq', 'neq', 'between'],
  bool: ['is_true', 'is_false'],
  date: ['on_or_after', 'on_or_before', 'between'],
  audience: ['is', 'is_not'],
}

export const OP_LABELS: Record<string, string> = {
  contains_any: 'is any of',
  contains_all: 'is all of',
  contains_none: 'is none of',
  in: 'is',
  not_in: 'is not',
  eq: '=',
  neq: '≠',
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
  between: 'between',
  is_true: 'yes',
  is_false: 'no',
  on_or_after: 'on or after',
  on_or_before: 'on or before',
  is: 'includes the learner',
  is_not: 'excludes the learner',
  before: 'before',
  after: 'after',
}

export const ROLES = ['admin', 'maintainer', 'member', 'anonymous'] as const

export interface VariableDef {
  path: string
  label: string
  group: 'user' | 'course' | 'progress' | 'date'
  sample: string
}

export const VARIABLES: VariableDef[] = [
  { path: 'user.first_name', label: 'First name', group: 'user', sample: 'Ada' },
  { path: 'user.last_name', label: 'Last name', group: 'user', sample: 'Lovelace' },
  { path: 'user.full_name', label: 'Full name', group: 'user', sample: 'Ada Lovelace' },
  { path: 'user.username', label: 'Username', group: 'user', sample: 'ada' },
  { path: 'user.email', label: 'Email', group: 'user', sample: 'ada@example.com' },
  { path: 'user.groups', label: 'User groups', group: 'user', sample: 'Team Leads' },
  { path: 'org.name', label: 'Organization name', group: 'course', sample: 'Acme' },
  { path: 'course.name', label: 'Course name', group: 'course', sample: 'Intro course' },
  { path: 'activity.name', label: 'Activity name', group: 'course', sample: 'Lesson 1' },
  { path: 'progress.percent', label: 'Progress (%)', group: 'progress', sample: '40' },
  { path: 'progress.completed', label: 'Completed activities', group: 'progress', sample: '4' },
  { path: 'progress.total', label: 'Total activities', group: 'progress', sample: '10' },
  { path: 'progress.remaining', label: 'Activities left', group: 'progress', sample: '6' },
  { path: 'enrollment.days', label: 'Days since enrollment', group: 'progress', sample: '12' },
  { path: 'enrollment.date', label: 'Enrollment date', group: 'progress', sample: '2026-10-19' },
  { path: 'date.today', label: "Today's date", group: 'date', sample: '2026-10-31' },
  { path: 'date.year', label: 'Current year', group: 'date', sample: '2026' },
]

export const VARIABLE_FORMATS = ['upper', 'lower', 'capitalize', 'title'] as const
export type VariableFormat = (typeof VARIABLE_FORMATS)[number]

// Same shape the server accepts in plain text: {{ user.first_name }}
export const VARIABLE_INPUT_REGEX = /\{\{\s*([a-z_]+(?:\.[a-z_]+)+)\s*\}\}$/

export function fieldDef(field: string): FieldDef | undefined {
  return FIELDS.find((f) => f.field === field)
}

export function variableDef(path: string): VariableDef | undefined {
  return VARIABLES.find((v) => v.path === path)
}

export function isGroup(item: Condition | RuleGroup): item is RuleGroup {
  return !!item && typeof item === 'object' && Array.isArray((item as RuleGroup).conditions)
}

export function defaultCondition(field = 'user.groups'): Condition {
  const def = fieldDef(field) ?? FIELDS[0]
  const op = OPS[def.type][0]
  return { field: def.field, op, value: defaultValue(def.type, op) }
}

export function defaultValue(type: FieldType, op: string): RuleValue {
  if (type === 'bool') return undefined
  if (type === 'audience') return ''
  if (op === 'between') return type === 'date' ? [today(), today()] : [0, 100]
  if (type === 'number') return op.startsWith('g') ? 50 : 0
  if (type === 'date') return today()
  return []
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

export function negateRules(rules: RuleGroup | null | undefined): RuleGroup {
  const base = rules && isGroup(rules) ? rules : DEFAULT_RULES
  return { ...base, negate: !base.negate }
}

// Flat groups (one level, plain conditions) are what the visual builder edits.
export function isFlatGroup(rules: RuleGroup): boolean {
  return rules.conditions.every((c) => !isGroup(c))
}

// ---------------------------------------------------------------------------
// Code mode: a small rule language that round-trips to the JSON tree.
//
//   user.groups contains_any ["usergroup_x"] and progress.percent gte 50
//   not (course.enrolled is_true or date.today on_or_after "2026-01-01")
//
// It is parsed here, in the browser, into the same JSON the visual builder
// writes. The server never parses it and never runs code.
// ---------------------------------------------------------------------------

type Token =
  | { kind: 'word'; value: string }
  | { kind: 'string'; value: string }
  | { kind: 'number'; value: number }
  | { kind: 'punct'; value: '(' | ')' | '[' | ']' | ',' }

export class RuleSyntaxError extends Error {}

function tokenize(source: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < source.length) {
    const ch = source[i]
    if (/\s/.test(ch)) {
      i++
    } else if ('()[],'.includes(ch)) {
      tokens.push({ kind: 'punct', value: ch as '(' })
      i++
    } else if (ch === '"') {
      let j = i + 1
      let value = ''
      while (j < source.length && source[j] !== '"') {
        if (source[j] === '\\' && j + 1 < source.length) j++
        value += source[j]
        j++
      }
      if (j >= source.length) throw new RuleSyntaxError('Unterminated string')
      tokens.push({ kind: 'string', value })
      i = j + 1
    } else if (/[-\d]/.test(ch)) {
      const match = /^-?\d+(\.\d+)?/.exec(source.slice(i))
      if (!match) throw new RuleSyntaxError(`Unexpected "${ch}"`)
      tokens.push({ kind: 'number', value: Number(match[0]) })
      i += match[0].length
    } else if (/[a-z_]/i.test(ch)) {
      const match = /^[a-z_][a-z_.]*/i.exec(source.slice(i))!
      tokens.push({ kind: 'word', value: match[0] })
      i += match[0].length
    } else {
      throw new RuleSyntaxError(`Unexpected "${ch}"`)
    }
  }
  return tokens
}

const KEYWORDS = new Set(['and', 'or', 'not'])

export function parseRules(source: string): RuleGroup {
  const tokens = tokenize(source)
  let pos = 0
  const peek = () => tokens[pos]
  const isWord = (word: string) => peek()?.kind === 'word' && peek()!.value === word
  const expectPunct = (value: string) => {
    const tok = tokens[pos++]
    if (!tok || tok.kind !== 'punct' || tok.value !== value) {
      throw new RuleSyntaxError(`Expected "${value}"`)
    }
  }

  const parseValue = (): RuleValue => {
    const tok = peek()
    if (!tok) throw new RuleSyntaxError('Expected a value')
    if (tok.kind === 'string' || tok.kind === 'number') {
      pos++
      return tok.value
    }
    if (tok.kind === 'punct' && tok.value === '[') {
      pos++
      const items: Array<string | number> = []
      while (!(peek()?.kind === 'punct' && peek()!.value === ']')) {
        const item = tokens[pos++]
        if (!item || (item.kind !== 'string' && item.kind !== 'number')) {
          throw new RuleSyntaxError('Lists hold strings or numbers')
        }
        items.push(item.value)
        if (peek()?.kind === 'punct' && peek()!.value === ',') pos++
      }
      expectPunct(']')
      return items as string[] | number[]
    }
    throw new RuleSyntaxError('Expected a value')
  }

  const parseCondition = (): Condition => {
    const fieldTok = tokens[pos++]
    if (!fieldTok || fieldTok.kind !== 'word' || KEYWORDS.has(fieldTok.value)) {
      throw new RuleSyntaxError('Expected a field such as user.groups')
    }
    const def = fieldDef(fieldTok.value)
    if (!def) throw new RuleSyntaxError(`Unknown field "${fieldTok.value}"`)
    const opTok = tokens[pos++]
    if (!opTok || opTok.kind !== 'word') throw new RuleSyntaxError(`Expected an operator after ${def.field}`)
    if (!OPS[def.type].includes(opTok.value)) {
      throw new RuleSyntaxError(
        `"${opTok.value}" doesn't apply to ${def.field} (use ${OPS[def.type].join(', ')})`
      )
    }
    if (def.type === 'bool') return { field: def.field, op: opTok.value }
    return { field: def.field, op: opTok.value, value: parseValue() }
  }

  const parsePrimary = (): Condition | RuleGroup => {
    if (isWord('not')) {
      pos++
      const inner = parsePrimary()
      const group = isGroup(inner) ? inner : { match: 'all' as const, conditions: [inner] }
      return { ...group, negate: !group.negate }
    }
    if (peek()?.kind === 'punct' && peek()!.value === '(') {
      pos++
      if (peek()?.kind === 'punct' && peek()!.value === ')') {
        pos++
        return { match: 'all', conditions: [] }
      }
      const inner = parseOr()
      expectPunct(')')
      return inner
    }
    return parseCondition()
  }

  const parseChain = (word: 'and' | 'or', next: () => Condition | RuleGroup): Condition | RuleGroup => {
    const items = [next()]
    while (isWord(word)) {
      pos++
      items.push(next())
    }
    if (items.length === 1) return items[0]
    const match = word === 'and' ? 'all' : 'any'
    // Flatten a chain of the same operator: a and (b and c) -> all[a, b, c]
    const conditions = items.flatMap((item) =>
      isGroup(item) && !item.negate && (item.match ?? 'all') === match ? item.conditions : [item]
    )
    return { match, conditions }
  }

  const parseAnd = () => parseChain('and', parsePrimary)
  const parseOr = (): Condition | RuleGroup => parseChain('or', parseAnd)

  if (tokens.length === 0) return { ...DEFAULT_RULES }
  const result = parseOr()
  if (pos < tokens.length) throw new RuleSyntaxError('Unexpected text at the end')
  return isGroup(result) ? { match: result.match ?? 'all', ...result } : { match: 'all', conditions: [result] }
}

function formatValue(value: RuleValue): string {
  if (Array.isArray(value)) return `[${value.map((v) => formatValue(v as any)).join(', ')}]`
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string') return JSON.stringify(value)
  return ''
}

function formatItem(item: Condition | RuleGroup, nested: boolean): string {
  if (isGroup(item)) {
    const body = formatGroupBody(item)
    if (item.negate) return `not (${body})`
    return nested && item.conditions.length > 1 ? `(${body})` : body
  }
  const value = item.value === undefined || item.value === null ? '' : ` ${formatValue(item.value)}`
  return `${item.field} ${item.op}${value}`
}

function formatGroupBody(group: RuleGroup): string {
  const joiner = group.match === 'any' ? ' or ' : ' and '
  return group.conditions.map((c) => formatItem(c, true)).join(joiner)
}

export function stringifyRules(rules: RuleGroup | null | undefined): string {
  if (!rules || !isGroup(rules)) return ''
  if (rules.conditions.length === 0) return rules.negate ? 'not ()' : ''
  return formatItem(rules, false)
}

// ---------------------------------------------------------------------------
// Human summary shown on the block ("Visible to: …")
// ---------------------------------------------------------------------------

export interface DescribeLookups {
  usergroups?: Record<string, string>
  activities?: Record<string, string>
  audiences?: Record<string, string>
}

function describeValue(field: string, value: RuleValue, lookups: DescribeLookups): string {
  const list = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]
  const names = list.map((v) => {
    const key = String(v)
    if (field === 'user.groups') return lookups.usergroups?.[key] ?? key
    if (field === 'progress.completed_activities') return lookups.activities?.[key] ?? key
    if (field === 'audience') return lookups.audiences?.[key] ?? 'a deleted audience'
    return key
  })
  return names.join(', ') || '…'
}

function describeItem(item: Condition | RuleGroup, lookups: DescribeLookups): string {
  if (isGroup(item)) {
    const inner = describeGroup(item, lookups)
    return item.negate ? `not (${inner})` : `(${inner})`
  }
  const def = fieldDef(item.field)
  const label = def?.label ?? item.field
  const op = OP_LABELS[item.op] ?? item.op
  if (def?.type === 'bool') return `${label}: ${op}`
  if (def?.type === 'audience') {
    const name = describeValue(item.field, item.value, lookups)
    return item.op === 'is_not' ? `not in "${name}"` : `"${name}"`
  }
  if (item.op === 'between' && Array.isArray(item.value)) {
    return `${label} between ${describeValue(item.field, item.value[0] as any, lookups)} and ${describeValue(item.field, item.value[1] as any, lookups)}`
  }
  return `${label} ${op} ${describeValue(item.field, item.value, lookups)}`
}

function describeGroup(group: RuleGroup, lookups: DescribeLookups): string {
  const joiner = group.match === 'any' ? ' or ' : ' and '
  return group.conditions.map((c) => describeItem(c, lookups)).join(joiner)
}

export function describeRules(rules: RuleGroup | null | undefined, lookups: DescribeLookups = {}): string {
  if (!rules || !isGroup(rules) || rules.conditions.length === 0) {
    return rules?.negate ? 'No one' : 'Everyone'
  }
  const body = describeGroup(rules, lookups)
  return rules.negate ? `Everyone except: ${body}` : body
}

// ---------------------------------------------------------------------------
// Quick-start presets: the rules authors reach for most, one click away.
// ---------------------------------------------------------------------------

export interface RulePreset {
  id: string
  label: string
  description: string
  rules: () => RuleGroup
  hiddenMessage?: string
}

function inDays(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)
}

export const PRESETS: RulePreset[] = [
  {
    id: 'group',
    label: 'Members of a group',
    description: 'Only learners in the user groups you pick',
    rules: () => ({ match: 'all', conditions: [{ field: 'user.groups', op: 'contains_any', value: [] }] }),
  },
  {
    id: 'drip',
    label: 'After a week',
    description: 'Unlocks 7 days after the learner enrolls',
    rules: () => ({
      match: 'all',
      conditions: [
        { field: 'course.enrolled', op: 'is_true' },
        { field: 'enrollment.days', op: 'gte', value: 7 },
      ],
    }),
    hiddenMessage: 'This unlocks after your first week.',
  },
  {
    id: 'halfway',
    label: 'Halfway through',
    description: 'Learners with 50% or more of the course done',
    rules: () => ({ match: 'all', conditions: [{ field: 'progress.percent', op: 'gte', value: 50 }] }),
  },
  {
    id: 'finished',
    label: 'Finished the course',
    description: 'A congratulations or next-steps note',
    rules: () => ({ match: 'all', conditions: [{ field: 'course.completed', op: 'is_true' }] }),
  },
  {
    id: 'ab',
    label: 'A/B test (half)',
    description: 'A stable half of learners; add the opposite block for the other half',
    rules: () => ({ match: 'all', conditions: [{ field: 'user.bucket', op: 'lt', value: 50 }] }),
  },
  {
    id: 'visitors',
    label: 'Signed-out visitors',
    description: 'People browsing without an account',
    rules: () => ({ match: 'all', conditions: [{ field: 'user.signed_in', op: 'is_false' }] }),
  },
  {
    id: 'dates',
    label: 'Between two dates',
    description: 'A time-limited announcement',
    rules: () => ({ match: 'all', conditions: [{ field: 'date.today', op: 'between', value: [inDays(0), inDays(7)] }] }),
  },
]

export function presetById(id: string): RulePreset | undefined {
  return PRESETS.find((p) => p.id === id)
}
