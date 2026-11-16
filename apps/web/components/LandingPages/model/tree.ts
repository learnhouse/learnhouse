/**
 * Immutable edits on a page document. Pure (unit tested). Nodes inside
 * symbols are found too: editing one edits every instance of the symbol.
 */
import { CONTAINER_TYPES, type LandingDoc, type LandingNode, type ResponsiveStyle, type StyleLayer, type Style } from './types'

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

export function newId(prefix = 'n'): string {
  let s = ''
  const bytes = typeof crypto !== 'undefined' && crypto.getRandomValues ? crypto.getRandomValues(new Uint8Array(8)) : Array.from({ length: 8 }, () => Math.floor(Math.random() * 256))
  for (const b of bytes) s += ALPHABET[b % ALPHABET.length]
  return `${prefix}_${s}`
}

export function reid(node: LandingNode): LandingNode {
  const copy = structuredClone(node)
  const visit = (n: LandingNode) => {
    n.id = newId()
    n.children?.forEach(visit)
  }
  visit(copy)
  delete copy.anchor
  return copy
}

export interface Location {
  /** Parent node id, or null for the page's top level (or a symbol root). */
  parentId: string | null
  index: number
  /** The symbol the node lives in, when it is part of one. */
  symbolId?: string
}

export function findNode(doc: LandingDoc, id: string): LandingNode | null {
  let hit: LandingNode | null = null
  walk(doc, (n) => {
    if (!hit && n.id === id) hit = n
  })
  return hit
}

export function locate(doc: LandingDoc, id: string): Location | null {
  const search = (nodes: LandingNode[], parentId: string | null, symbolId?: string): Location | null => {
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i]
      if (n.id === id) return { parentId, index: i, symbolId }
      const hit = search(n.children || [], n.id, symbolId)
      if (hit) return hit
    }
    return null
  }
  const top = search(doc.root, null)
  if (top) return top
  for (const [sid, sym] of Object.entries(doc.symbols || {})) {
    if (!sym?.node) continue
    const hit = search([sym.node], null, sid)
    if (hit) return hit
  }
  return null
}

/** Ancestors from the top down (not including the node). */
export function pathTo(doc: LandingDoc, id: string): LandingNode[] {
  const out: LandingNode[] = []
  const search = (nodes: LandingNode[], trail: LandingNode[]): boolean => {
    for (const n of nodes) {
      if (n.id === id) {
        out.push(...trail)
        return true
      }
      if (search(n.children || [], [...trail, n])) return true
    }
    return false
  }
  if (!search(doc.root, [])) {
    for (const sym of Object.values(doc.symbols || {})) if (sym?.node && search([sym.node], [])) break
  }
  return out
}

export function walk(doc: LandingDoc, fn: (n: LandingNode, parent: LandingNode | null) => void): void {
  const visit = (n: LandingNode, p: LandingNode | null) => {
    fn(n, p)
    n.children?.forEach((c) => visit(c, n))
  }
  doc.root.forEach((n) => visit(n, null))
  Object.values(doc.symbols || {}).forEach((s) => s?.node && visit(s.node, null))
}

export function countNodes(doc: LandingDoc): number {
  let n = 0
  walk(doc, () => n++)
  return n
}

/** Map every node through `fn` (return the same node to keep it). */
function mapTree(doc: LandingDoc, fn: (n: LandingNode) => LandingNode | null): LandingDoc {
  const mapList = (nodes: LandingNode[]): LandingNode[] => {
    let changed = false
    const out: LandingNode[] = []
    for (const n of nodes) {
      const m = fn(n)
      if (m === null) {
        changed = true
        continue
      }
      let next = m
      if (m.children) {
        const kids = mapList(m.children)
        if (kids !== m.children) next = { ...m, children: kids }
      }
      if (next !== n) changed = true
      out.push(next)
    }
    return changed ? out : nodes
  }
  const root = mapList(doc.root)
  let symbols = doc.symbols
  for (const [sid, sym] of Object.entries(doc.symbols || {})) {
    if (!sym?.node) continue
    const mapped = mapList([sym.node])
    if (mapped[0] !== sym.node) symbols = { ...symbols, [sid]: { ...sym, node: mapped[0] } }
  }
  return root === doc.root && symbols === doc.symbols ? doc : { ...doc, root, symbols }
}

export function updateNode(doc: LandingDoc, id: string, fn: (n: LandingNode) => LandingNode): LandingDoc {
  return mapTree(doc, (n) => (n.id === id ? fn(n) : n))
}

export function setProps(doc: LandingDoc, id: string, patch: Record<string, any>): LandingDoc {
  return updateNode(doc, id, (n) => ({ ...n, props: { ...n.props, ...patch } }))
}

/** Set (or with `undefined` remove) one style key on one layer. */
export function setStyle(doc: LandingDoc, id: string, layer: StyleLayer, key: keyof Style, value: unknown): LandingDoc {
  return updateNode(doc, id, (n) => ({ ...n, style: withStyle(n.style, layer, { [key]: value } as Partial<Style>) }))
}

export function withStyle(style: ResponsiveStyle | undefined, layer: StyleLayer, patch: Partial<Style>): ResponsiveStyle | undefined {
  const next: ResponsiveStyle = { ...(style || {}) }
  const cur: Record<string, unknown> = { ...(next[layer] || {}) }
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || v === null || v === '') delete cur[k]
    else cur[k] = v
  }
  if (Object.keys(cur).length) next[layer] = cur as Style
  else delete next[layer]
  return Object.keys(next).length ? next : undefined
}

export function removeNode(doc: LandingDoc, id: string): LandingDoc {
  return mapTree(doc, (n) => (n.id === id ? null : n))
}

/** Insert `node` into `parentId` (null: top level) at `index` (end when omitted). */
export function insertNode(doc: LandingDoc, node: LandingNode, parentId: string | null, index?: number): LandingDoc {
  if (parentId === null) {
    const root = [...doc.root]
    root.splice(index === undefined ? root.length : Math.max(0, Math.min(root.length, index)), 0, node)
    return { ...doc, root }
  }
  return updateNode(doc, parentId, (p) => {
    const kids = [...(p.children || [])]
    kids.splice(index === undefined ? kids.length : Math.max(0, Math.min(kids.length, index)), 0, node)
    return { ...p, children: kids }
  })
}

export function isInside(doc: LandingDoc, id: string, ancestorId: string): boolean {
  return pathTo(doc, id).some((n) => n.id === ancestorId)
}

export function moveNode(doc: LandingDoc, id: string, parentId: string | null, index: number): LandingDoc {
  if (parentId === id || (parentId && isInside(doc, parentId, id))) return doc
  const node = findNode(doc, id)
  const from = locate(doc, id)
  if (!node || !from) return doc
  let target = index
  if (from.parentId === parentId && from.index < index) target -= 1
  return insertNode(removeNode(doc, id), node, parentId, target)
}

export function duplicateNode(doc: LandingDoc, id: string): { doc: LandingDoc; id: string | null } {
  const node = findNode(doc, id)
  const loc = locate(doc, id)
  if (!node || !loc || loc.symbolId && loc.parentId === null) return { doc, id: null }
  const copy = reid(node)
  return { doc: insertNode(doc, copy, loc.parentId, loc.index + 1), id: copy.id }
}

/** Can `child` go inside `parent`? Sections only at the top level. */
export function canContain(parent: LandingNode | null, child: LandingNode): boolean {
  if (child.type === 'section' || child.type === 'symbol') return parent === null
  if (parent === null) return false
  return CONTAINER_TYPES.has(parent.type)
}

/** Wrap a non-section node into a section so it can sit at the top level. */
export function asSection(node: LandingNode): LandingNode {
  if (node.type === 'section' || node.type === 'symbol') return node
  return {
    id: newId(),
    type: 'section',
    props: { tag: 'section' },
    style: { base: { paddingTop: 64, paddingBottom: 64, paddingLeft: 24, paddingRight: 24 }, mobile: { paddingTop: 40, paddingBottom: 40, paddingLeft: 16, paddingRight: 16 } },
    children: [
      {
        id: newId(),
        type: 'container',
        props: {},
        style: { base: { maxWidth: 'content', marginLeft: 'auto', marginRight: 'auto', width: '100%', display: 'flex', flexDirection: 'column', gap: 24 } },
        children: [node],
      },
    ],
  }
}

/** Turn a node into a symbol and put an instance in its place. */
export function makeSymbol(doc: LandingDoc, id: string, name: string): { doc: LandingDoc; symbolId: string | null } {
  const node = findNode(doc, id)
  const loc = locate(doc, id)
  if (!node || !loc || loc.symbolId) return { doc, symbolId: null }
  let hasSymbol = false
  const check = (n: LandingNode) => {
    if (n.type === 'symbol') hasSymbol = true
    n.children?.forEach(check)
  }
  check(node)
  if (hasSymbol) return { doc, symbolId: null }
  const symbolId = newId('sym')
  const instance: LandingNode = { id: newId(), type: 'symbol', props: { symbolId }, name }
  const next = updateTreeReplace(doc, id, instance)
  return { doc: { ...next, symbols: { ...next.symbols, [symbolId]: { name, node } } }, symbolId }
}

function updateTreeReplace(doc: LandingDoc, id: string, replacement: LandingNode): LandingDoc {
  return mapTree(doc, (n) => (n.id === id ? replacement : n))
}

/** Replace a symbol instance with its own copy of the symbol's content. */
export function detachSymbol(doc: LandingDoc, instanceId: string): LandingDoc {
  const inst = findNode(doc, instanceId)
  const sym = inst && inst.type === 'symbol' ? doc.symbols?.[inst.props?.symbolId] : null
  if (!inst || !sym) return doc
  return updateTreeReplace(doc, instanceId, reid(sym.node))
}

/** Drop symbols nothing uses. */
export function pruneSymbols(doc: LandingDoc): LandingDoc {
  const used = new Set<string>()
  const visit = (n: LandingNode) => {
    if (n.type === 'symbol' && n.props?.symbolId) used.add(n.props.symbolId)
    n.children?.forEach(visit)
  }
  doc.root.forEach(visit)
  const keys = Object.keys(doc.symbols || {})
  if (keys.every((k) => used.has(k))) return doc
  return { ...doc, symbols: Object.fromEntries(Object.entries(doc.symbols).filter(([k]) => used.has(k))) }
}
