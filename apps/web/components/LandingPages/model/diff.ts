/**
 * What changed between two versions of a page, by node id. Pure (unit tested).
 * Used before publishing (draft vs live) and to review Atlas edits.
 */
import type { LandingDoc, LandingNode } from './types'

export type ChangeKind = 'added' | 'removed' | 'changed' | 'moved'

export interface NodeChange {
  id: string
  kind: ChangeKind
  type: string
  label: string
  /** For "changed": which parts (props, style, settings). */
  parts?: string[]
}

export interface DocDiff {
  changes: NodeChange[]
  theme: boolean
  page: boolean
  /** Section ids, top to bottom, that carry any change (for canvas highlights). */
  ids: Set<string>
}

interface Entry {
  node: LandingNode
  parent: string | null
  index: number
}

function index(doc: LandingDoc | null | undefined): Map<string, Entry> {
  const map = new Map<string, Entry>()
  if (!doc) return map
  const visit = (nodes: LandingNode[], parent: string | null) => {
    nodes.forEach((n, i) => {
      map.set(n.id, { node: n, parent, index: i })
      if (n.children) visit(n.children, n.id)
    })
  }
  visit(doc.root || [], null)
  for (const [sid, sym] of Object.entries(doc.symbols || {})) if (sym?.node) visit([sym.node], `symbol:${sid}`)
  return map
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
}

export function labelOf(n: LandingNode): string {
  if (n.name) return n.name
  const p = n.props || {}
  const text = p.text || p.label || p.markdown || p.alt || ''
  return typeof text === 'string' && text ? text.slice(0, 60) : n.type
}

export function diffDocs(before: LandingDoc | null | undefined, after: LandingDoc | null | undefined): DocDiff {
  const a = index(before)
  const b = index(after)
  const changes: NodeChange[] = []
  const ids = new Set<string>()
  for (const [id, eb] of b) {
    const ea = a.get(id)
    if (!ea) {
      // Only report the top of an added subtree.
      if (!eb.parent || a.has(eb.parent) || eb.parent.startsWith('symbol:')) changes.push({ id, kind: 'added', type: eb.node.type, label: labelOf(eb.node) })
      ids.add(id)
      continue
    }
    const parts: string[] = []
    if (!same(ea.node.props, eb.node.props)) parts.push('content')
    if (!same(ea.node.style, eb.node.style)) parts.push('style')
    if (!same([ea.node.hidden, ea.node.visibility, ea.node.schedule, ea.node.animation, ea.node.anchor, ea.node.name], [eb.node.hidden, eb.node.visibility, eb.node.schedule, eb.node.animation, eb.node.anchor, eb.node.name])) parts.push('settings')
    if (parts.length) {
      changes.push({ id, kind: 'changed', type: eb.node.type, label: labelOf(eb.node), parts })
      ids.add(id)
    } else if (ea.parent !== eb.parent) {
      changes.push({ id, kind: 'moved', type: eb.node.type, label: labelOf(eb.node) })
      ids.add(id)
    }
  }
  for (const [id, ea] of a) {
    if (!b.has(id) && (!ea.parent || b.has(ea.parent) || ea.parent.startsWith('symbol:'))) changes.push({ id, kind: 'removed', type: ea.node.type, label: labelOf(ea.node) })
  }
  // Reordered top-level sections.
  const order = (d: LandingDoc | null | undefined) => (d?.root || []).map((n) => n.id).filter((id) => a.has(id) && b.has(id))
  const oa = order(before)
  const ob = order(after)
  if (!same(oa, ob)) {
    ob.forEach((id, i) => {
      if (oa[i] !== id && !changes.some((c) => c.id === id)) {
        const e = b.get(id)!
        changes.push({ id, kind: 'moved', type: e.node.type, label: labelOf(e.node) })
        ids.add(id)
      }
    })
  }
  return { changes, theme: !same(before?.theme, after?.theme), page: !same(before?.page, after?.page), ids }
}

export function isEmptyDiff(d: DocDiff): boolean {
  return d.changes.length === 0 && !d.theme && !d.page
}
