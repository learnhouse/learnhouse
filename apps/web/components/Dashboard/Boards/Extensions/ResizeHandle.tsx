'use client'

import React from 'react'

interface ResizeHandleProps {
  onMouseDown: (e: React.MouseEvent) => void
  selected?: boolean
  dark?: boolean
  /** @deprecated kept for backwards compat — ignored */
  size?: string
  /** @deprecated kept for backwards compat — ignored */
  color?: string
}

export default function ResizeHandle({
  onMouseDown,
  selected = false,
  dark = false,
}: ResizeHandleProps) {
  return (
    <div
      data-resize-handle
      onMouseDown={onMouseDown}
      className={`absolute bottom-0 end-0 z-20 p-1 cursor-nwse-resize transition-opacity ${
        selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
      }`}
    >
      <div className={`w-4 h-4 rounded-[6px] nice-shadow flex items-center justify-center transition-colors ${
        dark
          ? 'bg-neutral-800 hover:bg-neutral-700 active:bg-neutral-600'
          : 'bg-white hover:bg-neutral-50 active:bg-neutral-100'
      }`}>
        <svg width="7" height="7" viewBox="0 0 7 7" fill="none">
          <circle cx="5.5" cy="5.5" r="0.9" fill={dark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.25)'} />
          <circle cx="2.5" cy="5.5" r="0.9" fill={dark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.18)'} />
          <circle cx="5.5" cy="2.5" r="0.9" fill={dark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.18)'} />
        </svg>
      </div>
    </div>
  )
}
