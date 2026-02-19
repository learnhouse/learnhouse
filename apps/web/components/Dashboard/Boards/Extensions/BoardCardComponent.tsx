'use client'

import React from 'react'
import { NodeViewWrapper, NodeViewContent } from '@tiptap/react'
import { GripVertical } from 'lucide-react'
import NodeActions from './NodeActions'
import { useDragResize } from './useDragResize'

export default function BoardCardComponent({ node, updateAttributes, selected, deleteNode, editor, getPos }: any) {
  const { x, y, width, height, color, zIndex } = node.attrs

  const { handleDragStart, handleResizeStart } = useDragResize({
    x, y, width, height,
    minWidth: 150, minHeight: 100,
    updateAttributes,
  })

  return (
    <NodeViewWrapper
      as="div"
      className={`absolute group rounded-xl nice-shadow ${
        selected ? 'ring-2 ring-blue-400' : ''
      }`}
      style={{
        left: x,
        top: y,
        width,
        minHeight: height,
        zIndex,
        backgroundColor: color,
      }}
    >
      <NodeActions selected={selected} deleteNode={deleteNode} editor={editor} getPos={getPos} />
      {/* Drag handle */}
      <div
        onMouseDown={handleDragStart}
        className="flex items-center justify-center h-6 cursor-grab active:cursor-grabbing bg-gray-50/80 border-b border-gray-100 opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <GripVertical size={12} className="text-gray-400" />
      </div>

      {/* Content area */}
      <div className="p-4">
        <NodeViewContent className="board-card-content prose prose-sm max-w-none" />
      </div>

      {/* Resize handle */}
      <div
        onMouseDown={handleResizeStart}
        className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <svg viewBox="0 0 16 16" className="w-full h-full text-gray-300">
          <path d="M14 14L14 8M14 14L8 14" stroke="currentColor" strokeWidth="1.5" fill="none" />
        </svg>
      </div>
    </NodeViewWrapper>
  )
}
