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
// Showing: each pointer is re-anchored to the block it points at every frame
// (so it follows reflow and scrolling), chased by a spring for smooth motion
// (snapped when reduced motion is on) and faded out after a few idle seconds.
// The animation loop only runs while a pointer is visible.

import React from 'react'
import type { Editor } from '@tiptap/core'
import type { EditorView } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { CollabSession } from './collabRuntime'
import {
  type Box,
  type PointerAnchor,
  POINTER_IDLE_MS,
  fromAnchor,
  fromTextAnchor,
  movedEnough,
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
      if (active) raf = requestAnimationFrame(tick)
    }
    startLoop.current = () => {
      if (!raf) {
        last = performance.now()
        raf = requestAnimationFrame(tick)
      }
    }
    startLoop.current()
    return () => {
      if (raf) cancelAnimationFrame(raf)
      startLoop.current = () => {}
    }
  }, [editor, reducedMotion])

  // New elements get positioned on the next frame
  React.useEffect(() => {
    startLoop.current()
  }, [peers])

  return (
    <div ref={overlayRef} className="lh-collab-pointers" aria-hidden>
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
