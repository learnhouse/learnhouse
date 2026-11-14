'use client'
import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import {
  SIDEBAR_COLLAPSED_WIDTH,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  keyboardResize,
  resolveDragWidth,
  setSidebarPrefs,
  type SidebarPrefs,
} from './sidebarWidth'

const RESIZING_CLASS = 'lh-sidebar-resizing'

/**
 * Drag handle on the sidebar's inline-end edge (the left edge in RTL).
 * While dragging it writes the width straight onto the sidebar element, so
 * the long menu doesn't re-render on every pointer move; the final width is
 * saved on release. Drag far enough in and it snaps to the icon rail.
 * Double-click resets. It is also a keyboard-operable window splitter.
 */
export default function SidebarResizeHandle({
  navRef,
  prefs,
  onDraggingChange,
}: {
  navRef: React.RefObject<HTMLElement | null>
  prefs: SidebarPrefs
  onDraggingChange: (_dragging: boolean) => void
}) {
  const { t } = useTranslation()
  const [dragging, setDragging] = useState(false)
  const cleanupRef = useRef<(() => void) | null>(null)

  // Leaving the page mid-drag must not strand the global cursor class.
  useEffect(() => () => cleanupRef.current?.(), [])

  const isRTL = () => {
    const el = navRef.current
    return !!el && getComputedStyle(el).direction === 'rtl'
  }

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const nav = navRef.current
    if (e.button !== 0 || !nav) return
    e.preventDefault()
    const handle = e.currentTarget
    const pointerId = e.pointerId
    const rtl = isRTL()
    const startX = e.clientX
    const startWidth = prefs.collapsed ? SIDEBAR_COLLAPSED_WIDTH : prefs.width
    let last: SidebarPrefs = prefs
    let liveCollapsed = prefs.collapsed
    let moved = false
    let frame = 0

    try {
      handle.setPointerCapture(pointerId)
    } catch {
      /* capture is a nicety; window listeners below still track the drag */
    }
    document.documentElement.classList.add(RESIZING_CLASS)
    setDragging(true)
    onDraggingChange(true)

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return
      const dx = ev.clientX - startX
      if (!moved && Math.abs(dx) < 2) return
      moved = true
      // An expanded drag starts from the visible width, a collapsed one from
      // the rail, so the snap point is the same in both directions.
      const next = resolveDragWidth(startWidth, dx, rtl)
      // Snapped shut: remember the width it was open at, for reopening.
      if (next.collapsed) next.width = prefs.width
      last = next
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        // Crossing the snap point re-renders the menu (labels on or off);
        // saving the width with it keeps that render in step with the drag.
        if (next.collapsed !== liveCollapsed) {
          liveCollapsed = next.collapsed
          setSidebarPrefs(next)
        }
        nav.style.width = `${next.collapsed ? SIDEBAR_COLLAPSED_WIDTH : next.width}px`
      })
    }

    const finish = () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      document.documentElement.classList.remove(RESIZING_CLASS)
      try {
        handle.releasePointerCapture(pointerId)
      } catch {
        /* already released */
      }
      cleanupRef.current = null
      setDragging(false)
      onDraggingChange(false)
    }

    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return
      finish()
      if (moved) setSidebarPrefs(last)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    cleanupRef.current = finish
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const next = keyboardResize(e.key, { ...prefs, rtl: isRTL(), large: e.shiftKey })
    if (!next) return
    e.preventDefault()
    setSidebarPrefs(next)
  }

  const valueNow = prefs.collapsed ? SIDEBAR_COLLAPSED_WIDTH : prefs.width

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={t('dashboard.nav.resize_sidebar', { defaultValue: 'Resize sidebar' })}
      aria-valuemin={SIDEBAR_COLLAPSED_WIDTH}
      aria-valuemax={SIDEBAR_MAX_WIDTH}
      aria-valuenow={valueNow}
      tabIndex={0}
      data-dragging={dragging || undefined}
      onPointerDown={onPointerDown}
      onDoubleClick={() => setSidebarPrefs({ width: SIDEBAR_DEFAULT_WIDTH, collapsed: false })}
      onKeyDown={onKeyDown}
      className="group/resize absolute inset-y-0 -end-1.5 z-10 w-3 cursor-col-resize touch-none select-none outline-none"
    >
      {/* The visible line sits on the sidebar's border and lights up on
          hover (after a beat, so passing pointers don't flash it), focus and
          drag. */}
      <span
        aria-hidden="true"
        className={cn(
          'absolute inset-y-0 start-[5px] w-[2px] rounded-full transition-colors duration-150',
          'group-hover/resize:bg-white/25 group-hover/resize:delay-150',
          'group-focus-visible/resize:bg-white/60',
          dragging && 'bg-white/50'
        )}
      />
    </div>
  )
}
