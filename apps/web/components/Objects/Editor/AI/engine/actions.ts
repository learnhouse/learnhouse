/*
 AI Editor quick actions and credit estimates (pure, unit tested).

 An action is a message plus an id the server turns into precise
 instructions (ee/services/agent/ai_editor/tools.py ACTIONS). Every message
 is one Atlas turn (costs.turn credits). Image suggestions cost nothing more
 until the author generates one (costs.image each), so the panel says both
 before anything runs.
*/

export interface CreditCosts {
  turn: number
  complete: number
  image: number
}

export const DEFAULT_COSTS: CreditCosts = { turn: 3, complete: 1, image: 5 }

export function costsOf(raw?: Partial<CreditCosts> | null): CreditCosts {
  const pick = (k: keyof CreditCosts) => {
    const v = raw?.[k]
    return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : DEFAULT_COSTS[k]
  }
  return { turn: pick('turn'), complete: pick('complete'), image: pick('image') }
}

export type ActionGroup = 'write' | 'improve' | 'transform' | 'practice' | 'polish'
export type ActionParam = 'tone' | 'language' | 'level' | 'section'

export type QuickActionId =
  | 'continue'
  | 'draft_section'
  | 'examples'
  | 'improve'
  | 'shorten'
  | 'expand'
  | 'grammar'
  | 'tone'
  | 'reading_level'
  | 'translate'
  | 'table'
  | 'callouts'
  | 'takeaways'
  | 'quiz'
  | 'flashcards'
  | 'scenario'
  | 'images'
  | 'accessibility'
  | 'seo'
  | 'explain'

export interface QuickAction {
  id: QuickActionId
  group: ActionGroup
  /** A choice the author makes first (tone, language, level, section). */
  param?: ActionParam
  /** Works on the selection when there is one (else the whole page). */
  usesSelection: boolean
  /** Generates images when accepted (extra credits per image). */
  images?: boolean
}

export const QUICK_ACTIONS: QuickAction[] = [
  { id: 'continue', group: 'write', usesSelection: false },
  { id: 'draft_section', group: 'write', param: 'section', usesSelection: false },
  { id: 'examples', group: 'write', usesSelection: true },
  { id: 'improve', group: 'improve', usesSelection: true },
  { id: 'shorten', group: 'improve', usesSelection: true },
  { id: 'expand', group: 'improve', usesSelection: true },
  { id: 'grammar', group: 'improve', usesSelection: true },
  { id: 'tone', group: 'improve', param: 'tone', usesSelection: true },
  { id: 'reading_level', group: 'improve', param: 'level', usesSelection: false },
  { id: 'translate', group: 'transform', param: 'language', usesSelection: true },
  { id: 'table', group: 'transform', usesSelection: true },
  { id: 'callouts', group: 'transform', usesSelection: true },
  { id: 'takeaways', group: 'transform', usesSelection: false },
  { id: 'quiz', group: 'practice', usesSelection: true },
  { id: 'flashcards', group: 'practice', usesSelection: true },
  { id: 'scenario', group: 'practice', usesSelection: false },
  { id: 'images', group: 'polish', usesSelection: false, images: true },
  { id: 'accessibility', group: 'polish', usesSelection: false },
  { id: 'seo', group: 'polish', usesSelection: false },
]

export const ACTION_GROUPS: ActionGroup[] = ['write', 'improve', 'transform', 'practice', 'polish']

export const TONES = ['friendly', 'formal', 'confident', 'playful', 'concise'] as const
export const LEVELS = ['beginner', 'grade_6', 'grade_9', 'university', 'expert'] as const
export const LANGUAGES = [
  'English', 'Spanish', 'French', 'German', 'Portuguese', 'Italian', 'Dutch', 'Arabic', 'Hindi', 'Japanese',
  'Korean', 'Chinese', 'Russian', 'Turkish', 'Polish', 'Vietnamese', 'Indonesian', 'Persian',
] as const

export function actionById(id: string | null | undefined): QuickAction | undefined {
  return QUICK_ACTIONS.find((a) => a.id === id)
}

export interface CreditEstimate {
  /** Credits the request itself reserves. */
  now: number
  /** Extra credits per item generated afterwards (images), 0 when none. */
  perItem: number
}

/** What sending a message or running an action costs. */
export function estimateCredits(action: QuickActionId | null | undefined, costs: CreditCosts): CreditEstimate {
  const a = actionById(action ?? undefined)
  return { now: costs.turn, perItem: a?.images ? costs.image : 0 }
}

/** Credits to accept a set of hunks (only image hunks generate anything). */
export function acceptCredits(hunks: { kind: string }[], costs: CreditCosts): number {
  return hunks.filter((h) => h.kind === 'image').length * costs.image
}

/** At or above this many credits a request asks before it runs. */
export const EXPENSIVE_CREDITS = 5

export function isExpensive(credits: number): boolean {
  return credits >= EXPENSIVE_CREDITS
}

/** Group actions in display order. */
export function groupedActions(): { group: ActionGroup; actions: QuickAction[] }[] {
  return ACTION_GROUPS.map((group) => ({ group, actions: QUICK_ACTIONS.filter((a) => a.group === group) }))
}

/**
 * The few actions worth showing under the composer for this page right now
 * (everything else is in the "/" menu): selection edits when text is
 * selected, writing help on a near-empty page, else the common page tasks.
 */
export function suggestedActions(ctx: { hasSelection: boolean; textLength: number; headings: number }): QuickActionId[] {
  if (ctx.hasSelection) return ['improve', 'shorten', 'grammar', 'tone', 'translate']
  if (ctx.textLength < 280) return ctx.headings ? ['draft_section', 'continue', 'examples'] : ['continue', 'examples', 'takeaways']
  return ['continue', 'shorten', 'grammar', 'quiz', 'translate']
}
