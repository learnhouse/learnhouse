/*
 AI Editor proposals as editor transactions (pure, unit tested).

 A proposal's hunks were computed by the server against a snapshot of the
 page. By the time the author accepts one, the page may have moved: their own
 typing, or other people's in a live room. So a hunk is never applied by
 position. It is LOCATED again in the current document by the blocks it
 replaces (`before`) or, for an insert, by its neighbours (`prev` / `next`),
 matched by a fingerprint (type + text), nearest to where it was.

 Applying replaces only the part of that range that actually differs
 (Fragment.findDiffStart / findDiffEnd), as one transaction with
 `lh-origin: ai`. With live editing that becomes a minimal Yjs change, so
 what others type elsewhere, even in the same paragraph, survives, and the
 collaboration undo reverts only this author's change. Reverting is the
 same operation the other way (locate `after`, put `before` back).
*/
import { Fragment, Node as PMNode, Schema } from '@tiptap/pm/model'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import type { AIEditorHunk } from '@services/ai/aiEditor'

export const AI_ORIGIN_META = 'lh-origin'
export const AI_ORIGIN = 'ai'

export type JSONNode = Record<string, any>

export interface LocatedHunk {
  /** Document positions of the range the hunk replaces (from === to for an insert). */
  from: number
  to: number
  /** Top-level index of the range start. */
  index: number
  /** Not found where expected: an insert placed by its old index only. */
  approximate: boolean
}

// ─── fingerprints ────────────────────────────────────────────────────────────

const VOLATILE_ATTRS = new Set(['id', 'quizId', 'blockId', 'uuid', 'question_id', 'answer_id'])

function stableAttrs(attrs: Record<string, any> | null | undefined): string {
  if (!attrs) return ''
  const keys = Object.keys(attrs)
    .filter((k) => !VOLATILE_ATTRS.has(k) && attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== '')
    .sort()
  if (!keys.length) return ''
  try {
    return JSON.stringify(keys.map((k) => [k, attrs[k]])).slice(0, 600)
  } catch {
    return keys.join(',')
  }
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()

/** What identifies a block for matching: its type and text (atoms: their settings). */
export function fingerprint(node: PMNode): string {
  const text = norm(node.textContent || '')
  if (text) return `${node.type.name}|${text.slice(0, 500)}`
  return `${node.type.name}|#${stableAttrs(node.attrs)}`
}

/** Drop marks and attributes the schema does not know, so model output loads. */
export function sanitizeJSON(json: JSONNode, schema: Schema): JSONNode | null {
  if (!json || typeof json !== 'object') return null
  const type = schema.nodes[json.type]
  if (!type) return null
  const out: JSONNode = { type: json.type }
  if (json.attrs && typeof json.attrs === 'object') {
    const attrs: Record<string, any> = {}
    const known = type.spec.attrs || {}
    for (const [k, v] of Object.entries(json.attrs)) if (k in known) attrs[k] = v
    out.attrs = attrs
  }
  if (typeof json.text === 'string') out.text = json.text
  if (Array.isArray(json.marks)) {
    const marks = json.marks.filter((m: any) => m && schema.marks[m.type])
    if (marks.length) out.marks = marks
  }
  if (Array.isArray(json.content)) {
    out.content = json.content.map((c: any) => sanitizeJSON(c, schema)).filter(Boolean)
  }
  return out
}

function textOf(json: any): string {
  if (!json || typeof json !== 'object') return ''
  if (typeof json.text === 'string') return json.text
  return Array.isArray(json.content) ? json.content.map(textOf).filter(Boolean).join(' ') : ''
}

/**
 * A block from proposal JSON: as is when the schema accepts it, cleaned of
 * unknown marks/attrs otherwise, else a paragraph holding its text.
 */
export function nodeFromJSON(json: JSONNode, schema: Schema): PMNode | null {
  try {
    const node = schema.nodeFromJSON(json)
    node.check()
    return node
  } catch {
    // fall through
  }
  const clean = sanitizeJSON(json, schema)
  if (clean) {
    try {
      const node = schema.nodeFromJSON(clean)
      node.check()
      return node
    } catch {
      // fall through
    }
  }
  const text = textOf(json).trim()
  if (!text || !schema.nodes.paragraph) return null
  return schema.nodes.paragraph.create(null, schema.text(text))
}

export function nodesFromJSON(list: JSONNode[] | null | undefined, schema: Schema): PMNode[] {
  return (list || []).map((j) => nodeFromJSON(j, schema)).filter((n): n is PMNode => !!n)
}

export function fingerprintJSON(json: JSONNode | null | undefined, schema: Schema): string | null {
  if (!json) return null
  const node = nodeFromJSON(json, schema)
  return node ? fingerprint(node) : null
}

// ─── locating ────────────────────────────────────────────────────────────────

/** Position before the top-level node at `index` (or the end). */
export function posOfIndex(doc: PMNode, index: number): number {
  let pos = 0
  const n = Math.min(index, doc.childCount)
  for (let i = 0; i < n; i++) pos += doc.child(i).nodeSize
  return pos
}

function topFingerprints(doc: PMNode): string[] {
  const out: string[] = []
  doc.forEach((child) => out.push(fingerprint(child)))
  return out
}

function nearest(candidates: number[], target: number): number | null {
  if (!candidates.length) return null
  return candidates.reduce((best, c) => (Math.abs(c - target) < Math.abs(best - target) ? c : best), candidates[0])
}

/**
 * Old fingerprint -> what it became, from hunks already applied in this
 * proposal, so an insert anchored on a rewritten block still finds it.
 */
export type Aliases = Map<string, string[]>

export function addAliases(aliases: Aliases, hunk: AIEditorHunk, schema: Schema): void {
  const before = hunk.before.map((j) => fingerprintJSON(j, schema)).filter(Boolean) as string[]
  const after = hunk.after.map((j) => fingerprintJSON(j, schema)).filter(Boolean) as string[]
  for (const fp of before) aliases.set(fp, [...(aliases.get(fp) || []), ...after])
}

function anchorIndices(fps: string[], fp: string | null, aliases?: Aliases): number[] {
  if (!fp) return []
  const wanted = new Set([fp, ...(aliases?.get(fp) || [])])
  const out: number[] = []
  fps.forEach((f, i) => wanted.has(f) && out.push(i))
  return out
}

/**
 * Where a hunk applies in `doc` now. `direction: 'revert'` locates its
 * `after` blocks (to put `before` back). Null when the blocks it changes are
 * gone or were edited since (the author decides again).
 */
export function locateHunk(
  doc: PMNode,
  hunk: AIEditorHunk,
  schema: Schema,
  options: { direction?: 'apply' | 'revert'; aliases?: Aliases } = {}
): LocatedHunk | null {
  const revert = options.direction === 'revert'
  const fps = topFingerprints(doc)
  const removed = revert ? hunk.after : hunk.before
  const target = hunk.index

  if (removed.length) {
    const want = removed.map((j) => fingerprintJSON(j, schema))
    if (want.some((w) => w === null)) return null
    const starts: number[] = []
    for (let i = 0; i + want.length <= fps.length; i++) {
      if (want.every((w, k) => fps[i + k] === w)) starts.push(i)
    }
    const at = nearest(starts, target)
    if (at === null) return null
    return { from: posOfIndex(doc, at), to: posOfIndex(doc, at + want.length), index: at, approximate: false }
  }

  // An insert: after its previous block, else before its next one.
  const prevFp = fingerprintJSON(hunk.prev, schema)
  const nextFp = fingerprintJSON(hunk.next, schema)
  const prev = nearest(anchorIndices(fps, prevFp, options.aliases), target - 1)
  if (prev !== null) {
    const pos = posOfIndex(doc, prev + 1)
    return { from: pos, to: pos, index: prev + 1, approximate: false }
  }
  const next = nearest(anchorIndices(fps, nextFp, options.aliases), target)
  if (next !== null) {
    const pos = posOfIndex(doc, next)
    return { from: pos, to: pos, index: next, approximate: false }
  }
  if (!hunk.prev) return { from: 0, to: 0, index: 0, approximate: false }
  if (!hunk.next) {
    const pos = doc.content.size
    return { from: pos, to: pos, index: doc.childCount, approximate: false }
  }
  const index = Math.max(0, Math.min(target, doc.childCount))
  const pos = posOfIndex(doc, index)
  return { from: pos, to: pos, index, approximate: true }
}

// ─── applying ────────────────────────────────────────────────────────────────

/**
 * Replace the top-level range [from, to) with `nodes`, touching only what
 * differs. Returns false when nothing changes.
 */
export function replaceMinimal(tr: Transaction, from: number, to: number, nodes: PMNode[]): boolean {
  const schema = tr.doc.type.schema
  const oldFrag = tr.doc.slice(from, to).content
  const newFrag = Fragment.fromArray(nodes)
  if (!nodes.length) {
    if (from === to) return false
    if (from === 0 && to === tr.doc.content.size && schema.nodes.paragraph) {
      // A document can't be empty: leave one empty paragraph.
      tr.replaceWith(from, to, schema.nodes.paragraph.create())
    } else {
      tr.delete(from, to)
    }
    return true
  }
  if (from === to) {
    tr.insert(from, newFrag)
    return true
  }
  const start = oldFrag.findDiffStart(newFrag)
  if (start === null || start === undefined) return false
  const end = oldFrag.findDiffEnd(newFrag)
  if (!end) return false
  let { a: endA, b: endB } = end
  const overlap = start - Math.min(endA, endB)
  if (overlap > 0) {
    endA += overlap
    endB += overlap
  }
  const newDoc = tr.doc.type.create(null, newFrag)
  tr.replace(from + start, from + endA, newDoc.slice(start, endB))
  return true
}

export interface HunkTransaction {
  tr: Transaction
  located: LocatedHunk
}

/**
 * The transaction that applies (or reverts) one hunk in `state`, or null when
 * it can't be located or changes nothing. Image hunks are inserted by the
 * caller once their image exists (insertNodesAt).
 */
export function hunkTransaction(
  state: EditorState,
  hunk: AIEditorHunk,
  options: { direction?: 'apply' | 'revert'; aliases?: Aliases } = {}
): HunkTransaction | null {
  const schema = state.schema
  const located = locateHunk(state.doc, hunk, schema, options)
  if (!located) return null
  const nodes = nodesFromJSON(options.direction === 'revert' ? hunk.before : hunk.after, schema)
  const tr = state.tr
  if (!replaceMinimal(tr, located.from, located.to, nodes)) return null
  tr.setMeta(AI_ORIGIN_META, AI_ORIGIN)
  tr.setMeta('aiHunk', hunk.id)
  return { tr, located }
}

/** Insert ready-made blocks where an insert hunk goes (image suggestions). */
export function insertAtHunk(state: EditorState, hunk: AIEditorHunk, nodes: PMNode[], aliases?: Aliases): Transaction | null {
  const located = locateHunk(state.doc, { ...hunk, before: [] }, state.schema, { aliases })
  if (!located || !nodes.length) return null
  const tr = state.tr.insert(located.from, Fragment.fromArray(nodes))
  tr.setMeta(AI_ORIGIN_META, AI_ORIGIN)
  return tr
}

/** Plain text of hunk blocks, for previews and diffs. */
export function hunkText(list: JSONNode[] | null | undefined, schema: Schema, sep = '\n\n'): string {
  return nodesFromJSON(list, schema)
    .map((n) => n.textBetween(0, n.content.size, '\n', ' '))
    .filter((t) => t.trim())
    .join(sep)
}

