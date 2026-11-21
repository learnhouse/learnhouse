'use client'
/*
 Drag an item onto a drop target, with pointer events only (mouse, pen and
 touch), for the Sort and Match experiences. Native HTML5 drag and drop is
 avoided on purpose: ProseMirror handles every `drop` that reaches a node view.

 - Mouse / pen: the drag starts after a few pixels of movement.
 - Touch: the drag starts after a short press-and-hold, so a swipe over the
   items still scrolls the page; once dragging, page scrolling is blocked.
 - A press without a drag is left to the element's own click handler, which
   is the tap-to-select fallback (and what Enter / Space trigger).

 Items spread `itemProps(id)`. Drop targets carry `data-drop-target="<id>"`.
 `onDrop(itemId, targetId)` runs once on release over a target.
*/
import React from 'react'

export interface TapDragState {
  id: string
  x: number
  y: number
  over: string | null
}

const MOUSE_SLOP = 6
const TOUCH_SLOP = 10
const TOUCH_HOLD_MS = 180

export function useTapDrag({ onDrop, disabled }: { onDrop: (_id: string, _target: string) => void; disabled?: boolean }) {
  const [drag, setDrag] = React.useState<TapDragState | null>(null)
  const onDropRef = React.useRef(onDrop)
  React.useLayoutEffect(() => {
    onDropRef.current = onDrop
  })
  // A release that ended a drag must not also count as a tap.
  const swallowClick = React.useRef(false)
  const cleanupRef = React.useRef<(() => void) | null>(null)

  React.useEffect(() => () => cleanupRef.current?.(), [])

  const itemProps = (id: string) => ({
    'data-drag-id': id,
    draggable: false,
    onDragStart: (e: React.DragEvent) => e.preventDefault(),
    onClickCapture: (e: React.MouseEvent) => {
      if (swallowClick.current) {
        swallowClick.current = false
        e.preventDefault()
        e.stopPropagation()
      }
    },
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      if (disabled || e.button !== 0) return
      cleanupRef.current?.()
      const touch = e.pointerType === 'touch'
      const startX = e.clientX
      const startY = e.clientY
      const pointerId = e.pointerId
      let active = false
      let current: TapDragState | null = null
      let holdTimer: number | undefined
      const prevSelect = document.body.style.userSelect

      const targetAt = (x: number, y: number) => {
        const el = document.elementFromPoint(x, y) as HTMLElement | null
        return el?.closest<HTMLElement>('[data-drop-target]')?.getAttribute('data-drop-target') ?? null
      }
      const activate = (x: number, y: number) => {
        active = true
        document.body.style.userSelect = 'none'
        current = { id, x, y, over: targetAt(x, y) }
        setDrag(current)
      }
      const move = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return
        const dist = Math.hypot(ev.clientX - startX, ev.clientY - startY)
        if (!active) {
          if (touch) {
            // Moved before the hold finished: the user is scrolling.
            if (dist > TOUCH_SLOP) cleanup()
            return
          }
          if (dist > MOUSE_SLOP) activate(ev.clientX, ev.clientY)
          return
        }
        current = { id, x: ev.clientX, y: ev.clientY, over: targetAt(ev.clientX, ev.clientY) }
        setDrag(current)
      }
      const up = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return
        const ended = active ? current : null
        cleanup()
        if (ended) {
          swallowClick.current = true
          // Clear the flag if no click follows (release outside the item).
          window.setTimeout(() => (swallowClick.current = false), 0)
          if (ended.over) onDropRef.current(ended.id, ended.over)
        }
      }
      const cancel = (ev: PointerEvent) => {
        if (ev.pointerId === pointerId) cleanup()
      }
      // Touch: block page scrolling only once the drag is live.
      const touchMove = (ev: TouchEvent) => {
        if (active && ev.cancelable) ev.preventDefault()
      }
      const cleanup = () => {
        window.clearTimeout(holdTimer)
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        window.removeEventListener('pointercancel', cancel)
        document.removeEventListener('touchmove', touchMove)
        document.body.style.userSelect = prevSelect
        cleanupRef.current = null
        if (active) setDrag(null)
        active = false
      }
      cleanupRef.current = cleanup
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
      window.addEventListener('pointercancel', cancel)
      document.addEventListener('touchmove', touchMove, { passive: false })
      if (touch) holdTimer = window.setTimeout(() => activate(startX, startY), TOUCH_HOLD_MS)
    },
  })

  return { drag, itemProps }
}

/** Move focus to the previous / next element matching `selector` inside `scope` (arrow keys, RTL aware). */
export function focusSibling(e: React.KeyboardEvent<HTMLElement>, selector: string, scope?: HTMLElement | null): boolean {
  const horizontal = e.key === 'ArrowLeft' || e.key === 'ArrowRight'
  const vertical = e.key === 'ArrowUp' || e.key === 'ArrowDown'
  if (!horizontal && !vertical) return false
  const root = scope ?? (e.currentTarget.parentElement as HTMLElement | null)
  if (!root) return false
  const els = Array.from(root.querySelectorAll<HTMLElement>(selector))
  const i = els.indexOf(e.currentTarget)
  if (i < 0) return false
  const rtl = getComputedStyle(e.currentTarget).direction === 'rtl'
  let step = e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 1
  if (horizontal && rtl) step = -step
  const next = els[i + step]
  if (!next) return false
  e.preventDefault()
  next.focus()
  return true
}
