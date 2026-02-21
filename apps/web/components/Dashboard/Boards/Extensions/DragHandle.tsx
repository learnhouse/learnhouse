'use client'

import React from 'react'
import { GripVertical } from 'lucide-react'

interface DragHandleProps {
  onMouseDown: (e: React.MouseEvent) => void
  height?: string
  className?: string
  autoHide?: boolean
  children?: React.ReactNode
}

export default function DragHandle({
  onMouseDown,
  height = 'h-6',
  className = 'bg-gray-50/80 border-b border-gray-100',
  autoHide = false,
  children,
}: DragHandleProps) {
  const visibilityClass = autoHide ? 'opacity-0 group-hover:opacity-100 transition-opacity' : ''

  if (children) {
    return (
      <div
        data-drag-handle
        onMouseDown={onMouseDown}
        className={`flex items-center gap-2 ${height} cursor-grab active:cursor-grabbing ${className} px-2 ${visibilityClass}`}
      >
        <GripVertical size={12} className="text-gray-400 shrink-0" />
        {children}
      </div>
    )
  }

  return (
    <div
      data-drag-handle
      onMouseDown={onMouseDown}
      className={`flex items-center justify-center ${height} cursor-grab active:cursor-grabbing ${className} ${visibilityClass}`}
    >
      <GripVertical size={12} className="text-gray-400" />
    </div>
  )
}
