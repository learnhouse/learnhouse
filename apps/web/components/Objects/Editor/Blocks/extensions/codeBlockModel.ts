/*
 Pure helpers for the code block's Editor Plus options: line numbers, lines to
 highlight ("2,4-6") and wrapping.

 The editor and DynamicCanva draw the numbers and highlight bars as
 ProseMirror widget decorations at the start of each line; StaticCanva (and
 @learnhouse/react) splits the highlighted tree into lines and emits the same
 markup. Both are styled by Plus/upgrades/upgrades.css. A block with none of
 the options set renders exactly as before.

 Imported by CodeBlock.tsx, CodeBlockStatic.tsx and the tests.
*/

/** Most lines one range may cover (so "1-99999999" can't stall a render). */
export const MAX_HIGHLIGHT_SPAN = 5000

/**
 * "2,4-6" → {2, 4, 5, 6}. Spaces are ignored, a reversed range ("6-4") is
 * read forwards, and anything unreadable (letters, 0, negatives) is skipped.
 * `maxLine` drops lines past the end of the code.
 */
export function parseHighlightLines(spec: unknown, maxLine = Infinity): Set<number> {
  const out = new Set<number>()
  if (typeof spec !== 'string' && typeof spec !== 'number') return out
  for (const part of String(spec).split(/[,;\s]+/)) {
    if (!part) continue
    const m = /^(\d+)(?:\s*[-–]\s*(\d+))?$/.exec(part)
    if (!m) continue
    let a = parseInt(m[1], 10)
    let b = m[2] !== undefined ? parseInt(m[2], 10) : a
    if (a > b) [a, b] = [b, a]
    a = Math.max(1, a)
    b = Math.min(b, maxLine, a + MAX_HIGHLIGHT_SPAN - 1)
    for (let n = a; n <= b; n++) out.add(n)
  }
  return out
}

/** The canonical stored form: sorted, merged ranges ("4-6,2,5" → "2,4-6"); null when empty. */
export function formatHighlightLines(lines: Iterable<number>): string | null {
  const sorted = [...new Set(lines)].filter((n) => Number.isInteger(n) && n > 0).sort((x, y) => x - y)
  if (!sorted.length) return null
  const parts: string[] = []
  let start = sorted[0]
  let prev = start
  for (const n of [...sorted.slice(1), Infinity]) {
    if (n === prev + 1) {
      prev = n
      continue
    }
    parts.push(start === prev ? String(start) : `${start}-${prev}`)
    start = prev = n
  }
  return parts.join(',')
}

/** What an author typed, cleaned for storage. */
export function normalizeHighlightLines(spec: unknown): string | null {
  return formatHighlightLines(parseHighlightLines(spec))
}

export interface CodeLine {
  /** 1-based line number. */
  n: number
  /** Character offset of the line start in the block's text. */
  offset: number
  highlighted: boolean
}

export interface CodeLineOptions {
  showLineNumbers: boolean
  highlight: Set<number>
}

export function codeLineOptions(attrs: any): CodeLineOptions {
  return {
    showLineNumbers: attrs?.showLineNumbers === true,
    highlight: parseHighlightLines(attrs?.highlightLines),
  }
}

/** True when the block needs per-line markup at all. */
export function needsLineMarkup(opts: CodeLineOptions): boolean {
  return opts.showLineNumbers || opts.highlight.size > 0
}

/** The lines of a code text with their offsets; [] when no option needs them. */
export function codeLines(text: string, attrs: any): CodeLine[] {
  const opts = codeLineOptions(attrs)
  if (!needsLineMarkup(opts)) return []
  const out: CodeLine[] = []
  let offset = 0
  let n = 1
  for (const line of String(text ?? '').split('\n')) {
    out.push({ n, offset, highlighted: opts.highlight.has(n) })
    offset += line.length + 1
    n++
  }
  return out
}

/** Width of the number gutter, in characters (at least 2). */
export function gutterDigits(lineCount: number): number {
  return Math.max(2, String(Math.max(1, lineCount)).length)
}

/**
 * Attributes for the <pre> (data-* drive the CSS). Empty for a block with no
 * options, so an old block's markup is unchanged.
 */
export function codePreAttrs(attrs: any, text: string): Record<string, string> {
  const out: Record<string, string> = {}
  const opts = codeLineOptions(attrs)
  if (opts.showLineNumbers) {
    out['data-line-numbers'] = 'true'
    out.style = `--lh-code-gutter:${gutterDigits(String(text ?? '').split('\n').length)}ch`
  }
  if (opts.highlight.size) out['data-highlight-lines'] = formatHighlightLines(opts.highlight) as string
  if (attrs?.wrap === true) out['data-wrap'] = 'true'
  return out
}

// ─── static rendering: split a lowlight tree into lines ────────────────────

export type Hast = { type: string; value?: string; tagName?: string; properties?: { className?: string[] }; children?: Hast[] }

export interface CodeToken {
  text: string
  /** The classes of every enclosing highlight span, outermost first. */
  classes: string[]
}

/** Flatten a lowlight (hast) tree into tokens and cut it at newlines. */
export function hastToLines(tree: Hast | null, fallbackText: string): CodeToken[][] {
  const lines: CodeToken[][] = [[]]
  const push = (text: string, classes: string[]) => {
    const parts = text.split('\n')
    parts.forEach((part, i) => {
      if (i > 0) lines.push([])
      if (part) lines[lines.length - 1].push({ text: part, classes })
    })
  }
  const walk = (node: Hast, classes: string[]) => {
    if (node.type === 'text') return push(node.value ?? '', classes)
    const own = node.type === 'element' ? node.properties?.className ?? [] : []
    for (const child of node.children ?? []) walk(child, own.length ? [...classes, ...own] : classes)
  }
  if (tree) walk(tree, [])
  else push(fallbackText, [])
  return lines
}
