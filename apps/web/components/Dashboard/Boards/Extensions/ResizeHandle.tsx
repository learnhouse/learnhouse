'use client'

import React from 'react'

interface ResizeHandleProps {
  onMouseDown: (e: React.MouseEvent) => void
  size?: string
  color?: string
  selected?: boolean
}

export default function ResizeHandle({
  onMouseDown,
  size = 'w-5 h-5',
  color = 'text-gray-300',
  selected = false,
}: ResizeHandleProps) {
  return (
    <div
      data-resize-handle
      onMouseDown={onMouseDown}
      className={`absolute bottom-0 right-0 ${size} cursor-se-resize transition-opacity z-10 ${
        selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
      }`}
    >
      <svg viewBox="0 0 16 16" className={`w-full h-full ${color}`}>
        <path d="M14 14L14 8M14 14L8 14" stroke="currentColor" strokeWidth="1.5" fill="none" />
      </svg>
    </div>
  )
}
