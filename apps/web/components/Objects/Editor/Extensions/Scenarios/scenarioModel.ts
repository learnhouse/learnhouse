// Pure data helpers for the Scenarios block: normalising stored attrs,
// validation (dead ends, unreachable steps, broken links), the map layout and
// immutable edits. No React here, so it is unit-tested directly
// (tests/editor-blocks-flow.test.mjs).
//
// Stored shape (unchanged since the first version of the block):
//   { title, currentScenarioId, scenarios: [{ id, text, imageUrl, options: [{ id, text, nextScenarioId }] }] }
// `currentScenarioId` is the START step. `nextScenarioId: null` ends the
// scenario; a step with no options is an ending too.
//
// Optional fields added with the Experiences redesign. They are only present
// when an author set them, so old content normalises (and round-trips) to
// exactly what was stored:
//   option.feedback  shown after the learner picks the choice
//   option.outcome   tone of the ending when the choice ends the story
//   step.ending      tone + title when the step has no choices
//   display          'story' (default) | 'chat'

export type Outcome = 'success' | 'neutral' | 'fail'
export type ScenarioDisplay = 'story' | 'chat'
export const OUTCOMES: Outcome[] = ['success', 'neutral', 'fail']

export interface ScenarioOption {
  id: string
  text: string
  nextScenarioId: string | null
  feedback?: string
  outcome?: Outcome
}

export interface ScenarioEnding {
  tone: Outcome
  title?: string
}

export interface ScenarioStep {
  id: string
  text: string
  imageUrl?: string
  options: ScenarioOption[]
  ending?: ScenarioEnding
}

export interface ScenarioData {
  title: string
  scenarios: ScenarioStep[]
  currentScenarioId: string
  /** Absent on old content; read it through displayOf(). */
  display?: ScenarioDisplay
}

export const MAX_STEPS = 40
export const MAX_CHOICES = 4

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : fallback)

export const isOutcome = (v: unknown): v is Outcome => v === 'success' || v === 'neutral' || v === 'fail'

function normalizeOption(o: any, i: number, j: number): ScenarioOption {
  const option: ScenarioOption = {
    id: str(o.id, `opt_${i}_${j}`),
    text: str(o.text),
    nextScenarioId: o.nextScenarioId === null || o.nextScenarioId === undefined || o.nextScenarioId === '' ? null : str(o.nextScenarioId),
  }
  // Optional keys only when set, so old options stay byte-for-byte the same.
  if (typeof o.feedback === 'string') option.feedback = o.feedback
  if (isOutcome(o.outcome)) option.outcome = o.outcome
  return option
}

function normalizeEnding(e: any): ScenarioEnding | undefined {
  if (!e || typeof e !== 'object' || !isOutcome(e.tone)) return undefined
  const ending: ScenarioEnding = { tone: e.tone }
  if (typeof e.title === 'string') ending.title = e.title
  return ending
}

/**
 * Guard whatever is stored (old content, AI output, collab peers) into the
 * shape the UI expects. No limits are applied here: the API accepts more
 * steps and choices (100 / 12) than the web editor offers, and those must
 * still render.
 */
export function normalizeScenario(attrs: any): ScenarioData {
  const rawSteps: any[] = Array.isArray(attrs?.scenarios) ? attrs.scenarios : []
  const scenarios: ScenarioStep[] = rawSteps
    .filter((s) => s && typeof s === 'object')
    .map((s, i) => {
      const step: ScenarioStep = {
        id: str(s.id, String(i + 1)),
        text: str(s.text),
        imageUrl: str(s.imageUrl),
        options: (Array.isArray(s.options) ? s.options : [])
          .filter((o: any) => o && typeof o === 'object')
          .map((o: any, j: number) => normalizeOption(o, i, j)),
      }
      const ending = normalizeEnding(s.ending)
      if (ending) step.ending = ending
      return step
    })
  const data: ScenarioData = {
    title: str(attrs?.title),
    scenarios,
    currentScenarioId: str(attrs?.currentScenarioId, scenarios[0]?.id ?? '1'),
  }
  if (attrs?.display === 'chat' || attrs?.display === 'story') data.display = attrs.display
  return data
}

export const displayOf = (data: Pick<ScenarioData, 'display'>): ScenarioDisplay => (data.display === 'chat' ? 'chat' : 'story')

/** The step learners start on: the stored start if it still exists, else the first step. */
export function startIdOf(data: ScenarioData): string | null {
  if (data.scenarios.some((s) => s.id === data.currentScenarioId)) return data.currentScenarioId
  return data.scenarios[0]?.id ?? null
}

export const stepById = (data: ScenarioData, id: string | null | undefined) =>
  id == null ? undefined : data.scenarios.find((s) => s.id === id)

export const stepIndex = (data: ScenarioData, id: string) => data.scenarios.findIndex((s) => s.id === id)

export const isEnding = (step: ScenarioStep) => step.options.length === 0

/** A fresh step id. Numeric ids stay numeric ("6"), anything else gets "step_<n>". */
export function nextStepId(steps: ScenarioStep[]): string {
  const ids = new Set(steps.map((s) => s.id))
  const numeric = steps.length > 0 && steps.every((s) => /^\d+$/.test(s.id))
  if (numeric || steps.length === 0) {
    let n = steps.reduce((m, s) => Math.max(m, Number(s.id) || 0), 0) + 1
    while (ids.has(String(n))) n++
    return String(n)
  }
  let n = steps.length + 1
  while (ids.has(`step_${n}`)) n++
  return `step_${n}`
}

let choiceCounter = 0
export function newChoiceId(): string {
  choiceCounter = (choiceCounter + 1) % 1000
  return `opt_${Date.now().toString(36)}${choiceCounter.toString(36)}${Math.random().toString(36).slice(2, 5)}`
}

// ─── Validation ──────────────────────────────────────────────────────────────

export type IssueCode = 'unreachable' | 'dead_end' | 'broken_link' | 'empty_text' | 'empty_choice' | 'no_ending' | 'no_steps'

export interface ScenarioIssue {
  code: IssueCode
  /** Errors break the learner path; warnings are worth a look. */
  level: 'error' | 'warning'
  stepId?: string
  choiceId?: string
}

export interface ScenarioReport {
  issues: ScenarioIssue[]
  byStep: Record<string, ScenarioIssue[]>
  reachable: Set<string>
  /** Steps from which some sequence of choices reaches an ending. */
  canFinish: Set<string>
}

export function reachableFrom(data: ScenarioData, start: string | null): Set<string> {
  const seen = new Set<string>()
  if (!start || !stepById(data, start)) return seen
  const queue = [start]
  seen.add(start)
  while (queue.length) {
    const step = stepById(data, queue.shift()!)
    for (const o of step?.options ?? []) {
      if (o.nextScenarioId && !seen.has(o.nextScenarioId) && stepById(data, o.nextScenarioId)) {
        seen.add(o.nextScenarioId)
        queue.push(o.nextScenarioId)
      }
    }
  }
  return seen
}

export function validateScenario(data: ScenarioData): ScenarioReport {
  const issues: ScenarioIssue[] = []
  const ids = new Set(data.scenarios.map((s) => s.id))
  const start = startIdOf(data)
  const reachable = reachableFrom(data, start)

  // Fixpoint: a step can finish when it is an ending, has a choice that ends
  // (or points nowhere: the player ends there too), or leads to a step that can.
  const canFinish = new Set<string>()
  let changed = true
  while (changed) {
    changed = false
    for (const s of data.scenarios) {
      if (canFinish.has(s.id)) continue
      const done =
        isEnding(s) ||
        s.options.some((o) => o.nextScenarioId === null || !ids.has(o.nextScenarioId) || canFinish.has(o.nextScenarioId))
      if (done) {
        canFinish.add(s.id)
        changed = true
      }
    }
  }

  if (data.scenarios.length === 0) issues.push({ code: 'no_steps', level: 'error' })
  for (const s of data.scenarios) {
    if (!s.text.trim()) issues.push({ code: 'empty_text', level: 'warning', stepId: s.id })
    if (!reachable.has(s.id)) issues.push({ code: 'unreachable', level: 'warning', stepId: s.id })
    else if (!canFinish.has(s.id)) issues.push({ code: 'dead_end', level: 'error', stepId: s.id })
    for (const o of s.options) {
      if (o.nextScenarioId !== null && !ids.has(o.nextScenarioId)) {
        issues.push({ code: 'broken_link', level: 'error', stepId: s.id, choiceId: o.id })
      }
      if (!o.text.trim()) issues.push({ code: 'empty_choice', level: 'warning', stepId: s.id, choiceId: o.id })
    }
  }
  if (start && !canFinish.has(start)) issues.unshift({ code: 'no_ending', level: 'error' })

  const byStep: Record<string, ScenarioIssue[]> = {}
  for (const issue of issues) if (issue.stepId) (byStep[issue.stepId] ??= []).push(issue)
  return { issues, byStep, reachable, canFinish }
}

// ─── Map layout ──────────────────────────────────────────────────────────────

export const MAP = { cardW: 220, cardH: 92, gapX: 76, gapY: 26, pad: 28, endW: 92 } as const

export interface MapNode {
  id: string
  x: number
  y: number
  col: number
  row: number
  reachable: boolean
}

export interface MapEdge {
  from: string
  choiceId: string
  index: number
  /** A step id, 'end', or 'broken' (points at a step that no longer exists). */
  to: string
}

export interface MapLayout {
  nodes: MapNode[]
  edges: MapEdge[]
  end: { x: number; y: number } | null
  width: number
  height: number
}

/**
 * Columns by distance from the start (breadth first); steps no choice reaches
 * get a column of their own at the end so they stand out. Choices that end the
 * scenario all point at one "End" marker after the last column.
 */
export function layoutScenario(data: ScenarioData): MapLayout {
  const start = startIdOf(data)
  const col = new Map<string, number>()
  const order: string[] = []
  if (start) {
    col.set(start, 0)
    order.push(start)
    for (let i = 0; i < order.length; i++) {
      const step = stepById(data, order[i])
      for (const o of step?.options ?? []) {
        const next = o.nextScenarioId
        if (next && !col.has(next) && stepById(data, next)) {
          col.set(next, col.get(order[i])! + 1)
          order.push(next)
        }
      }
    }
  }
  const reachableCols = order.length ? Math.max(...order.map((id) => col.get(id)!)) + 1 : 0
  const orphans = data.scenarios.filter((s) => !col.has(s.id)).map((s) => s.id)
  for (const id of orphans) col.set(id, reachableCols)
  const all = [...order, ...orphans]

  const rowsPerCol: Record<number, number> = {}
  const nodes: MapNode[] = all.map((id) => {
    const c = col.get(id)!
    const r = (rowsPerCol[c] = (rowsPerCol[c] ?? -1) + 1)
    return {
      id,
      col: c,
      row: r,
      x: MAP.pad + c * (MAP.cardW + MAP.gapX),
      y: MAP.pad + r * (MAP.cardH + MAP.gapY),
      reachable: !orphans.includes(id),
    }
  })

  const ids = new Set(data.scenarios.map((s) => s.id))
  const edges: MapEdge[] = []
  for (const s of data.scenarios) {
    s.options.forEach((o, index) => {
      const to = o.nextScenarioId === null ? 'end' : ids.has(o.nextScenarioId) ? o.nextScenarioId : 'broken'
      edges.push({ from: s.id, choiceId: o.id, index, to })
    })
  }

  const cols = Math.max(1, reachableCols + (orphans.length ? 1 : 0))
  const maxRows = Math.max(1, ...Object.values(rowsPerCol).map((r) => r + 1))
  const hasEnd = edges.some((e) => e.to === 'end')
  const endX = MAP.pad + cols * (MAP.cardW + MAP.gapX)
  const end = hasEnd ? { x: endX, y: MAP.pad + MAP.cardH / 2 - 16 } : null
  return {
    nodes,
    edges,
    end,
    width: (hasEnd ? endX + MAP.endW : MAP.pad + cols * (MAP.cardW + MAP.gapX) - MAP.gapX) + MAP.pad,
    height: MAP.pad * 2 + maxRows * (MAP.cardH + MAP.gapY) - MAP.gapY,
  }
}

// ─── Edits (immutable; the node view commits the result in one transaction) ──

export function updateStep(data: ScenarioData, id: string, patch: Partial<ScenarioStep>): ScenarioData {
  return { ...data, scenarios: data.scenarios.map((s) => (s.id === id ? { ...s, ...patch } : s)) }
}

export function addStep(
  data: ScenarioData,
  init: Partial<Pick<ScenarioStep, 'text' | 'options'>> = {},
  afterId?: string,
): { data: ScenarioData; id: string } {
  const id = nextStepId(data.scenarios)
  const step: ScenarioStep = { id, text: init.text ?? '', imageUrl: '', options: init.options ?? [] }
  const scenarios = [...data.scenarios]
  const at = afterId ? scenarios.findIndex((s) => s.id === afterId) : -1
  scenarios.splice(at >= 0 ? at + 1 : scenarios.length, 0, step)
  return { data: { ...data, scenarios, currentScenarioId: data.scenarios.length === 0 ? id : data.currentScenarioId }, id }
}

/** Remove a step; choices that led to it end the scenario instead. */
export function deleteStep(data: ScenarioData, id: string): ScenarioData {
  const scenarios = data.scenarios
    .filter((s) => s.id !== id)
    .map((s) => ({
      ...s,
      options: s.options.map((o) => (o.nextScenarioId === id ? { ...o, nextScenarioId: null } : o)),
    }))
  const currentScenarioId = data.currentScenarioId === id ? (scenarios[0]?.id ?? data.currentScenarioId) : data.currentScenarioId
  return { ...data, scenarios, currentScenarioId }
}

export function moveStep(data: ScenarioData, id: string, delta: -1 | 1): ScenarioData {
  const i = stepIndex(data, id)
  const j = i + delta
  if (i < 0 || j < 0 || j >= data.scenarios.length) return data
  const scenarios = [...data.scenarios]
  ;[scenarios[i], scenarios[j]] = [scenarios[j], scenarios[i]]
  return { ...data, scenarios }
}

export function addChoice(data: ScenarioData, stepId: string, text: string): ScenarioData {
  const step = stepById(data, stepId)
  if (!step || step.options.length >= MAX_CHOICES) return data
  return updateStep(data, stepId, { options: [...step.options, { id: newChoiceId(), text, nextScenarioId: null }] })
}

export function updateChoice(data: ScenarioData, stepId: string, choiceId: string, patch: Partial<ScenarioOption>): ScenarioData {
  const step = stepById(data, stepId)
  if (!step) return data
  return updateStep(data, stepId, { options: step.options.map((o) => (o.id === choiceId ? { ...o, ...patch } : o)) })
}

export function deleteChoice(data: ScenarioData, stepId: string, choiceId: string): ScenarioData {
  const step = stepById(data, stepId)
  if (!step) return data
  return updateStep(data, stepId, { options: step.options.filter((o) => o.id !== choiceId) })
}

/** Point a choice at a brand-new step (placed right after the step it comes from). */
export function linkChoiceToNewStep(data: ScenarioData, stepId: string, choiceId: string, text = ''): { data: ScenarioData; id: string } {
  const added = addStep(data, { text }, stepId)
  return { data: updateChoice(added.data, stepId, choiceId, { nextScenarioId: added.id }), id: added.id }
}

/** One line for pickers and map cards. */
export function excerpt(text: string, max = 60): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

export const choiceLetter = (i: number) => String.fromCharCode(65 + i)

// ─── Story builder (one list; each choice has a single "Then…" select) ──────

/** Untoned endings (all old content) keep the old green "Scenario complete" card. */
export const DEFAULT_OUTCOME: Outcome = 'success'

/**
 * A human title for a step: the first words of its text. Empty when the step
 * has no text yet (the UI shows "Step n" then). Ids are never shown.
 */
export function stepTitle(step: Pick<ScenarioStep, 'text'> | undefined, maxWords = 6, maxChars = 42): string {
  const flat = (step?.text ?? '').replace(/\s+/g, ' ').trim()
  if (!flat) return ''
  const words = flat.split(' ')
  let out = words.slice(0, maxWords).join(' ')
  if (out.length > maxChars) out = out.slice(0, maxChars - 1).trimEnd()
  return out.length < flat.length ? `${out.replace(/[.,;:!?]+$/, '')}…` : out
}

/** What a choice does next, as one select value. */
export type ThenValue = 'next' | 'missing' | `go:${string}` | `end:${Outcome}`

export function thenOf(data: ScenarioData, stepId: string, option: ScenarioOption): ThenValue {
  if (option.nextScenarioId === null) return `end:${option.outcome ?? DEFAULT_OUTCOME}`
  if (!stepById(data, option.nextScenarioId)) return 'missing'
  const i = stepIndex(data, stepId)
  if (i >= 0 && data.scenarios[i + 1]?.id === option.nextScenarioId) return 'next'
  return `go:${option.nextScenarioId}`
}

/** The step listed right after `stepId`, if any. */
export const followingStep = (data: ScenarioData, stepId: string) => {
  const i = stepIndex(data, stepId)
  return i >= 0 ? data.scenarios[i + 1] : undefined
}

/**
 * Apply a "Then…" choice. 'new' (and 'next' on the last step) creates a step
 * right after this one and returns its id so the editor can scroll to it.
 */
export function applyThen(
  data: ScenarioData,
  stepId: string,
  choiceId: string,
  value: ThenValue | 'new',
): { data: ScenarioData; createdId?: string } {
  const step = stepById(data, stepId)
  if (!step || !step.options.some((o) => o.id === choiceId)) return { data }
  // Linking to a step drops a stale ending tone.
  const linkTo = (target: string) => dropKey(updateChoice(data, stepId, choiceId, { nextScenarioId: target }), stepId, choiceId, 'outcome')
  if (value === 'missing') return { data }
  if (value === 'new' || (value === 'next' && !followingStep(data, stepId))) {
    const r = linkChoiceToNewStep(data, stepId, choiceId)
    return { data: dropKey(r.data, stepId, choiceId, 'outcome'), createdId: r.id }
  }
  if (value === 'next') return { data: linkTo(followingStep(data, stepId)!.id) }
  if (value.startsWith('go:')) {
    const target = value.slice(3)
    return stepById(data, target) ? { data: linkTo(target) } : { data }
  }
  const tone = value.slice(4)
  if (!isOutcome(tone)) return { data }
  return { data: updateChoice(data, stepId, choiceId, { nextScenarioId: null, outcome: tone }) }
}

function dropKey(data: ScenarioData, stepId: string, choiceId: string, key: 'outcome' | 'feedback'): ScenarioData {
  const step = stepById(data, stepId)
  if (!step) return data
  return updateStep(data, stepId, {
    options: step.options.map((o) => {
      if (o.id !== choiceId) return o
      const copy = { ...o }
      delete copy[key]
      return copy
    }),
  })
}

/** Feedback after a choice; clearing it removes the key (old shape again). */
export function setChoiceFeedback(data: ScenarioData, stepId: string, choiceId: string, feedback: string): ScenarioData {
  return feedback.trim() ? updateChoice(data, stepId, choiceId, { feedback }) : dropKey(data, stepId, choiceId, 'feedback')
}

/** Tone/title of a step that has no choices; `null` removes it. */
export function setStepEnding(data: ScenarioData, stepId: string, ending: ScenarioEnding | null): ScenarioData {
  return {
    ...data,
    scenarios: data.scenarios.map((s) => {
      if (s.id !== stepId) return s
      const copy = { ...s }
      if (ending) {
        const next: ScenarioEnding = { tone: ending.tone }
        if (ending.title && ending.title.trim()) next.title = ending.title
        copy.ending = next
      } else delete copy.ending
      return copy
    }),
  }
}

// ─── Learner player (pure state machine; the view only renders it) ──────────

export interface Visit {
  stepId: string
  choiceId: string
  choiceText: string
  feedback?: string
  outcome?: Outcome
}

export interface EndResult {
  tone: Outcome
  /** Author's ending title (step endings), else ''. */
  title: string
  /** False for untoned (old) endings: the player shows the old message. */
  toned: boolean
  /** 'choice': a choice ended the story; 'step': the learner reached a step with no choices. */
  via: 'choice' | 'step'
}

export interface PlayState {
  stepId: string | null
  path: Visit[]
  /** A picked choice whose feedback is showing; Continue applies it. */
  pending: string | null
  ended: EndResult | null
}

function stepEnd(step: ScenarioStep): EndResult {
  return {
    tone: step.ending?.tone ?? DEFAULT_OUTCOME,
    title: step.ending?.title?.trim() ?? '',
    toned: !!step.ending,
    via: 'step',
  }
}

export function startPlay(data: ScenarioData): PlayState {
  const start = stepById(data, startIdOf(data))
  if (!start) return { stepId: null, path: [], pending: null, ended: null }
  return { stepId: start.id, path: [], pending: null, ended: isEnding(start) ? stepEnd(start) : null }
}

/** Apply the pending choice: record it, then move on or end. */
export function continuePlay(data: ScenarioData, state: PlayState): PlayState {
  const step = stepById(data, state.stepId)
  const choice = step?.options.find((o) => o.id === state.pending)
  if (!step || !choice) return { ...state, pending: null }
  const visit: Visit = { stepId: step.id, choiceId: choice.id, choiceText: choice.text }
  if (choice.feedback?.trim()) visit.feedback = choice.feedback
  if (choice.outcome) visit.outcome = choice.outcome
  const path = [...state.path, visit]
  const next = stepById(data, choice.nextScenarioId)
  // A choice that ends the story, or points at a step that no longer exists,
  // finishes it rather than showing an error to learners.
  if (!next) {
    return {
      stepId: step.id,
      path,
      pending: null,
      ended: { tone: choice.outcome ?? DEFAULT_OUTCOME, title: '', toned: !!choice.outcome, via: 'choice' },
    }
  }
  return { stepId: next.id, path, pending: null, ended: isEnding(next) ? stepEnd(next) : null }
}

/** Pick a choice: with feedback it waits for Continue, otherwise it moves on at once. */
export function pickChoice(data: ScenarioData, state: PlayState, choiceId: string): PlayState {
  if (state.ended || state.pending) return state
  const step = stepById(data, state.stepId)
  const choice = step?.options.find((o) => o.id === choiceId)
  if (!choice) return state
  const picked = { ...state, pending: choice.id }
  return choice.feedback?.trim() ? picked : continuePlay(data, picked)
}

export function backPlay(state: PlayState): PlayState {
  if (state.pending) return { ...state, pending: null }
  const last = state.path[state.path.length - 1]
  if (!last) return state
  return { stepId: last.stepId, path: state.path.slice(0, -1), pending: null, ended: null }
}

/** "Step 3": the step the learner is on, counted along their path. */
export const stepNumber = (state: PlayState) => state.path.length + 1
