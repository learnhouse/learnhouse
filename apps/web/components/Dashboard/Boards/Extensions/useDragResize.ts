import { useCallback, useLayoutEffect, useRef } from 'react'
import { useBoardSelection } from '../BoardSelectionContext'

interface DragResizeOptions {
  x: number
  y: number
  width: number
  height: number
  minWidth?: number
  minHeight?: number
  updateAttributes: (attrs: Record<string, any>) => void
  editor?: any
  /** Current node's position getter (from TipTap NodeView) */
  getPos?: () => number
}

// How often to broadcast position to remote users (ms).
// Keep low to reduce server load — CSS transition on the remote
// side bridges the gap so movement still looks fluid.
const BROADCAST_INTERVAL = 800

/**
 * Smooth drag & resize for board blocks.
 *
 * During mousemove we touch the DOM directly (via style props) and
 * batch with rAF for smooth local movement. updateAttributes (which
 * triggers a TipTap transaction and Yjs broadcast) is called:
 *   - Throttled every ~80ms during drag/resize so remote users see
 *     smooth, continuous movement instead of one big jump.
 *   - Once on mouseUp for the final pixel-perfect position.
 *
 * A useLayoutEffect re-stamps the DOM-direct values after every React
 * render so that Yjs-triggered re-renders cannot snap the block back
 * to stale node.attrs during an active drag or resize.
 *
 * A CSS rule in globals.css applies a spring-like transition to all
 * [data-node-view-wrapper] elements inside .board-editor, so remote
 * position/size changes (via Yjs) animate smoothly between broadcasts.
 * During local drag/resize, inline `transition: none` overrides the CSS.
 */
/** Check if a block's center is inside any locked frameBox */
function isInsideLockedFrame(
  editor: any,
  blockX: number,
  blockY: number,
  blockW: number,
  blockH: number
): boolean {
  const centerX = blockX + blockW / 2
  const centerY = blockY + blockH / 2
  let locked = false

  editor.state.doc.forEach((node: any) => {
    if (locked) return
    if (node.type.name === 'frameBox' && node.attrs.locked) {
      const fx = node.attrs.x
      const fy = node.attrs.y
      const fw = node.attrs.width
      const fh = node.attrs.height
      if (centerX >= fx && centerX <= fx + fw && centerY >= fy && centerY <= fy + fh) {
        locked = true
      }
    }
  })

  return locked
}

export function useDragResize({
  x, y, width, height,
  minWidth = 200,
  minHeight = 120,
  updateAttributes,
  editor,
  getPos,
}: DragResizeOptions) {
  const { selectedPositions } = useBoardSelection()
  const dragRef = useRef({ x: 0, y: 0, nodeX: 0, nodeY: 0 })
  const resizeRef = useRef({ x: 0, y: 0, w: 0, h: 0 })
  const rafId = useRef(0)
  const elRef = useRef<HTMLElement | null>(null)
  const lastBroadcast = useRef(0)

  // Track active interaction type without causing re-renders
  const interactionRef = useRef<'idle' | 'drag' | 'resize'>('idle')
  // Track the latest DOM-direct values during interaction
  const livePos = useRef({ x: 0, y: 0 })
  const liveSize = useRef({ w: 0, h: 0 })

  // Multi-drag: peer elements & their start positions
  const peersRef = useRef<{ el: HTMLElement; startX: number; startY: number; pos: number }[]>([])

  // After every React render, re-stamp the DOM-direct values so that
  // Yjs-triggered re-renders (which reapply node.attrs) can't snap back.
  // Also manage the CSS transition based on interaction state.
  useLayoutEffect(() => {
    const el = elRef.current
    if (!el) return

    if (interactionRef.current === 'drag') {
      el.style.transition = 'none'
      el.style.left = `${livePos.current.x}px`
      el.style.top = `${livePos.current.y}px`
    } else if (interactionRef.current === 'resize') {
      el.style.transition = 'none'
      el.style.width = `${liveSize.current.w}px`
      el.style.height = `${liveSize.current.h}px`
    }
    // When idle, the CSS rule in globals.css handles the transition —
    // no inline style needed (clearing it lets CSS take over).
  })

  /** Find the NodeViewWrapper (outermost node-view element) from the event */
  const getWrapper = (e: React.MouseEvent): HTMLElement | null => {
    // Walk from both target and currentTarget to find the wrapper
    let el: HTMLElement | null = e.currentTarget as HTMLElement
    while (el && !el.hasAttribute('data-node-view-wrapper')) {
      el = el.parentElement
    }
    if (!el) {
      // Fallback: try from e.target (handles positioned-outside children)
      el = e.target as HTMLElement
      while (el && !el.hasAttribute('data-node-view-wrapper')) {
        el = el.parentElement
      }
    }
    return el
  }

  /** Disable pointer events on iframes inside the wrapper so they don't steal mouse events */
  const disableIframePointerEvents = () => {
    if (!elRef.current) return
    const iframes = elRef.current.querySelectorAll('iframe')
    iframes.forEach((iframe) => { (iframe as HTMLElement).style.pointerEvents = 'none' })
  }

  /** Re-enable pointer events on iframes */
  const enableIframePointerEvents = () => {
    if (!elRef.current) return
    const iframes = elRef.current.querySelectorAll('iframe')
    iframes.forEach((iframe) => { (iframe as HTMLElement).style.pointerEvents = '' })
  }

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    // Block drag if inside a locked frame
    if (editor && isInsideLockedFrame(editor, x, y, width, height)) {
      return
    }
    e.stopPropagation()
    e.preventDefault()
    const el = getWrapper(e)
    elRef.current = el
    dragRef.current = { x: e.clientX, y: e.clientY, nodeX: x, nodeY: y }
    livePos.current = { x, y }
    interactionRef.current = 'drag'
    lastBroadcast.current = 0
    if (el) el.style.transition = 'none'
    disableIframePointerEvents()

    // Multi-drag: find peer selected elements
    peersRef.current = []
    const myPos = getPos?.()
    if (editor && selectedPositions && selectedPositions.size > 1 && myPos != null && selectedPositions.has(myPos)) {
      const boardEl = el?.closest('.board-editor')
      if (boardEl) {
        const allWrappers = boardEl.querySelectorAll('[data-node-view-wrapper]')
        // Build a map of position → node attrs
        const peerPositions = new Set(selectedPositions)
        peerPositions.delete(myPos)

        // For each peer position, find its DOM element
        for (const peerPos of peerPositions) {
          const node = editor.state.doc.nodeAt(peerPos)
          if (!node) continue
          const peerX = node.attrs.x ?? 0
          const peerY = node.attrs.y ?? 0

          // Find the wrapper by matching its style left/top to the node's x/y
          for (const wrapper of allWrappers) {
            const wEl = wrapper as HTMLElement
            if (wEl === el) continue
            const wLeft = parseFloat(wEl.style.left) || 0
            const wTop = parseFloat(wEl.style.top) || 0
            if (Math.abs(wLeft - peerX) < 2 && Math.abs(wTop - peerY) < 2) {
              wEl.style.transition = 'none'
              peersRef.current.push({ el: wEl, startX: peerX, startY: peerY, pos: peerPos })
              break
            }
          }
        }
      }
    }

    const handleMove = (ev: MouseEvent) => {
      cancelAnimationFrame(rafId.current)
      rafId.current = requestAnimationFrame(() => {
        const dx = ev.clientX - dragRef.current.x
        const dy = ev.clientY - dragRef.current.y
        const newX = dragRef.current.nodeX + dx
        const newY = dragRef.current.nodeY + dy
        livePos.current = { x: newX, y: newY }
        if (elRef.current) {
          elRef.current.style.left = `${newX}px`
          elRef.current.style.top = `${newY}px`
        }

        // Move peers by same delta
        for (const peer of peersRef.current) {
          peer.el.style.left = `${peer.startX + dx}px`
          peer.el.style.top = `${peer.startY + dy}px`
        }

        // Throttled broadcast so remote users see smooth movement
        const now = performance.now()
        if (now - lastBroadcast.current >= BROADCAST_INTERVAL) {
          lastBroadcast.current = now
          updateAttributes({ x: Math.round(newX), y: Math.round(newY) })
          // Broadcast peer positions too
          if (editor && peersRef.current.length > 0) {
            editor.chain().command(({ tr }: any) => {
              for (const peer of peersRef.current) {
                const node = tr.doc.nodeAt(peer.pos)
                if (node) {
                  tr.setNodeMarkup(peer.pos, undefined, {
                    ...node.attrs,
                    x: Math.round(peer.startX + dx),
                    y: Math.round(peer.startY + dy),
                  })
                }
              }
              return true
            }).run()
          }
        }
      })
    }

    const handleUp = (ev: MouseEvent) => {
      cancelAnimationFrame(rafId.current)
      enableIframePointerEvents()
      const dx = ev.clientX - dragRef.current.x
      const dy = ev.clientY - dragRef.current.y
      const finalX = Math.round(dragRef.current.nodeX + dx)
      const finalY = Math.round(dragRef.current.nodeY + dy)
      interactionRef.current = 'idle'
      if (elRef.current) elRef.current.style.transition = ''
      updateAttributes({ x: finalX, y: finalY })

      // Finalize peer positions
      if (editor && peersRef.current.length > 0) {
        editor.chain().command(({ tr }: any) => {
          for (const peer of peersRef.current) {
            peer.el.style.transition = ''
            const node = tr.doc.nodeAt(peer.pos)
            if (node) {
              tr.setNodeMarkup(peer.pos, undefined, {
                ...node.attrs,
                x: Math.round(peer.startX + dx),
                y: Math.round(peer.startY + dy),
              })
            }
          }
          return true
        }).run()
      }
      peersRef.current = []

      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }

    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
  }, [x, y, width, height, updateAttributes, editor, selectedPositions, getPos])

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
    disableIframePointerEvents()

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

        // Throttled broadcast so remote users see smooth movement
        const now = performance.now()
        if (now - lastBroadcast.current >= BROADCAST_INTERVAL) {
          lastBroadcast.current = now
          updateAttributes({ width: Math.round(newW), height: Math.round(newH) })
        }
      })
    }

    const handleUp = (ev: MouseEvent) => {
      cancelAnimationFrame(rafId.current)
      enableIframePointerEvents()
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
