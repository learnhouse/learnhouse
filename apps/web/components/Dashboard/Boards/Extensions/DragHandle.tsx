'use client'

import React from 'react'
import { GripVertical } from 'lucide-react'

interface DragHandleProps {
  onMouseDown: (e: React.MouseEvent) => void
  height?: string
  className?: string
  autoHide?: boolean
  dark?: boolean
  style?: React.CSSProperties
  children?: React.ReactNode
}

export default function DragHandle({
  onMouseDown,
  height = 'h-6',
  className,
  autoHide = false,
  dark = false,
  style,
  children,
}: DragHandleProps) {
  const visibilityClass = autoHide ? 'opacity-0 group-hover:opacity-100 transition-opacity' : ''

  // Bar mode: full-width handle bar (when className or children are provided)
  if (className || children) {
    const barClass = className || 'bg-gray-50/80 border-b border-gray-100'

    if (children) {
      return (
        <div
          data-drag-handle
          onMouseDown={onMouseDown}
          className={`flex items-center gap-2 ${height} cursor-grab active:cursor-grabbing ${barClass} px-2 ${visibilityClass}`}
          style={style}
        >
          <GripVertical size={10} className="text-gray-400 shrink-0" />
          {children}
        </div>
      )
    }

    return (
      <div
        data-drag-handle
        onMouseDown={onMouseDown}
        className={`flex items-center justify-center ${height} cursor-grab active:cursor-grabbing ${barClass} ${visibilityClass}`}
        style={style}
      >
        <GripVertical size={10} className="text-gray-400" />
      </div>
    )
  }

  // Pill mode: small centered white box (default)
  return (
    <div
      data-drag-handle
      onMouseDown={onMouseDown}
      className={`absolute top-1 start-1/2 -translate-x-1/2 z-10 cursor-grab active:cursor-grabbing transition-opacity ${
        autoHide ? 'opacity-0 group-hover:opacity-100' : 'opacity-0 group-hover:opacity-100'
      }`}
    >
      <div className={`h-3.5 px-1.5 rounded-[5px] nice-shadow flex items-center justify-center transition-colors ${
        dark
          ? 'bg-neutral-800 hover:bg-neutral-700 active:bg-neutral-600'
          : 'bg-white hover:bg-neutral-50 active:bg-neutral-100'
      }`}>
        <svg width="10" height="4" viewBox="0 0 10 4" fill="none">
          <circle cx="1.5" cy="1" r="0.7" fill={dark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.22)'} />
          <circle cx="5" cy="1" r="0.7" fill={dark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.22)'} />
          <circle cx="8.5" cy="1" r="0.7" fill={dark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.22)'} />
          <circle cx="1.5" cy="3" r="0.7" fill={dark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.22)'} />
          <circle cx="5" cy="3" r="0.7" fill={dark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.22)'} />
          <circle cx="8.5" cy="3" r="0.7" fill={dark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.22)'} />
        </svg>
      </div>
    </div>
  )
}
