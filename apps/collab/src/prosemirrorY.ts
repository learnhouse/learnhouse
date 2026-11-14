// Schema-free conversion between ProseMirror JSON (what the API stores for an
// activity) and the Yjs XML structure y-prosemirror binds the editor to.
//
// The encoding mirrors y-prosemirror exactly, so a document seeded here is
// indistinguishable from one the editor wrote itself:
//   - an element node becomes a Y.XmlElement named after its type, its
//     non-null attrs stored as XML attributes;
//   - a run of consecutive text nodes becomes ONE Y.XmlText whose delta
//     carries the marks as attributes, `{[mark.type]: mark.attrs ?? {}}`;
//   - the editor's fragment is the doc's "default" XML fragment.
//
// y-prosemirror deletes any element the editor schema rejects, and that
// deletion syncs to everyone. So content is normalized here first, with the
// same fixes the editor applies before loading a stored document.

import * as Y from 'yjs'
import { yXmlFragmentToProsemirrorJSON as yToJSON } from 'y-prosemirror'
import * as sha256 from 'lib0/hash/sha256'
import * as buf from 'lib0/buffer'

/** The XML fragment Tiptap's Collaboration extension binds to by default. */
export const FRAGMENT_NAME = 'default'

export interface PMMark {
  type: string
  attrs?: Record<string, unknown> | null
}

export interface PMNode {
  type: string
  attrs?: Record<string, unknown> | null
  content?: PMNode[]
  marks?: PMMark[]
  text?: string
}

/** A ProseMirror document as the API stores it: `{type: 'doc', content}`. */
export function isProsemirrorDoc(value: unknown): value is PMNode {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as PMNode).type === 'doc' &&
    (!('content' in (value as object)) || Array.isArray((value as PMNode).content))
  )
}

/** What a brand-new (or empty) activity starts with in the editor. */
export function emptyDoc(): PMNode {
  return { type: 'doc', content: [{ type: 'paragraph' }] }
}

// ── Normalization (same fixes the web editor applies before loading) ────────

// TipTap names these marks bold/italic; AI-written content sometimes uses the
// HTML names. Mirrors normalizeMarkTypes in EditorWrapper.tsx.
const MARK_ALIASES: Record<string, string> = { strong: 'bold', em: 'italic' }

// Callouts hold paragraphs and lists. Older callouts stored their text
// directly; mirrors normalizeCalloutContent in Extensions/Callout.
const CALLOUT_BLOCK_TYPES = new Set(['paragraph', 'bulletList', 'orderedList'])

function normalizeCalloutChildren(children: PMNode[]): PMNode[] {
  const blocks: PMNode[] = []
  let inlineRun: PMNode[] = []
  const flushInline = () => {
    if (inlineRun.length > 0) {
      blocks.push({ type: 'paragraph', content: inlineRun })
      inlineRun = []
    }
  }
  for (const child of children) {
    if (CALLOUT_BLOCK_TYPES.has(child.type)) {
      flushInline()
      blocks.push(child)
    } else {
      inlineRun.push(child)
    }
  }
  flushInline()
  return blocks.length > 0 ? blocks : [{ type: 'paragraph' }]
}

function normalizeNode(node: unknown): PMNode | null {
  if (!node || typeof node !== 'object') return null
  const raw = node as PMNode
  if (typeof raw.type !== 'string' || raw.type === '') return null
  const out: PMNode = { type: raw.type }
  if (raw.attrs && typeof raw.attrs === 'object') out.attrs = raw.attrs
  if (raw.type === 'text') {
    if (typeof raw.text !== 'string' || raw.text === '') return null
    out.text = raw.text
    if (Array.isArray(raw.marks) && raw.marks.length > 0) {
      const marks: PMMark[] = []
      for (const mark of raw.marks) {
        if (!mark || typeof mark !== 'object' || typeof mark.type !== 'string') continue
        const type = MARK_ALIASES[mark.type] ?? mark.type
        marks.push(mark.attrs && typeof mark.attrs === 'object' ? { type, attrs: mark.attrs } : { type })
      }
      if (marks.length > 0) out.marks = marks
    }
    return out
  }
  if (Array.isArray(raw.content)) {
    const children = raw.content.map(normalizeNode).filter((c): c is PMNode => c !== null)
    out.content = raw.type === 'callout' ? normalizeCalloutChildren(children) : children
  } else if (raw.type === 'callout') {
    out.content = [{ type: 'paragraph' }]
  }
  return out
}

/**
 * Stored activity content made safe to seed: mark aliases fixed, legacy
 * callouts wrapped, malformed nodes dropped. Anything that is not a
 * ProseMirror doc (an empty `{}` activity included) becomes an empty doc.
 */
export function normalizeActivityContent(content: unknown): PMNode {
  if (!isProsemirrorDoc(content)) return emptyDoc()
  const doc = normalizeNode(content) as PMNode
  if (!doc.content || doc.content.length === 0) return emptyDoc()
  return doc
}

// ── JSON → Y ───────────────────────────────────────────────────────────────

function setAttributes(el: Y.XmlElement, attrs: PMNode['attrs']) {
  if (!attrs) return
  for (const [key, value] of Object.entries(attrs)) {
    // y-prosemirror never stores null attrs; the schema default fills them.
    if (value !== null && value !== undefined) {
      el.setAttribute(key, value as any)
    }
  }
}

// Marks whose schema lets them overlap themselves (`excludes: ''`).
export const OVERLAPPING_MARKS = new Set(['comment'])

// y-prosemirror's key for marks that may overlap themselves (several comment
// threads on the same text): `${type}--${hash}`, hash as in its utils.js.
function hashOfJSON(json: unknown): string {
  const digest = sha256.digest(buf.encodeAny(json))
  const N = 6
  for (let i = N; i < digest.length; i++) digest[i % N] = digest[i % N] ^ digest[i]
  return buf.toBase64(digest.slice(0, N))
}

function marksToAttributes(marks: PMMark[] | undefined): Record<string, unknown> | undefined {
  if (!marks || marks.length === 0) return undefined
  const counts = new Map<string, number>()
  for (const mark of marks) counts.set(mark.type, (counts.get(mark.type) ?? 0) + 1)
  const attributes: Record<string, unknown> = {}
  for (const mark of marks) {
    const attrs = mark.attrs ?? {}
    // Without the schema we can't tell which marks overlap: the known ones
    // (comment threads) and a type that appears twice on the same text get
    // hashed keys, as y-prosemirror writes them (it reads both forms back
    // to the plain mark name).
    const key =
      OVERLAPPING_MARKS.has(mark.type) || (counts.get(mark.type) ?? 0) > 1
        ? `${mark.type}--${hashOfJSON(Object.keys(attrs).length > 0 ? { type: mark.type, attrs } : { type: mark.type })}`
        : mark.type
    attributes[key] = attrs
  }
  return attributes
}

function textRunToY(run: PMNode[]): Y.XmlText {
  const ytext = new Y.XmlText()
  ytext.applyDelta(
    run.map((node) => {
      const attributes = marksToAttributes(node.marks)
      return attributes ? { insert: node.text ?? '', attributes } : { insert: node.text ?? '' }
    }),
  )
  return ytext
}

/** Y types for a node's children: element per node, one XmlText per text run. */
function childrenToY(children: PMNode[]): Array<Y.XmlElement | Y.XmlText> {
  const out: Array<Y.XmlElement | Y.XmlText> = []
  let run: PMNode[] = []
  const flush = () => {
    if (run.length > 0) {
      out.push(textRunToY(run))
      run = []
    }
  }
  for (const child of children) {
    if (child.type === 'text') {
      run.push(child)
    } else {
      flush()
      out.push(elementToY(child))
    }
  }
  flush()
  return out
}

function elementToY(node: PMNode): Y.XmlElement {
  const el = new Y.XmlElement(node.type)
  setAttributes(el, node.attrs)
  if (node.content && node.content.length > 0) {
    el.insert(0, childrenToY(node.content))
  }
  return el
}

/**
 * Writes `doc`'s children into `fragment`, replacing what it holds. Call
 * inside a transaction to apply it as one update.
 */
export function replaceFragmentContent(fragment: Y.XmlFragment, doc: PMNode) {
  if (fragment.length > 0) fragment.delete(0, fragment.length)
  const children = doc.content ?? []
  if (children.length > 0) fragment.insert(0, childrenToY(children))
}

/** A fresh Y.Doc holding `content` (normalized) in the editor's fragment. */
export function prosemirrorJSONToYDoc(content: unknown, ydoc: Y.Doc = new Y.Doc()): Y.Doc {
  const doc = normalizeActivityContent(content)
  ydoc.transact(() => {
    replaceFragmentContent(ydoc.getXmlFragment(FRAGMENT_NAME), doc)
  })
  return ydoc
}

// ── Y → JSON ───────────────────────────────────────────────────────────────

function cleanNode(node: any): PMNode {
  if (node.type === 'text') {
    const out: PMNode = { type: 'text', text: node.text }
    if (Array.isArray(node.marks) && node.marks.length > 0) {
      out.marks = node.marks.map((mark: any) =>
        mark.attrs && Object.keys(mark.attrs).length > 0
          ? { type: mark.type, attrs: mark.attrs }
          : { type: mark.type },
      )
    }
    return out
  }
  const out: PMNode = { type: node.type }
  if (node.attrs && Object.keys(node.attrs).length > 0) out.attrs = node.attrs
  if (Array.isArray(node.content)) {
    const children = node.content.filter((c: any) => c.type !== 'text' || c.text !== '').map(cleanNode)
    if (children.length > 0) out.content = children
  }
  return out
}

/**
 * The document's ProseMirror JSON, via y-prosemirror's own schema-free
 * serializer. Empty mark attrs are dropped, as ProseMirror's toJSON does.
 */
export function yDocToProsemirrorJSON(ydoc: Y.Doc): PMNode {
  const json = yToJSON(ydoc.getXmlFragment(FRAGMENT_NAME)) as any
  return cleanNode(json)
}

// ── Comparison ─────────────────────────────────────────────────────────────

/**
 * Canonical form for comparing documents: null attrs dropped (Y never stores
 * them; the editor schema restores their defaults), marks sorted by type,
 * adjacent text with identical marks merged, keys sorted. Two documents with
 * equal canonical JSON render identically in the editor.
 */
export function canonicalize(node: PMNode): PMNode {
  const out: any = { type: node.type }
  if (node.attrs) {
    const attrs: Record<string, unknown> = {}
    for (const key of Object.keys(node.attrs).sort()) {
      const value = node.attrs[key]
      if (value !== null && value !== undefined) attrs[key] = sortKeys(value)
    }
    if (Object.keys(attrs).length > 0) out.attrs = attrs
  }
  if (node.type === 'text') {
    out.text = node.text
    if (node.marks && node.marks.length > 0) {
      out.marks = [...node.marks]
        .map((m) => {
          const attrs = m.attrs && Object.keys(m.attrs).length > 0 ? sortKeys(m.attrs) : undefined
          return attrs ? { type: m.type, attrs } : { type: m.type }
        })
        .sort((a, b) => (a.type < b.type ? -1 : a.type > b.type ? 1 : 0))
    }
    return out
  }
  if (node.content && node.content.length > 0) {
    const merged: any[] = []
    for (const child of node.content.map(canonicalize)) {
      const prev = merged[merged.length - 1]
      if (
        prev &&
        prev.type === 'text' &&
        child.type === 'text' &&
        JSON.stringify(prev.marks ?? []) === JSON.stringify(child.marks ?? [])
      ) {
        prev.text += child.text
      } else {
        merged.push(child)
      }
    }
    out.content = merged
  }
  return out
}

function sortKeys(value: any): any {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (!value || typeof value !== 'object') return value
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(value).sort()) out[key] = sortKeys(value[key])
  return out
}

/** True when both documents render identically (see canonicalize). */
export function sameDocument(a: PMNode, b: PMNode): boolean {
  return JSON.stringify(canonicalize(a)) === JSON.stringify(canonicalize(b))
}

/** The doc as one Yjs update (what a client receives on first sync). */
export function encodeUpdate(ydoc: Y.Doc): Uint8Array {
  return Y.encodeStateAsUpdate(ydoc)
}
