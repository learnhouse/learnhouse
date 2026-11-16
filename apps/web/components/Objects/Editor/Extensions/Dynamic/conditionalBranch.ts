// If / otherwise pairs of conditional blocks. A conditional block directly
// followed by one whose rules are its exact opposite (what "Add a block for
// everyone else" inserts) reads as one if/else in the editor. Pure helpers,
// unit-tested in tests/editor-blocks-flow.test.mjs.
import { DEFAULT_RULES, RuleGroup, isGroup, negateRules } from './dynamicRules'

function canonical(rules: RuleGroup | null | undefined) {
  const r = rules && isGroup(rules) ? rules : DEFAULT_RULES
  return JSON.stringify({ match: r.match ?? 'all', negate: !!r.negate, conditions: r.conditions ?? [] })
}

export function sameRules(a: RuleGroup | null | undefined, b: RuleGroup | null | undefined): boolean {
  return canonical(a) === canonical(b)
}

interface NodeLike {
  type: { name: string }
  attrs: { rules?: RuleGroup | null }
}

const isConditional = (n: NodeLike | null | undefined): n is NodeLike => !!n && n.type.name === 'conditionalBlock'

/**
 * 'else' when the previous sibling is a conditional block with the opposite
 * rules, 'if' when the next one is, otherwise null. Blocks without any rule
 * never pair (everyone sees them; there is no "everyone else").
 */
export function branchRole(prev: NodeLike | null, current: NodeLike, next: NodeLike | null): 'if' | 'else' | null {
  const mine = current.attrs.rules ?? DEFAULT_RULES
  if (!mine.conditions?.length) return null
  if (isConditional(prev) && sameRules(negateRules(prev.attrs.rules), mine)) return 'else'
  if (isConditional(next) && sameRules(negateRules(mine), next.attrs.rules)) return 'if'
  return null
}
