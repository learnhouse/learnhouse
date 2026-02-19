'use client'

import React, { useEffect, useRef, useState, useCallback } from 'react'
import type { HocuspocusProvider } from '@hocuspocus/provider'

interface CursorData {
  clientId: number
  name: string
  color: string
  x: number
  y: number
  lastUpdate: number
}

interface RemoteCursorsProps {
  provider: HocuspocusProvider
  canvasRef: React.RefObject<HTMLDivElement | null>
  pan: { x: number; y: number }
  zoom: number
}

/** SVG cursor arrow pointing top-left */
function CursorArrow({ color }: { color: string }) {
  return (
    <svg width="18" height="22" viewBox="0 0 18 22" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M1.5 1L6.5 20L9.5 12.5L17 10.5L1.5 1Z"
        fill={color}
        stroke="white"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export default function RemoteCursors({ provider, canvasRef, pan, zoom }: RemoteCursorsProps) {
  const [cursors, setCursors] = useState<CursorData[]>([])
  const rafRef = useRef<number | null>(null)
  const cursorsRef = useRef<Map<number, CursorData>>(new Map())

  // Broadcast local cursor position
  const handleMouseMove = useCallback((e: MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect || !provider.awareness) return

    // Convert screen coordinates to canvas coordinates
    const canvasX = (e.clientX - rect.left - pan.x) / zoom
    const canvasY = (e.clientY - rect.top - pan.y) / zoom

    provider.awareness.setLocalStateField('cursor', {
      x: canvasX,
      y: canvasY,
    })
  }, [provider, canvasRef, pan, zoom])

  // Clear cursor when mouse leaves
  const handleMouseLeave = useCallback(() => {
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
    }
  }, [canvasRef, handleMouseMove, handleMouseLeave])

  // Listen for remote awareness updates
  useEffect(() => {
    if (!provider.awareness) return

    const update = () => {
      const states = provider.awareness!.getStates()
      const now = Date.now()

      states.forEach((state, clientId) => {
        if (clientId === provider.awareness!.clientID) return
        if (state.user && state.cursor) {
          cursorsRef.current.set(clientId, {
            clientId,
            name: state.user.name || 'Unknown',
            color: state.user.color || '#958DF1',
            x: state.cursor.x,
            y: state.cursor.y,
            lastUpdate: now,
          })
        } else {
          cursorsRef.current.delete(clientId)
        }
      })

      // Remove stale cursors (no update in 10s)
      cursorsRef.current.forEach((cursor, id) => {
        if (now - cursor.lastUpdate > 10000) {
          cursorsRef.current.delete(id)
        }
      })

      setCursors(Array.from(cursorsRef.current.values()))
    }

    // Use awareness change event
    const onChange = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(update)
    }

    provider.awareness.on('change', onChange)
    update()

    return () => {
      provider.awareness?.off('change', onChange)
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [provider])

  if (cursors.length === 0) return null

  return (
    <>
      {cursors.map((cursor) => (
        <div
          key={cursor.clientId}
          className="pointer-events-none absolute left-0 top-0 z-50 transition-transform duration-75 ease-out"
          style={{
            transform: `translate(${cursor.x * zoom + pan.x}px, ${cursor.y * zoom + pan.y}px)`,
          }}
        >
          <CursorArrow color={cursor.color} />
          <div
            className="ml-4 -mt-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium text-white whitespace-nowrap"
            style={{ backgroundColor: cursor.color }}
          >
            {cursor.name}
          </div>
        </div>
      ))}
    </>
  )
}
