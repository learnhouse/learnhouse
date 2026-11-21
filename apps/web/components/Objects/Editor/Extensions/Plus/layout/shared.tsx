'use client'
/*
 Small pieces the layout node views share.
*/
import React from 'react'
import type { NodeViewProps } from '@tiptap/react'
import { Fragment, type Node as PMNode } from '@tiptap/pm/model'
import { BookOpen, CheckCircle, Flag, Key, Lightbulb, Rocket, Star, Target } from '@phosphor-icons/react'
import type { LayoutIcon, LayoutTone } from './layoutModel'
import { TONE_CLASSES } from './base'

export { useHydrated, TONE_CLASSES } from './base'

/** Whether the node view sits in a real editor (false in StaticCanva / @learnhouse/react). */
export function hasLiveDoc(editor: NodeViewProps['editor']): boolean {
  return !!(editor as any)?.view?.dom
}

/** The node as it is in the document right now (attrs committed by collaborators included). */
export function liveNode(props: Pick<NodeViewProps, 'editor' | 'getPos' | 'node'>): { pos: number; node: PMNode } | null {
  const pos = typeof props.getPos === 'function' ? props.getPos() : undefined
  if (typeof pos !== 'number' || !hasLiveDoc(props.editor)) return null
  const node = props.editor.state.doc.nodeAt(pos)
  return node && node.type === props.node.type ? { pos, node } : null
}

/** Merge attrs into the live node (one write, only when something changes). */
export function commitAttrs(props: Pick<NodeViewProps, 'editor' | 'getPos' | 'node'>, attrs: Record<string, unknown>) {
  const live = liveNode(props)
  if (!live) return false
  const changed = Object.entries(attrs).some(([k, v]) => live.node.attrs[k] !== v)
  if (!changed) return false
  const tr = props.editor.state.tr.setNodeMarkup(live.pos, undefined, { ...live.node.attrs, ...attrs })
  props.editor.view.dispatch(tr)
  return true
}

/**
 * Replace the live node's children (JSON) in place, optionally with new attrs,
 * in one transaction. The node itself stays, so its view keeps its UI state.
 */
export function replaceChildren(props: Pick<NodeViewProps, 'editor' | 'getPos' | 'node'>, children: any[], attrs?: Record<string, unknown>) {
  const live = liveNode(props)
  if (!live) return false
  const { schema } = props.editor.state
  let fragment: Fragment
  try {
    fragment = Fragment.fromArray(children.map((c) => schema.nodeFromJSON(c)))
    if (!live.node.type.validContent(fragment)) return false
  } catch {
    return false
  }
  const tr = props.editor.state.tr.replaceWith(live.pos + 1, live.pos + live.node.nodeSize - 1, fragment)
  if (attrs) tr.setNodeMarkup(live.pos, undefined, { ...live.node.attrs, ...attrs })
  props.editor.view.dispatch(tr)
  return true
}

/** Document position of a child of the live node. */
export function childPos(parentPos: number, parent: PMNode, index: number): number {
  let pos = parentPos + 1
  for (let i = 0; i < index && i < parent.childCount; i++) pos += parent.child(i).nodeSize
  return pos
}

/** Merge attrs into one child of the live node. */
export function setChildAttrs(props: Pick<NodeViewProps, 'editor' | 'getPos' | 'node'>, index: number, attrs: Record<string, unknown>) {
  const live = liveNode(props)
  if (!live || index < 0 || index >= live.node.childCount) return false
  const child = live.node.child(index)
  if (!Object.entries(attrs).some(([k, v]) => child.attrs[k] !== v)) return false
  const pos = childPos(live.pos, live.node, index)
  props.editor.view.dispatch(props.editor.state.tr.setNodeMarkup(pos, undefined, { ...child.attrs, ...attrs }))
  return true
}

/** Append a child (JSON) at the end of the live node. */
export function appendChild(props: Pick<NodeViewProps, 'editor' | 'getPos' | 'node'>, json: any) {
  const live = liveNode(props)
  if (!live) return false
  try {
    const child = props.editor.state.schema.nodeFromJSON(json)
    const end = live.pos + live.node.nodeSize - 1
    props.editor.view.dispatch(props.editor.state.tr.insert(end, child))
    return true
  } catch {
    return false
  }
}

/** Remove one child of the live node (never below `min` children). */
export function removeChild(props: Pick<NodeViewProps, 'editor' | 'getPos' | 'node'>, index: number, min = 1) {
  const live = liveNode(props)
  if (!live || live.node.childCount <= min || index < 0 || index >= live.node.childCount) return false
  const pos = childPos(live.pos, live.node, index)
  props.editor.view.dispatch(props.editor.state.tr.delete(pos, pos + live.node.child(index).nodeSize))
  return true
}

export function childrenJSON(node: PMNode): any[] {
  const out: any[] = []
  node.forEach((child) => out.push(child.toJSON()))
  return out
}

export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

export function isRtl(el: Element | null): boolean {
  try {
    return !!el && getComputedStyle(el).direction === 'rtl'
  } catch {
    return false
  }
}

export const LAYOUT_ICON_COMPONENTS: Record<LayoutIcon, React.ElementType> = {
  lightbulb: Lightbulb,
  star: Star,
  check: CheckCircle,
  target: Target,
  flag: Flag,
  book: BookOpen,
  rocket: Rocket,
  key: Key,
}

/** A row of tone swatches for a settings popover. */
export function ToneSwatches({ value, onChange, label, toneLabel }: { value: LayoutTone | null; onChange: (_tone: LayoutTone) => void; label: string; toneLabel: (_tone: LayoutTone) => string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {(Object.keys(TONE_CLASSES) as LayoutTone[]).map((tone) => (
        <button
          key={tone}
          type="button"
          role="radio"
          aria-checked={value === tone}
          aria-label={toneLabel(tone)}
          title={toneLabel(tone)}
          onClick={() => onChange(tone)}
          className={`h-6 w-6 rounded-full ${TONE_CLASSES[tone].dot} outline-none ring-offset-2 ring-offset-white transition-shadow focus-visible:ring-2 focus-visible:ring-sky-500/50 ${value === tone ? 'ring-2 ring-neutral-900/70' : ''}`}
        />
      ))}
    </div>
  )
}

/** A labelled switch row for settings popovers. */
export function SwitchRow({ label, checked, onChange }: { label: React.ReactNode; checked: boolean; onChange: (_v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 text-xs font-medium text-neutral-600">
      <span>{label}</span>
      <input type="checkbox" className="h-3.5 w-3.5 accent-neutral-900" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  )
}
