/**
 * Renders the CSS block that mirrors design/tokens.ts in styles/globals.css.
 * Used by scripts/design-tokens.mjs (writes it) and
 * tests/design-tokens.test.mjs (checks it). Pure module.
 */
import { cssTokenList } from './tokens'

export const TOKENS_CSS_START = '/* @design-tokens:start */'
export const TOKENS_CSS_END = '/* @design-tokens:end */'

export function renderTokensCss(): string {
  const list = cssTokenList()
  // Tailwind namespaces (--color-*, --radius-*…) go in @theme so they make
  // utilities; plain --lh-* variables have no utility and live on :root.
  const themed = list.filter((t) => !t.cssVar.startsWith('--lh-'))
  const plain = list.filter((t) => t.cssVar.startsWith('--lh-'))
  const lines = [
    TOKENS_CSS_START,
    '/* LearnHouse V2 design tokens. Generated from design/tokens.ts by',
    '   `bun scripts/design-tokens.mjs`; edit the TS file, not this block.',
    '   `inline`: utilities carry the value itself, so the org accent',
    '   (var(--lh-accent, ...)) resolves on the element inside .lh-theme',
    '   instead of once at :root. */',
    '@theme inline {',
    ...themed.map((t) => `  ${t.cssVar}: ${t.value};`),
    '}',
    ':root {',
    ...plain.map((t) => `  ${t.cssVar}: ${t.value};`),
    '}',
    TOKENS_CSS_END,
  ]
  return lines.join('\n')
}

/** The block currently in a stylesheet, or null when the markers are missing. */
export function extractTokensCss(css: string): string | null {
  const start = css.indexOf(TOKENS_CSS_START)
  const end = css.indexOf(TOKENS_CSS_END)
  if (start < 0 || end < start) return null
  return css.slice(start, end + TOKENS_CSS_END.length)
}
