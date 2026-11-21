/**
 * Pure logic behind course contributions on the learner page: how a block is
 * identified, what a suggestion carries, and the word diff the preview and
 * the review queue show. No React and no path aliases, so tests import it.
 *
 * Page content has no node ids. A block is found by its top-level index plus
 * a fingerprint (type + normalized text, or its settings when it has no
 * text), exactly like the API (`services/courses/contributions/blocks.py`)
 * and the AI editor proposals. Both sides compute it from JSON, so they agree.
 */

import { wordDiff, type DiffPart } from '../Editor/Blocks/bubble/selectionTools'

export type JSONNode = Record<string, any>

const VOLATILE_ATTRS = new Set(['id', 'quizId', 'blockId', 'uuid', 'question_id', 'answer_id'])
const FP_TEXT_MAX = 500
const FP_ATTRS_MAX = 600

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()

/** All the text of a node, joined without separators (ProseMirror's textContent). */
export function textOf(node: any): string {
  if (!node || typeof node !== 'object') return ''
  if (typeof node.text === 'string') return node.text
  return Array.isArray(node.content) ? node.content.map(textOf).join('') : ''
}

/** Text with spaces between blocks and list items, for reading and diffs. */
export function readableText(node: any): string {
  if (!node || typeof node !== 'object') return ''
  if (typeof node.text === 'string') return node.text
  if (node.type === 'hardBreak') return '\n'
  if (!Array.isArray(node.content)) return ''
  const inline = node.content.every((c: any) => c && (typeof c.text === 'string' || c.type === 'hardBreak'))
  return node.content.map(readableText).join(inline ? '' : '\n')
}

function stableAttrs(attrs: any): string {
  if (!attrs || typeof attrs !== 'object') return ''
  const keys = Object.keys(attrs)
    .filter((k) => !VOLATILE_ATTRS.has(k) && attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== '')
    .sort()
  if (!keys.length) return ''
  try {
    return JSON.stringify(keys.map((k) => [k, attrs[k]])).slice(0, FP_ATTRS_MAX)
  } catch {
    return keys.join(',')
  }
}

/** What identifies a block: its type and text, or its settings. */
export function fingerprint(node: any): string {
  if (!node || typeof node !== 'object') return '?|'
  const type = String(node.type || '?')
  const text = norm(textOf(node))
  if (text) return `${type}|${text.slice(0, FP_TEXT_MAX)}`
  return `${type}|#${stableAttrs(node.attrs)}`
}

/** Where each credit sits on the page as rendered: fingerprint first, then index. */
export function creditIndexes(blocks: JSONNode[], credits: { block_index: number; block_fp: string }[]): Map<number, number> {
  const fps = blocks.map(fingerprint)
  const out = new Map<number, number>() // rendered index -> credit position
  credits.forEach((c, i) => {
    const matches = fps.map((f, k) => (f === c.block_fp ? k : -1)).filter((k) => k >= 0)
    const k = matches.length
      ? matches.reduce((best, m) => (Math.abs(m - c.block_index) < Math.abs(best - c.block_index) ? m : best), matches[0])
      : c.block_index < blocks.length
        ? c.block_index
        : -1
    if (k >= 0 && !out.has(k)) out.set(k, i)
  })
  return out
}

export type SuggestionDraft = {
  base_version: number
  start_index: number
  before: JSONNode[]
  after: JSONNode[]
  prev_fp?: string | null
  note?: string
}

/** The suggestion for replacing blocks [from, to) of the page with `after`. */
export function buildDraft(
  blocks: JSONNode[],
  from: number,
  to: number,
  after: JSONNode[],
  version: number,
  note = ''
): SuggestionDraft {
  const before = blocks.slice(from, to)
  const draft: SuggestionDraft = { base_version: version, start_index: from, before, after: stripEmptyTail(after), note: note.trim() }
  if (!before.length) draft.prev_fp = from > 0 ? fingerprint(blocks[from - 1]) : ''
  return draft
}

/** An editor always keeps one paragraph; a trailing empty one is not content. */
export function stripEmptyTail(nodes: JSONNode[]): JSONNode[] {
  const out = [...nodes]
  while (out.length && out[out.length - 1]?.type === 'paragraph' && !textOf(out[out.length - 1]).trim() && !(out[out.length - 1].content || []).length) {
    out.pop()
  }
  return out
}

/** Same blocks, same content: nothing to suggest. */
export function sameBlocks(a: JSONNode[], b: JSONNode[]): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b))
}

function canonical(value: any): any {
  if (Array.isArray(value)) return value.map(canonical)
  if (!value || typeof value !== 'object') return value
  const out: Record<string, any> = {}
  for (const key of Object.keys(value).sort()) {
    const v = value[key]
    if (v === null || v === undefined) continue
    if (key === 'attrs' && v && typeof v === 'object' && !Object.keys(v).some((k) => v[k] !== null && v[k] !== undefined)) continue
    out[key] = canonical(v)
  }
  return out
}

/** Whether every block of a range is text the inline editor handles well. */
export function isTextOnly(nodes: JSONNode[], textTypes: Set<string>): boolean {
  return nodes.length > 0 && nodes.every((n) => textTypes.has(String(n?.type)))
}

// ─── diffs ───────────────────────────────────────────────────────────────────

// The word diff the editor's AI previews already use.
export { wordDiff as diffWords } from '../Editor/Blocks/bubble/selectionTools'
export type { DiffPart } from '../Editor/Blocks/bubble/selectionTools'

/** How a block pair changed, for the preview: text diff, or a settings change. */
export type BlockChange =
  | { kind: 'text'; parts: DiffPart[]; type: string }
  | { kind: 'added'; node: JSONNode }
  | { kind: 'removed'; node: JSONNode }
  | { kind: 'replaced'; before: JSONNode; after: JSONNode }

export function blockChanges(before: JSONNode[], after: JSONNode[], textTypes: Set<string>): BlockChange[] {
  const out: BlockChange[] = []
  const n = Math.max(before.length, after.length)
  for (let k = 0; k < n; k++) {
    const b = before[k]
    const a = after[k]
    if (b && !a) out.push({ kind: 'removed', node: b })
    else if (a && !b) out.push({ kind: 'added', node: a })
    else if (b && a) {
      if (textTypes.has(String(b.type)) && b.type === a.type) {
        out.push({ kind: 'text', type: String(a.type), parts: wordDiff(readableText(b), readableText(a)) })
      } else if (!sameBlocks([b], [a])) {
        out.push({ kind: 'replaced', before: b, after: a })
      } else {
        out.push({ kind: 'text', type: String(a.type), parts: [{ kind: 'same', text: readableText(a) }] })
      }
    }
  }
  return out
}

/** Text changes keep their marks out of the diff; flag a format-only change. */
export function formatOnly(change: BlockChange, before: JSONNode | undefined, after: JSONNode | undefined): boolean {
  return (
    change.kind === 'text' &&
    change.parts.every((p) => p.kind === 'same') &&
    !!before &&
    !!after &&
    !sameBlocks([before], [after])
  )
}
