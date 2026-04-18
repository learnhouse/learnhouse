'use client'

import React, { useEffect, useRef, useCallback } from 'react'
import type { HocuspocusProvider } from '@hocuspocus/provider'

interface CursorData {
  clientId: number
  name: string
  color: string
  x: number
  y: number
  lastUpdate: number
  chatBubble: { text: string; timestamp: number } | null
}

interface RemoteCursorsProps {
  provider: HocuspocusProvider
  canvasRef: React.RefObject<HTMLDivElement | null>
  pan: { x: number; y: number }
  zoom: number
}

/** Throttle interval for broadcasting local cursor position (ms) */
const CURSOR_BROADCAST_INTERVAL = 300
/** Stale cursor timeout (ms) */
const STALE_CURSOR_TIMEOUT = 10000
/** Chat bubble display time (ms) */
const BUBBLE_DISPLAY_TIME = 4000

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const DEFAULT_CURSOR_COLOR = '#958DF1'

// Peers set their color via awareness. We interpolate it into innerHTML/SVG
// markup, so reject anything that isn't a plain hex code to prevent a
// collaborator from injecting attributes or markup via the color field.
function sanitizeColor(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_CURSOR_COLOR
  return /^#[0-9a-fA-F]{3,8}$/.test(value) ? value : DEFAULT_CURSOR_COLOR
}

export default function RemoteCursors({ provider, canvasRef, pan, zoom }: RemoteCursorsProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const cursorsRef = useRef<Map<number, CursorData>>(new Map())
  const rafRef = useRef<number>(0)
  const lastBroadcastRef = useRef(0)
  const pendingCursorRef = useRef<{ x: number; y: number } | null>(null)
  const broadcastRafRef = useRef<number>(0)

  // Keep latest pan/zoom in refs so event handlers don't need to re-bind
  const panRef = useRef(pan)
  const zoomRef = useRef(zoom)
  panRef.current = pan
  zoomRef.current = zoom

  // Broadcast local cursor position — throttled to CURSOR_BROADCAST_INTERVAL
  const flushCursorBroadcast = useCallback(() => {
    broadcastRafRef.current = 0
    const pending = pendingCursorRef.current
    if (!pending || !provider.awareness) return

    const now = performance.now()
    if (now - lastBroadcastRef.current < CURSOR_BROADCAST_INTERVAL) {
      broadcastRafRef.current = requestAnimationFrame(flushCursorBroadcast)
      return
    }

    lastBroadcastRef.current = now
    pendingCursorRef.current = null
    provider.awareness.setLocalStateField('cursor', pending)
  }, [provider])

  const handleMouseMove = useCallback((e: MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect || !provider.awareness) return

    const canvasX = (e.clientX - rect.left - panRef.current.x) / zoomRef.current
    const canvasY = (e.clientY - rect.top - panRef.current.y) / zoomRef.current

    pendingCursorRef.current = { x: canvasX, y: canvasY }
    if (!broadcastRafRef.current) {
      broadcastRafRef.current = requestAnimationFrame(flushCursorBroadcast)
    }
  }, [provider, canvasRef, flushCursorBroadcast])

  // Clear cursor when mouse leaves
  const handleMouseLeave = useCallback(() => {
    pendingCursorRef.current = null
    if (broadcastRafRef.current) {
      cancelAnimationFrame(broadcastRafRef.current)
      broadcastRafRef.current = 0
    }
    if (provider.awareness) {
      provider.awareness.setLocalStateField('cursor', null)
    }
  }, [provider])

  // Attach mouse listeners to canvas
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    canvas.addEventListener('mousemove', handleMouseMove)
    canvas.addEventListener('mouseleave', handleMouseLeave)

    return () => {
      canvas.removeEventListener('mousemove', handleMouseMove)
      canvas.removeEventListener('mouseleave', handleMouseLeave)
      if (broadcastRafRef.current) cancelAnimationFrame(broadcastRafRef.current)
    }
  }, [canvasRef, handleMouseMove, handleMouseLeave])

  // Cursor DOM elements keyed by clientId. Keeping identity stable prevents
  // the index-shift glitch where disconnects caused another peer's transform
  // to be applied to a cursor until the next full paint.
  const elementsRef = useRef<Map<number, HTMLElement>>(new Map())

  // Listen for remote awareness updates — paint directly to DOM, skip React state
  useEffect(() => {
    if (!provider.awareness) return

    const paintCursors = () => {
      const container = containerRef.current
      if (!container) return

      const p = panRef.current
      const z = zoomRef.current
      const cursorMap = cursorsRef.current
      const elements = elementsRef.current
      const now = Date.now()

      for (const c of cursorMap.values()) {
        let el = elements.get(c.clientId)

        if (!el) {
          el = document.createElement('div')
          el.className = 'pointer-events-none absolute left-0 top-0 z-50'
          el.style.willChange = 'transform'
          el.style.transition = 'transform 350ms cubic-bezier(0.4, 0, 0.2, 1)'
          el.dataset.cid = String(c.clientId)
          el.innerHTML = buildCursorHtml(c, now)
          container.appendChild(el)
          elements.set(c.clientId, el)
        }

        el.style.transform = `translate(${c.x * z + p.x}px, ${c.y * z + p.y}px)`

        const hasBubble = c.chatBubble && (now - c.chatBubble.timestamp < BUBBLE_DISPLAY_TIME)
        const bubbleText = hasBubble ? c.chatBubble!.text : ''
        if ((el.dataset.bubble || '') !== bubbleText) {
          el.dataset.bubble = bubbleText
          el.innerHTML = buildCursorHtml(c, now)
        }
      }

      // Drop elements for cursors that are gone
      for (const [id, el] of elements) {
        if (!cursorMap.has(id)) {
          el.remove()
          elements.delete(id)
        }
      }
    }

    const update = () => {
      const states = provider.awareness!.getStates()
      const now = Date.now()

      states.forEach((state, clientId) => {
        if (clientId === provider.awareness!.clientID) return
        if (state.user && state.cursor) {
          cursorsRef.current.set(clientId, {
            clientId,
            name: state.user.name || 'Unknown',
            color: sanitizeColor(state.user.color),
            x: state.cursor.x,
            y: state.cursor.y,
            lastUpdate: now,
            chatBubble: state.chatBubble || null,
          })
        } else {
          cursorsRef.current.delete(clientId)
        }
      })

      // Remove stale cursors (no update in 10s)
      cursorsRef.current.forEach((cursor, id) => {
        if (now - cursor.lastUpdate > STALE_CURSOR_TIMEOUT) {
          cursorsRef.current.delete(id)
        }
      })

      paintCursors()
    }

    // Use awareness change event batched with rAF
    const onChange = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(update)
    }

    provider.awareness.on('change', onChange)
    update()

    // Periodic repaint to expire bubbles visually
    const bubbleCleanup = setInterval(() => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(paintCursors)
    }, 1000)

    return () => {
      provider.awareness?.off('change', onChange)
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      clearInterval(bubbleCleanup)
      elementsRef.current.clear()
    }
  }, [provider])

  // Repaint cursors when pan/zoom changes (no awareness event needed)
  useEffect(() => {
    const elements = elementsRef.current
    const cursors = cursorsRef.current
    const z = zoom
    const p = pan
    for (const [id, el] of elements) {
      const c = cursors.get(id)
      if (!c) continue
      el.style.transform = `translate(${c.x * z + p.x}px, ${c.y * z + p.y}px)`
    }
  }, [pan, zoom])

  return <div ref={containerRef} />
}

function buildCursorHtml(c: CursorData, now: number): string {
  const hasBubble = c.chatBubble && (now - c.chatBubble.timestamp < BUBBLE_DISPLAY_TIME)

  let html = `
    <svg width="18" height="22" viewBox="0 0 18 22" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M1.5 1L6.5 20L9.5 12.5L17 10.5L1.5 1Z" fill="${c.color}" stroke="white" stroke-width="1.5" stroke-linejoin="round"/>
    </svg>
    <div class="ml-4 -mt-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium text-white whitespace-nowrap" style="background-color:${c.color}">${escapeHtml(c.name)}</div>
  `

  if (hasBubble) {
    const text = c.chatBubble!.text.length > 80
      ? c.chatBubble!.text.slice(0, 80) + '...'
      : c.chatBubble!.text

    html += `
      <div style="
        margin-left: 16px;
        margin-top: 4px;
        max-width: 200px;
        padding: 6px 10px;
        border-radius: 12px;
        border-top-left-radius: 4px;
        background: white;
        box-shadow: 0 2px 8px rgba(0,0,0,0.12);
        font-size: 11px;
        line-height: 1.4;
        color: #1a1a1a;
        word-wrap: break-word;
        animation: bubble-in 0.2s ease-out;
      ">${escapeHtml(text)}</div>
    `
  }

  return html
}
