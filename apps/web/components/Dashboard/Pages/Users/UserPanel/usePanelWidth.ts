'use client'
import { useEffect, useRef, useState } from 'react'
import type React from 'react'

// The panel's width on wide screens: about 60% of the viewport (720–1100px),
// resizable from its inner edge and remembered per browser. Below WIDE_MIN the
// panel is a full-screen sheet and none of this applies.

export const WIDE_MIN = 1024
const MIN = 720
const MAX = 1100
// Room left for the table behind it (sidebar + the name column).
const KEEP_VISIBLE = 360
const STORAGE_KEY = 'lh:user-panel-width'

const clamp = (w: number, vw: number) => Math.round(Math.max(MIN, Math.min(w, MAX, vw - KEEP_VISIBLE)))
const defaultWidth = (vw: number) => clamp(vw * 0.6, vw)

function readStored(): number | null {
  try {
    const v = Number(window.localStorage.getItem(STORAGE_KEY))
    return Number.isFinite(v) && v > 0 ? v : null
  } catch {
    return null
  }
}

function store(width: number | null) {
  try {
    if (width == null) window.localStorage.removeItem(STORAGE_KEY)
    else window.localStorage.setItem(STORAGE_KEY, String(width))
  } catch {
    // Private mode / blocked storage: the width just isn't remembered.
  }
}

export function usePanelWidth() {
  const [vw, setVw] = useState(() => (typeof window === 'undefined' ? 1440 : window.innerWidth))
  const [chosen, setChosen] = useState<number | null>(() => (typeof window === 'undefined' ? null : readStored()))
  const [dragging, setDragging] = useState(false)
  const dragRef = useRef<{ rtl: boolean } | null>(null)

  useEffect(() => {
    const onResize = () => setVw(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const wide = vw >= WIDE_MIN
  const width = chosen != null ? clamp(chosen, vw) : defaultWidth(vw)

  // Pointer capture keeps the drag on the handle even when the pointer leaves
  // it, so no window listeners (and no race with a re-render) are needed.
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return
    const next = dragRef.current.rtl ? e.clientX : window.innerWidth - e.clientX
    setChosen(clamp(next, window.innerWidth))
  }

  const stop = (e: React.PointerEvent) => {
    if (!dragRef.current) return
    dragRef.current = null
    setDragging(false)
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      // Already released.
    }
    document.body.style.removeProperty('cursor')
    document.body.style.removeProperty('user-select')
  }

  // Persist once a drag ends (not on every pointer move).
  const wasDragging = useRef(false)
  useEffect(() => {
    if (dragging) wasDragging.current = true
    else if (wasDragging.current) {
      wasDragging.current = false
      store(chosen)
    }
  }, [dragging, chosen])

  const lastDown = useRef(0)
  const startDrag = (e: React.PointerEvent) => {
    e.preventDefault()
    // A second press in quick succession is a double-click: back to the default.
    // (Detected here because preventing pointerdown can swallow dblclick.)
    const now = Date.now()
    if (now - lastDown.current < 350) {
      lastDown.current = 0
      setChosen(null)
      store(null)
      return
    }
    lastDown.current = now
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // Synthetic events without a live pointer.
    }
    dragRef.current = { rtl: document.documentElement.dir === 'rtl' }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    setDragging(true)
  }

  /** Handlers for the resize handle element. */
  const handleProps = {
    onPointerDown: startDrag,
    onPointerMove,
    onPointerUp: stop,
    onPointerCancel: stop,
    onDoubleClick: () => {
      setChosen(null)
      store(null)
    },
  }

  /** Keyboard resizing from the handle: arrows nudge, Home resets. */
  const onHandleKey = (e: React.KeyboardEvent) => {
    const rtl = document.documentElement.dir === 'rtl'
    const step = e.shiftKey ? 80 : 24
    let next: number | null = null
    if (e.key === 'ArrowLeft') next = width + (rtl ? -step : step)
    else if (e.key === 'ArrowRight') next = width + (rtl ? step : -step)
    else if (e.key === 'Home') {
      e.preventDefault()
      setChosen(null)
      store(null)
      return
    }
    if (next == null) return
    e.preventDefault()
    const w = clamp(next, vw)
    setChosen(w)
    store(w)
  }

  const reset = () => {
    setChosen(null)
    store(null)
  }

  return { wide, width, dragging, handleProps, onHandleKey, reset, min: MIN, max: Math.min(MAX, vw - KEEP_VISIBLE) }
}
