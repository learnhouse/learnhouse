'use client'

// Other editors' mouse pointers over the activity content, like on boards.
//
// Sending: while this user's mouse moves over the content column, the point
// under it is anchored to the document (top-level block + fractions, see
// pointerPresence.ts) and shared over Yjs awareness, batched with the caret
// to ~15 updates a second at most, only after a move of a few pixels. Nothing
// is sent while the mouse rests; the pointer is cleared when it leaves the
// content, the window loses focus or the tab is hidden. Touch and pen input
// never broadcast, and neither do read-only sessions (viewers, read-only
// impersonation; the server drops theirs too). Awareness is relayed in memory
// by the collab server and never stored, so this never triggers a save.
//
// Block focus: the top-level block this user has selected (a node selection)
// or is editing inside (focus in a block's own fields, like a quiz question)
// is shared too, and others see that block outlined in the user's colour
// with a name chip. It changes on clicks, so it costs a message per click.
//
// Showing: each pointer is re-anchored to the block it points at every frame
// (so it follows reflow and scrolling), chased by a spring for smooth motion
// (snapped when reduced motion is on) and faded out after a few idle seconds.
// The animation loop only runs while a pointer is visible.

import React from 'react'
import { useTranslation } from 'react-i18next'
import type { Editor } from '@tiptap/core'
import { NodeSelection } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { CollabSession } from './collabRuntime'
import {
  type Box,
  type PointerAnchor,
  POINTER_IDLE_MS,
  type RemoteBlock,
  fromAnchor,
  fromTextAnchor,
  movedEnough,
  remoteBlocks,
  remotePointers,
  stepSpring,
  toAnchor,
  withTextAnchor,
  type Spring,
} from './pointerPresence'
import './collab.css'

// Start position of each top-level block, per document version.
const offsetsCache = new WeakMap<PMNode, number[]>()

function blockOffsets(doc: PMNode): number[] {
  let offsets = offsetsCache.get(doc)
  if (!offsets) {
    offsets = []
    doc.forEach((_node, offset) => offsets!.push(offset))
    offsetsCache.set(doc, offsets)
  }
  return offsets
}

function boxOf(el: Element): Box {
  const r = el.getBoundingClientRect()
  return { left: r.left, top: r.top, width: r.width, height: r.height }
}

/** Screen box of top-level block `index` (the last one past the end). */
function blockBox(view: EditorView, index: number): Box | null {
  const doc = view.state.doc
  if (doc.childCount === 0) return null
  const offsets = blockOffsets(doc)
  const dom = view.nodeDOM(offsets[Math.min(index, offsets.length - 1)])
  return dom instanceof Element ? boxOf(dom) : null
}

/** The first top-level block whose bottom is at or below `y` (blocks stack vertically). */
function blockIndexAt(view: EditorView, y: number): number | null {
  const n = view.state.doc.childCount
  if (n === 0) return null
  let lo = 0
  let hi = n - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    const box = blockBox(view, mid)
    if (!box) return null
    if (y > box.top + box.height) lo = mid + 1
    else hi = mid
  }
  return lo
}

function anchorAt(view: EditorView, point: { x: number; y: number }) {
  const content = boxOf(view.dom)
  if (content.width <= 0) return null
  const index = blockIndexAt(view, point.y)
  if (index === null) return null
  const block = blockBox(view, index)
  if (!block) return null
  let anchor = toAnchor(index, point, content, block)
  // Over text: also anchor to the character under the pointer
  try {
    const hit = view.posAtCoords({ left: point.x, top: point.y })
    if (hit) {
      const $pos = view.state.doc.resolve(hit.pos)
      if ($pos.parent.inlineContent && $pos.depth > 0 && $pos.index(0) === index) {
        anchor = withTextAnchor(anchor, hit.pos, point, view.coordsAtPos(hit.pos))
      }
    }
  } catch {
    // Positions can be stale mid-update: the block anchor is enough
  }
  return { anchor, contentWidth: content.width, blockHeight: block.height }
}

/** Where a peer's anchor lands on this screen, or null when its block is gone. */
function targetOf(view: EditorView, anchor: PointerAnchor, content: Box): { x: number; y: number } | null {
  const doc = view.state.doc
  if (anchor.p !== undefined && anchor.p <= doc.content.size) {
    try {
      const $pos = doc.resolve(anchor.p)
      // Still inside the same block's text (the document may have changed since)
      if ($pos.parent.inlineContent && $pos.depth > 0 && $pos.index(0) === anchor.b) {
        return fromTextAnchor(anchor, view.coordsAtPos(anchor.p))
      }
    } catch {
      // fall back to the block anchor
    }
  }
  const block = blockBox(view, anchor.b)
  return block ? fromAnchor(anchor, content, block) : null
}

/**
 * The top-level block this user is working in, when it is more than plain
 * text editing (the caret shows that): a selected block, or focus inside a
 * block's own fields.
 */
function focusedBlock(view: EditorView): number | null {
  const { selection, doc } = view.state
  if (selection instanceof NodeSelection && selection.node.isBlock) {
    return doc.resolve(selection.from).index(0)
  }
  const active = document.activeElement
  if (!active || active === view.dom || !view.dom.contains(active)) return null
  // Inside ProseMirror's own editable text: the caret already shows it
  if ((active as HTMLElement).isContentEditable) return null
  try {
    const pos = view.posAtDOM(active, 0)
    return doc.childCount ? Math.min(doc.resolve(pos).index(0), doc.childCount - 1) : null
  } catch {
    return null
  }
}

interface Track {
  anchor: PointerAnchor | null
  spring: Spring
  lastMove: number
  /** Jump to the next position instead of gliding (new, or back after hiding). */
  snap: boolean
}

interface PeerLabel {
  clientId: number
  name: string
  color: string
}

const samePeerLabels = (a: PeerLabel[], b: PeerLabel[]) =>
  a.length === b.length && a.every((p, i) => p.clientId === b[i].clientId && p.name === b[i].name && p.color === b[i].color)

function usePrefersReducedMotion() {
  const ref = React.useRef(false)
  React.useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!mq) return
    ref.current = mq.matches
    const onChange = () => (ref.current = mq.matches)
    mq.addEventListener?.('change', onChange)
    return () => mq.removeEventListener?.('change', onChange)
  }, [])
  return ref
}

export default function RemotePointers({
  editor,
  session,
  canBroadcast,
}: {
  editor: Editor
  session: CollabSession
  /** False for read-only editors: they see pointers but never share theirs. */
  canBroadcast: boolean
}) {
  const overlayRef = React.useRef<HTMLDivElement>(null)
  const els = React.useRef(new Map<number, HTMLDivElement>())
  const tracks = React.useRef(new Map<number, Track>())
  const [peers, setPeers] = React.useState<PeerLabel[]>([])
  const [blocks, setBlocks] = React.useState<RemoteBlock[]>([])
  const blockEls = React.useRef(new Map<number, HTMLDivElement>())
  const blocksRef = React.useRef<RemoteBlock[]>([])
  const { t } = useTranslation()
  const reducedMotion = usePrefersReducedMotion()
  const startLoop = React.useRef<() => void>(() => {})

  // ── Sending ────────────────────────────────────────────────────────────
  React.useEffect(() => {
    if (!canBroadcast || editor.isDestroyed) return
    const view = editor.view
    const area = (view.dom.closest('.activity-editor-content-wrapper') as HTMLElement | null) ?? view.dom
    let point: { x: number; y: number } | null = null
    let sent: PointerAnchor | null = null
    let frame = 0

    const publish = () => {
      frame = 0
      if (!point || editor.isDestroyed || document.visibilityState === 'hidden' || session.getSnapshot().readOnly) return
      const hit = anchorAt(view, point)
      if (!hit || !movedEnough(sent, hit.anchor, hit.contentWidth, hit.blockHeight)) return
      sent = hit.anchor
      session.setPointer(hit.anchor)
    }
    // Layout is read at most once a frame, however fast the events come
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(publish)
    }
    const clear = () => {
      point = null
      if (frame) cancelAnimationFrame(frame)
      frame = 0
      if (sent) {
        sent = null
        session.setPointer(null)
      }
    }
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return
      point = { x: e.clientX, y: e.clientY }
      schedule()
    }
    // Scrolling moves the content under a resting mouse
    const onScroll = () => {
      if (point) schedule()
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') clear()
    }

    area.addEventListener('pointermove', onMove, { passive: true })
    area.addEventListener('pointerleave', clear)
    window.addEventListener('blur', clear)
    window.addEventListener('scroll', onScroll, { passive: true, capture: true })
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      area.removeEventListener('pointermove', onMove)
      area.removeEventListener('pointerleave', clear)
      window.removeEventListener('blur', clear)
      window.removeEventListener('scroll', onScroll, { capture: true })
      document.removeEventListener('visibilitychange', onVisibility)
      clear()
    }
  }, [editor, session, canBroadcast])

  // Block focus (selected block, or focus in a block's own fields)
  React.useEffect(() => {
    if (!canBroadcast || editor.isDestroyed) return
    const view = editor.view
    let sent: number | null = null
    let timer = 0
    const publish = () => {
      timer = 0
      if (editor.isDestroyed) return
      const b = session.getSnapshot().readOnly || document.visibilityState === 'hidden' ? null : focusedBlock(view)
      if (b === sent) return
      sent = b
      session.setBlock(b === null ? null : { b })
    }
    // focusout fires before the next focusin: settle first
    const schedule = () => {
      if (!timer) timer = window.setTimeout(publish, 50)
    }
    editor.on('selectionUpdate', schedule)
    editor.on('update', schedule)
    view.dom.addEventListener('focusin', schedule)
    view.dom.addEventListener('focusout', schedule)
    document.addEventListener('visibilitychange', schedule)
    return () => {
      editor.off('selectionUpdate', schedule)
      editor.off('update', schedule)
      view.dom.removeEventListener('focusin', schedule)
      view.dom.removeEventListener('focusout', schedule)
      document.removeEventListener('visibilitychange', schedule)
      if (timer) window.clearTimeout(timer)
      if (sent !== null) session.setBlock(null)
    }
  }, [editor, session, canBroadcast])

  // ── Receiving ──────────────────────────────────────────────────────────
  React.useEffect(() => {
    const awareness = session.provider.awareness
    if (!awareness) return
    const read = () => {
      const now = performance.now()
      const states = awareness.getStates() as Map<number, Record<string, any>>
      const list = remotePointers(states, awareness.clientID, session.user.id)
      const withPointer = new Set(list.map((p) => p.clientId))
      for (const p of list) {
        const tr = tracks.current.get(p.clientId)
        if (!tr) {
          tracks.current.set(p.clientId, { anchor: p.pointer, spring: { x: 0, y: 0, vx: 0, vy: 0 }, lastMove: now, snap: true })
        } else if (!tr.anchor || JSON.stringify(tr.anchor) !== JSON.stringify(p.pointer)) {
          if (!tr.anchor || now - tr.lastMove > POINTER_IDLE_MS) tr.snap = true
          tr.anchor = p.pointer
          tr.lastMove = now
        }
      }
      // Pointer cleared: hide it; left the room: forget it
      for (const [clientId, tr] of tracks.current) {
        if (!states.has(clientId)) tracks.current.delete(clientId)
        else if (!withPointer.has(clientId)) tr.anchor = null
      }
      const labels: PeerLabel[] = []
      for (const clientId of tracks.current.keys()) {
        const state = states.get(clientId)
        const peer = list.find((p) => p.clientId === clientId)
        labels.push({
          clientId,
          name: peer?.name ?? String(state?.user?.name ?? ''),
          color: peer?.color ?? '#64748b',
        })
      }
      labels.sort((a, b) => a.clientId - b.clientId)
      setPeers((prev) => (samePeerLabels(prev, labels) ? prev : labels))
      const nextBlocks = remoteBlocks(states, awareness.clientID, session.user.id)
      if (JSON.stringify(nextBlocks) !== JSON.stringify(blocksRef.current)) {
        blocksRef.current = nextBlocks
        setBlocks(nextBlocks)
      }
      startLoop.current()
    }
    awareness.on('change', read)
    read()
    return () => awareness.off('change', read)
  }, [session])

  // One animation loop for every pointer, running only while one shows
  React.useEffect(() => {
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      raf = 0
      const dt = Math.min(0.5, (now - last) / 1000)
      last = now
      const overlay = overlayRef.current
      if (!overlay || editor.isDestroyed) return
      const origin = overlay.getBoundingClientRect()
      const content = boxOf(editor.view.dom)
      let active = false
      for (const [clientId, tr] of tracks.current) {
        const el = els.current.get(clientId)
        if (!el) continue
        const target = tr.anchor ? targetOf(editor.view, tr.anchor, content) : null
        const visible = !!target && now - tr.lastMove < POINTER_IDLE_MS
        if (target) {
          const tx = target.x - origin.left
          const ty = target.y - origin.top
          let moving = false
          if (tr.snap || reducedMotion.current) {
            tr.spring = { x: tx, y: ty, vx: 0, vy: 0 }
            tr.snap = false
          } else {
            moving = stepSpring(tr.spring, tx, ty, dt)
          }
          el.style.transform = `translate3d(${tr.spring.x}px, ${tr.spring.y}px, 0)`
          if (visible || moving) active = true
        }
        if (!visible) tr.snap = true
        const opacity = visible ? '1' : '0'
        if (el.style.opacity !== opacity) el.style.opacity = opacity
      }
      // Outlines around the blocks others are working in (several people on
      // one block: their chips line up)
      const perBlock = new Map<number, number>()
      for (const rb of blocksRef.current) {
        const el = blockEls.current.get(rb.clientId)
        if (!el) continue
        const box = blockBox(editor.view, rb.b)
        if (!box || rb.b >= editor.view.state.doc.childCount) {
          el.style.opacity = '0'
          continue
        }
        const nth = perBlock.get(rb.b) ?? 0
        perBlock.set(rb.b, nth + 1)
        el.style.transform = `translate3d(${box.left - origin.left}px, ${box.top - origin.top}px, 0)`
        el.style.width = `${box.width}px`
        el.style.height = `${box.height}px`
        el.style.setProperty('--lh-chip-offset', `${nth * 22}px`)
        el.style.opacity = '1'
      }
      if (active) raf = requestAnimationFrame(tick)
    }
    startLoop.current = () => {
      if (!raf) {
        last = performance.now()
        raf = requestAnimationFrame(tick)
      }
    }
    startLoop.current()
    // Blocks move when the document or the layout changes
    const relayout = () => startLoop.current()
    editor.on('update', relayout)
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(relayout) : null
    if (!editor.isDestroyed) ro?.observe(editor.view.dom)
    return () => {
      if (raf) cancelAnimationFrame(raf)
      startLoop.current = () => {}
      editor.off('update', relayout)
      ro?.disconnect()
    }
  }, [editor, reducedMotion])

  // New elements get positioned on the next frame
  React.useEffect(() => {
    startLoop.current()
  }, [peers, blocks])

  return (
    <div ref={overlayRef} className="lh-collab-pointers" aria-hidden>
      {blocks.map((rb) => (
        <div
          key={`block-${rb.clientId}`}
          ref={(el) => {
            if (el) blockEls.current.set(rb.clientId, el)
            else blockEls.current.delete(rb.clientId)
          }}
          className="lh-collab-block"
          data-collab-block={rb.b}
          style={{ ['--lh-caret' as string]: rb.color, opacity: 0 }}
        >
          <span className="lh-collab-block__chip" dir="auto">
            {t('editor.collab.is_editing', '{{name}} is editing', { name: rb.name })}
          </span>
        </div>
      ))}
      {peers.map((p) => (
        <div
          key={p.clientId}
          ref={(el) => {
            if (el) els.current.set(p.clientId, el)
            else els.current.delete(p.clientId)
          }}
          className="lh-collab-pointer"
          data-collab-pointer={p.name}
          style={{ ['--lh-caret' as string]: p.color, opacity: 0 }}
        >
          <svg width="18" height="20" viewBox="0 0 20 22" fill="none" className="lh-collab-pointer__arrow">
            <path d="M2 1.5L7.6 20.2L10.6 12.4L18.4 10.2L2 1.5Z" fill={p.color} stroke="white" strokeWidth="1.6" strokeLinejoin="round" />
          </svg>
          <span className="lh-collab-pointer__label" dir="auto">
            {p.name}
          </span>
        </div>
      ))}
    </div>
  )
}
