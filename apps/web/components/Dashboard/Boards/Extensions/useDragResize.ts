import { useCallback, useRef } from 'react'

interface DragResizeOptions {
  x: number
  y: number
  width: number
  height: number
  minWidth?: number
  minHeight?: number
  updateAttributes: (attrs: Record<string, any>) => void
}

/**
 * Smooth drag & resize for board blocks.
 *
 * During mousemove we only touch the DOM directly (via style props) and
 * batch with rAF. updateAttributes (which triggers a TipTap transaction
 * and Yjs broadcast) is called once on mouseUp, eliminating stutter.
 */
export function useDragResize({
  x, y, width, height,
  minWidth = 200,
  minHeight = 120,
  updateAttributes,
}: DragResizeOptions) {
  const dragRef = useRef({ x: 0, y: 0, nodeX: 0, nodeY: 0 })
  const resizeRef = useRef({ x: 0, y: 0, w: 0, h: 0 })
  const rafId = useRef(0)
  const elRef = useRef<HTMLElement | null>(null)

  /** Find the NodeViewWrapper (outermost node-view element) from the event */
  const getWrapper = (e: React.MouseEvent): HTMLElement | null => {
    const target = e.currentTarget as HTMLElement
    let el: HTMLElement | null = target
    while (el && !el.hasAttribute('data-node-view-wrapper')) {
      el = el.parentElement
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
    e.stopPropagation()
    e.preventDefault()
    const el = getWrapper(e)
    elRef.current = el
    dragRef.current = { x: e.clientX, y: e.clientY, nodeX: x, nodeY: y }
    disableIframePointerEvents()

    const handleMove = (ev: MouseEvent) => {
      cancelAnimationFrame(rafId.current)
      rafId.current = requestAnimationFrame(() => {
        const newX = dragRef.current.nodeX + ev.clientX - dragRef.current.x
        const newY = dragRef.current.nodeY + ev.clientY - dragRef.current.y
        if (elRef.current) {
          elRef.current.style.left = `${newX}px`
          elRef.current.style.top = `${newY}px`
        }
      })
    }

    const handleUp = (ev: MouseEvent) => {
      cancelAnimationFrame(rafId.current)
      enableIframePointerEvents()
      const finalX = Math.round(dragRef.current.nodeX + ev.clientX - dragRef.current.x)
      const finalY = Math.round(dragRef.current.nodeY + ev.clientY - dragRef.current.y)
      updateAttributes({ x: finalX, y: finalY })
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }

    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
  }, [x, y, updateAttributes])

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    const el = getWrapper(e)
    elRef.current = el
    resizeRef.current = { x: e.clientX, y: e.clientY, w: width, h: height }
    disableIframePointerEvents()

    const handleMove = (ev: MouseEvent) => {
      cancelAnimationFrame(rafId.current)
      rafId.current = requestAnimationFrame(() => {
        const newW = Math.max(minWidth, resizeRef.current.w + ev.clientX - resizeRef.current.x)
        const newH = Math.max(minHeight, resizeRef.current.h + ev.clientY - resizeRef.current.y)
        if (elRef.current) {
          elRef.current.style.width = `${newW}px`
          elRef.current.style.height = `${newH}px`
        }
      })
    }

    const handleUp = (ev: MouseEvent) => {
      cancelAnimationFrame(rafId.current)
      enableIframePointerEvents()
      const finalW = Math.round(Math.max(minWidth, resizeRef.current.w + ev.clientX - resizeRef.current.x))
      const finalH = Math.round(Math.max(minHeight, resizeRef.current.h + ev.clientY - resizeRef.current.y))
      updateAttributes({ width: finalW, height: finalH })
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }

    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
  }, [width, height, minWidth, minHeight, updateAttributes])

  return { handleDragStart, handleResizeStart }
}
