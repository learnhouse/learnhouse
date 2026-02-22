import { useCallback, useLayoutEffect, useRef } from 'react'
import type { Editor } from '@tiptap/core'

interface FrameDragOptions {
  x: number
  y: number
  width: number
  height: number
  minWidth?: number
  minHeight?: number
  updateAttributes: (attrs: Record<string, any>) => void
  editor: Editor
  getPos: () => number
}

interface ChildSnapshot {
  pos: number
  startX: number
  startY: number
}

/** Find the NodeViewWrapper from an event target */
function getWrapper(e: React.MouseEvent): HTMLElement | null {
  let el: HTMLElement | null = e.currentTarget as HTMLElement
  while (el && !el.hasAttribute('data-node-view-wrapper')) {
    el = el.parentElement
  }
  return el
}

/** Walk up from a DOM node to find the [data-node-view-wrapper] ancestor */
function findWrapper(domNode: HTMLElement | null): HTMLElement | null {
  let el = domNode
  while (el && !el.hasAttribute('data-node-view-wrapper')) {
    el = el.parentElement
  }
  return el
}

/** Resolve a doc-level offset to its current wrapper DOM element */
function getWrapperForPos(editor: Editor, pos: number): HTMLElement | null {
  try {
    const dom = editor.view.nodeDOM(pos) as HTMLElement | null
    return findWrapper(dom)
  } catch {
    return null
  }
}

/** Get all blocks whose center falls inside the given frame bounds */
function getChildBlocks(
  editor: Editor,
  framePos: number,
  frameX: number,
  frameY: number,
  frameW: number,
  frameH: number
): ChildSnapshot[] {
  const children: ChildSnapshot[] = []

  editor.state.doc.forEach((node, offset) => {
    if (offset === framePos) return
    const attrs = node.attrs
    if (attrs.x == null || attrs.y == null) return

    const bx = attrs.x
    const by = attrs.y
    const bw = attrs.width || 0
    const bh = attrs.height || 0
    const centerX = bx + bw / 2
    const centerY = by + bh / 2

    if (
      centerX >= frameX &&
      centerX <= frameX + frameW &&
      centerY >= frameY &&
      centerY <= frameY + frameH
    ) {
      children.push({ pos: offset, startX: bx, startY: by })
    }
  })

  return children
}

/**
 * Drag hook for frame boxes — moves all contained children along with the frame.
 *
 * Key difference from useDragResize: we do NOT broadcast anything mid-drag.
 * All position updates happen purely via DOM manipulation during the drag,
 * and a single Yjs transaction commits everything on mouseUp. This avoids
 * React re-renders that would fight the DOM-direct movement.
 *
 * Child wrapper DOM elements are looked up fresh on every animation frame
 * via editor.view.nodeDOM() so they never go stale.
 */
export function useFrameDrag({
  x, y, width, height,
  minWidth = 200,
  minHeight = 200,
  updateAttributes,
  editor,
  getPos,
}: FrameDragOptions) {
  const dragRef = useRef({ x: 0, y: 0, nodeX: 0, nodeY: 0 })
  const resizeRef = useRef({ x: 0, y: 0, w: 0, h: 0 })
  const rafId = useRef(0)
  const elRef = useRef<HTMLElement | null>(null)
  const lastBroadcast = useRef(0)
  const childrenRef = useRef<ChildSnapshot[]>([])
  const interactionRef = useRef<'idle' | 'drag' | 'resize'>('idle')
  const livePos = useRef({ x: 0, y: 0 })
  const liveSize = useRef({ w: 0, h: 0 })
  const liveDelta = useRef({ dx: 0, dy: 0 })

  // After every React render, re-stamp DOM positions so Yjs re-renders
  // can't snap the frame or children back to stale attrs.
  useLayoutEffect(() => {
    if (interactionRef.current === 'drag') {
      // Re-stamp frame
      const frameEl = elRef.current
      if (frameEl) {
        frameEl.style.transition = 'none'
        frameEl.style.left = `${livePos.current.x}px`
        frameEl.style.top = `${livePos.current.y}px`
      }
      // Re-stamp all children with fresh DOM lookups
      const { dx, dy } = liveDelta.current
      childrenRef.current.forEach((child) => {
        const wrapper = getWrapperForPos(editor, child.pos)
        if (wrapper) {
          wrapper.style.transition = 'none'
          wrapper.style.left = `${child.startX + dx}px`
          wrapper.style.top = `${child.startY + dy}px`
        }
      })
    } else if (interactionRef.current === 'resize') {
      const frameEl = elRef.current
      if (frameEl) {
        frameEl.style.transition = 'none'
        frameEl.style.width = `${liveSize.current.w}px`
        frameEl.style.height = `${liveSize.current.h}px`
      }
    }
  })

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    const el = getWrapper(e)
    elRef.current = el
    dragRef.current = { x: e.clientX, y: e.clientY, nodeX: x, nodeY: y }
    livePos.current = { x, y }
    liveDelta.current = { dx: 0, dy: 0 }
    interactionRef.current = 'drag'
    if (el) el.style.transition = 'none'

    // Snapshot which children are inside the frame (positions only, no DOM refs)
    const framePos = getPos()
    childrenRef.current = getChildBlocks(editor, framePos, x, y, width, height)

    // Initial transition disable on children (fresh DOM lookup)
    childrenRef.current.forEach((child) => {
      const wrapper = getWrapperForPos(editor, child.pos)
      if (wrapper) wrapper.style.transition = 'none'
    })

    // Disable iframe pointer events on frame
    if (el) {
      el.querySelectorAll('iframe').forEach((iframe) => {
        ;(iframe as HTMLElement).style.pointerEvents = 'none'
      })
    }

    const handleMove = (ev: MouseEvent) => {
      cancelAnimationFrame(rafId.current)
      rafId.current = requestAnimationFrame(() => {
        const dx = ev.clientX - dragRef.current.x
        const dy = ev.clientY - dragRef.current.y
        const newX = dragRef.current.nodeX + dx
        const newY = dragRef.current.nodeY + dy

        // Store live values for useLayoutEffect re-stamping
        livePos.current = { x: newX, y: newY }
        liveDelta.current = { dx, dy }

        // Move frame via DOM
        if (elRef.current) {
          elRef.current.style.left = `${newX}px`
          elRef.current.style.top = `${newY}px`
        }

        // Move children via DOM — fresh wrapper lookup every frame
        childrenRef.current.forEach((child) => {
          const wrapper = getWrapperForPos(editor, child.pos)
          if (wrapper) {
            wrapper.style.transition = 'none'
            wrapper.style.left = `${child.startX + dx}px`
            wrapper.style.top = `${child.startY + dy}px`
          }
        })
      })
    }

    const handleUp = (ev: MouseEvent) => {
      cancelAnimationFrame(rafId.current)
      const dx = ev.clientX - dragRef.current.x
      const dy = ev.clientY - dragRef.current.y
      const finalX = Math.round(dragRef.current.nodeX + dx)
      const finalY = Math.round(dragRef.current.nodeY + dy)

      interactionRef.current = 'idle'

      // Re-enable transitions
      if (elRef.current) elRef.current.style.transition = ''
      childrenRef.current.forEach((child) => {
        const wrapper = getWrapperForPos(editor, child.pos)
        if (wrapper) wrapper.style.transition = ''
      })

      // Re-enable iframe pointer events
      if (elRef.current) {
        elRef.current.querySelectorAll('iframe').forEach((iframe) => {
          ;(iframe as HTMLElement).style.pointerEvents = ''
        })
      }

      // Single Yjs transaction: commit frame + all children positions
      editor.chain().command(({ tr }) => {
        const frameNodePos = getPos()
        const frameNode = tr.doc.nodeAt(frameNodePos)
        if (frameNode) {
          tr.setNodeMarkup(frameNodePos, undefined, {
            ...frameNode.attrs,
            x: finalX,
            y: finalY,
          })
        }
        childrenRef.current.forEach((child) => {
          const childNode = tr.doc.nodeAt(child.pos)
          if (childNode) {
            tr.setNodeMarkup(child.pos, undefined, {
              ...childNode.attrs,
              x: Math.round(child.startX + dx),
              y: Math.round(child.startY + dy),
            })
          }
        })
        return true
      }).run()

      childrenRef.current = []
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }

    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
  }, [x, y, width, height, updateAttributes, editor, getPos])

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    const el = getWrapper(e)
    elRef.current = el
    resizeRef.current = { x: e.clientX, y: e.clientY, w: width, h: height }
    liveSize.current = { w: width, h: height }
    interactionRef.current = 'resize'
    lastBroadcast.current = 0
    if (el) el.style.transition = 'none'

    const handleMove = (ev: MouseEvent) => {
      cancelAnimationFrame(rafId.current)
      rafId.current = requestAnimationFrame(() => {
        const newW = Math.max(minWidth, resizeRef.current.w + ev.clientX - resizeRef.current.x)
        const newH = Math.max(minHeight, resizeRef.current.h + ev.clientY - resizeRef.current.y)
        liveSize.current = { w: newW, h: newH }
        if (elRef.current) {
          elRef.current.style.width = `${newW}px`
          elRef.current.style.height = `${newH}px`
        }

        const now = performance.now()
        if (now - lastBroadcast.current >= 800) {
          lastBroadcast.current = now
          updateAttributes({ width: Math.round(newW), height: Math.round(newH) })
        }
      })
    }

    const handleUp = (ev: MouseEvent) => {
      cancelAnimationFrame(rafId.current)
      const finalW = Math.round(Math.max(minWidth, resizeRef.current.w + ev.clientX - resizeRef.current.x))
      const finalH = Math.round(Math.max(minHeight, resizeRef.current.h + ev.clientY - resizeRef.current.y))
      interactionRef.current = 'idle'
      if (elRef.current) elRef.current.style.transition = ''
      updateAttributes({ width: finalW, height: finalH })
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }

    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
  }, [width, height, minWidth, minHeight, updateAttributes])

  return { handleDragStart, handleResizeStart }
}
