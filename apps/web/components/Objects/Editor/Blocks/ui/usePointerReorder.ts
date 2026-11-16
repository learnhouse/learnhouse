'use client'
/*
 Drag-to-reorder for items INSIDE a block (quiz options, quiz questions,
 flipcards in a grid), built on pointer events rather than native HTML5
 drag and drop: ProseMirror handles every native `drop` that reaches a node
 view and would try to paste the dragged data into the document.

 Usage: spread `gripProps(index, key)` on a small grip button. Items are the
 elements carrying `data-reorder-item` inside `containerRef`. Arrow keys on a
 focused grip move the item too (keyboard reordering), and focus follows it.
 Nothing is written while dragging: `onMove(from, to)` runs once on drop.
*/
import React from 'react'

type Axis = 'y' | 'xy'

export interface ReorderState {
  from: number
  over: number
}

export function usePointerReorder({
  containerRef,
  count,
  onMove,
  axis = 'y',
}: {
  containerRef: React.RefObject<HTMLElement | null>
  count: number
  onMove: (_from: number, _to: number) => void
  axis?: Axis
}) {
  const [drag, setDrag] = React.useState<ReorderState | null>(null)
  const dragRef = React.useRef<ReorderState | null>(null)
  const onMoveRef = React.useRef(onMove)
  React.useLayoutEffect(() => {
    onMoveRef.current = onMove
  })

  const items = () =>
    Array.from(containerRef.current?.querySelectorAll<HTMLElement>(':scope [data-reorder-item]') ?? []).filter(
      // Only this list's own items, not ones of a nested list.
      (el) => el.closest('[data-reorder-list]') === containerRef.current,
    )

  const targetFor = (x: number, y: number, from: number) => {
    const els = items()
    if (!els.length) return from
    if (axis === 'y') {
      // The final index is the number of other items above the pointer.
      let above = 0
      els.forEach((el, i) => {
        if (i === from) return
        const r = el.getBoundingClientRect()
        if (y > r.top + r.height / 2) above++
      })
      return Math.max(0, Math.min(els.length - 1, above))
    }
    // Grid: the item whose centre is nearest the pointer.
    let best = from
    let bestD = Infinity
    els.forEach((el, i) => {
      const r = el.getBoundingClientRect()
      const d = (x - (r.left + r.width / 2)) ** 2 + (y - (r.top + r.height / 2)) ** 2
      if (d < bestD) {
        bestD = d
        best = i
      }
    })
    return best
  }

  // Item count at event time (the list may have grown since the last render).
  const total = () => items().length || count

  // The grip's item index read from the DOM at event time: a node view isn't
  // re-rendered when only its position changes, so a render-time index can be stale.
  const indexOf = (el: HTMLElement, fallback: number) => {
    const item = el.closest<HTMLElement>('[data-reorder-item]')
    const i = item ? items().indexOf(item) : -1
    return i >= 0 ? i : fallback
  }

  const gripProps = (renderIndex: number, key: string) => ({
    'data-reorder-grip': key,
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      if (e.button !== 0 || total() < 2) return
      e.preventDefault()
      e.stopPropagation()
      const el = e.currentTarget
      const index = indexOf(el, renderIndex)
      try {
        el.setPointerCapture(e.pointerId)
      } catch {
        // Synthetic events (tests) have no active pointer.
      }
      const state = { from: index, over: index }
      dragRef.current = state
      setDrag(state)
      const move = (ev: PointerEvent) => {
        if (!dragRef.current) return
        const over = targetFor(ev.clientX, ev.clientY, dragRef.current.from)
        if (over !== dragRef.current.over) {
          dragRef.current = { ...dragRef.current, over }
          setDrag(dragRef.current)
        }
      }
      const end = (ev: PointerEvent) => {
        el.removeEventListener('pointermove', move)
        el.removeEventListener('pointerup', end)
        el.removeEventListener('pointercancel', end)
        const s = dragRef.current
        dragRef.current = null
        setDrag(null)
        if (s && ev.type === 'pointerup' && s.over !== s.from) onMoveRef.current(s.from, s.over)
      }
      el.addEventListener('pointermove', move)
      el.addEventListener('pointerup', end)
      el.addEventListener('pointercancel', end)
    },
    onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => {
      const back = e.key === 'ArrowUp' || (axis === 'xy' && e.key === 'ArrowLeft')
      const fwd = e.key === 'ArrowDown' || (axis === 'xy' && e.key === 'ArrowRight')
      if (!back && !fwd) return
      e.preventDefault()
      e.stopPropagation()
      const index = indexOf(e.currentTarget, renderIndex)
      // Arrow keys follow reading direction in a grid laid out right-to-left.
      const rtl = axis === 'xy' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && getComputedStyle(e.currentTarget).direction === 'rtl'
      const to = index + ((back ? -1 : 1) * (rtl ? -1 : 1))
      if (to < 0 || to >= total()) return
      const n = total()
      onMoveRef.current(index, to)
      // Moving a node in the DOM drops its focus: put it back on the grip of the
      // item now at `to` once the list has re-rendered (node views can take a
      // frame or two to remount).
      let tries = 10
      const refocus = () => {
        const els = items()
        const atTo = els.length === n ? els[to] : undefined
        // Prefer the same grip (stable key) once it sits at `to`; after a few
        // frames take whatever grip is there (a remounted node view).
        const same = atTo?.querySelector<HTMLElement>(`[data-reorder-grip="${CSS.escape(key)}"]`)
        const grip = same ?? (tries <= 4 ? atTo?.querySelector<HTMLElement>('[data-reorder-grip]') : null)
        if (grip) {
          if (document.activeElement !== grip) grip.focus()
        } else if (tries-- > 0) requestAnimationFrame(refocus)
      }
      requestAnimationFrame(refocus)
    },
    // Native drag would start a ProseMirror drag of the whole block.
    draggable: false,
    onDragStart: (e: React.DragEvent) => e.preventDefault(),
  })

  return { drag, gripProps }
}

/** Where the drop line goes for item `index` while dragging (vertical lists). */
export function dropEdge(drag: ReorderState | null, index: number): 'before' | 'after' | null {
  if (!drag || drag.over === drag.from || index !== drag.over) return null
  return drag.over < drag.from ? 'before' : 'after'
}
