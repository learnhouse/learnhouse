// Markdown helpers shared by the copilot and the Messages renderer: lazy
// KaTeX loading and the delimiter fixes a streamed answer needs.

import remarkGfm from 'remark-gfm'

// This module is pulled into the org menu bundle, so a static import would put
// KaTeX and its stylesheet on every page of the app. Load them the first time a
// message actually contains math, the way the editor's math block does.
export type MathPlugins = { remark: any[]; rehype: any[] }

export const BASE_REMARK_PLUGINS: any[] = [remarkGfm]
export const NO_REHYPE_PLUGINS: any[] = []

// KaTeX paints a parse failure bright red; inside a chat bubble a formula the
// model got wrong reads better in the surrounding text colour.
const KATEX_OPTIONS = { errorColor: 'inherit' }

let mathPluginsPromise: Promise<MathPlugins> | null = null

export function loadMathPlugins(): Promise<MathPlugins> {
  if (!mathPluginsPromise) {
    mathPluginsPromise = Promise.all([
      import('remark-math'),
      import('rehype-katex'),
      import('katex/dist/katex.min.css'),
    ]).then(([remarkMath, rehypeKatex]) => ({
      remark: [remarkGfm, remarkMath.default],
      rehype: [[rehypeKatex.default, KATEX_OPTIONS]],
    }))
  }
  return mathPluginsPromise
}

// Dollar-delimited math, or the LaTeX \( \) / \[ \] forms.
export const MATH_HINT = /\$\$|\\\(|\\\[|\$[^\s$][^$\n]*\$/

// Everything between a pair of code fences or inside a code span, so math
// rewriting can skip it.
const CODE_SEGMENT = /(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`)/g

/**
 * Rewrite LaTeX \( \) and \[ \] delimiters to the $ forms remark-math understands.
 * The model picks its own delimiters, and the backslash ones would otherwise reach
 * the reader as literal text with the backslashes stripped. The replacements stay on
 * one line: a blank line would end the list item or blockquote the formula sits in.
 */
export function normalizeMathDelimiters(markdown: string): string {
  return markdown
    .split(CODE_SEGMENT)
    .map((segment, i) =>
      // Odd indices are the captured code segments, which stay verbatim.
      i % 2 === 1
        ? segment
        : segment
            // A \[ that opens its own line is a display equation, so it keeps the
            // fenced form. Anywhere else (inside a list item, a table cell, a
            // blockquote) it has to stay on one line, or the blank lines around
            // the fence would close the block it sits in.
            .replace(
              /(^|\n)\\\[([\s\S]+?)\\\][ \t]*(?=\n|$)/g,
              (_m, before, math) => `${before}$$\n${math.trim()}\n$$`
            )
            .replace(/\\\[([\s\S]+?)\\\]/g, (_m, math) => `$$${math.trim()}$$`)
            .replace(/\\\(([\s\S]+?)\\\)/g, (_m, math) => `$${math.trim()}$`)
    )
    .join('')
}

/**
 * While the answer streams in, the closing $$ of the equation being written has
 * not arrived yet. Handed to remark-math as is, that open fence swallows every
 * chunk that follows it and renders the rest of the message as one parse error,
 * so hold the unfinished equation back until it is closed.
 */
export function dropUnclosedMath(markdown: string): string {
  const fences = markdown.match(/\$\$/g)
  if (!fences || fences.length % 2 === 0) return markdown
  return markdown.slice(0, markdown.lastIndexOf('$$'))
}

