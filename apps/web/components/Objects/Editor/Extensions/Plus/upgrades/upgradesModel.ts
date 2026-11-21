/*
 Pure helpers of the block upgrades that live in this folder: the inline math
 input rule, the button group alignment and the slash starters.

 Imported by the node definitions and by tests/editor-block-upgrades.test.mjs.
*/

// ─── inline math ───────────────────────────────────────────────────────────

/**
 * `$…$` typed at the end of a text run. Built to leave prices alone:
 * - the opening `$` follows the start of the text, a space or punctuation
 *   (not a letter, digit, `$` or backslash: "US$5", "$$", "\$");
 * - no space right after the opening `$` or right before the closing one
 *   ("$5 and $10" never matches, since "5 and " ends with a space);
 * - the inside has at least one character that is not a digit, space, dot or
 *   comma ("$12$", "$1,000.50$" stay text).
 * Group 1 is the character kept before the formula, group 2 the LaTeX.
 */
export const INLINE_MATH_INPUT = /(^|[^\w$\\])\$([^\s$](?:[^$\n]*[^\s$\\])?)\$$/

export function isInlineMathCandidate(latex: string): boolean {
  return /[^\d\s.,]/.test(latex)
}

/** The formula `$…$` at the end of `text` would turn into, or null. */
export function matchInlineMath(text: string): { latex: string; lead: string; length: number } | null {
  const m = INLINE_MATH_INPUT.exec(text)
  if (!m || !isInlineMathCandidate(m[2])) return null
  return { latex: m[2], lead: m[1], length: m[0].length - m[1].length }
}

/** Selected text turned into LaTeX: surrounding `$` and spaces dropped. */
export function latexFromSelection(text: string): string {
  return String(text ?? '')
    .trim()
    .replace(/^\$+|\$+$/g, '')
    .trim()
    .slice(0, 1000)
}

// ─── button group ──────────────────────────────────────────────────────────

export const BUTTON_GROUP_ALIGNMENTS = ['left', 'center', 'right'] as const
export type ButtonGroupAlignment = (typeof BUTTON_GROUP_ALIGNMENTS)[number]

export function buttonGroupAlignmentOf(attrs: any): ButtonGroupAlignment {
  const a = attrs?.alignment
  return a === 'center' || a === 'right' ? a : 'left'
}

/** flex justify for the alignment (logical, so RTL mirrors it). */
export function buttonGroupJustify(alignment: ButtonGroupAlignment): 'flex-start' | 'center' | 'flex-end' {
  return alignment === 'center' ? 'center' : alignment === 'right' ? 'flex-end' : 'flex-start'
}

export function starterButtonGroup(labels: { primary: string; secondary: string }) {
  return {
    type: 'buttonGroup',
    attrs: { alignment: 'left' },
    content: [
      { type: 'button', attrs: { emoji: '🔗', link: '', color: 'blue', alignment: 'left' }, content: [{ type: 'text', text: labels.primary }] },
      { type: 'button', attrs: { emoji: '🔗', link: '', color: 'blue', alignment: 'left', variant: 'outline' }, content: [{ type: 'text', text: labels.secondary }] },
    ],
  }
}

export function newGroupButton(label: string) {
  return { type: 'button', attrs: { emoji: '🔗', link: '', color: 'blue', alignment: 'left' }, content: label ? [{ type: 'text', text: label }] : [] }
}
