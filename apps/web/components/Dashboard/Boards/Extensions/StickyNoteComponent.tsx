'use client'

import React from 'react'
import { NodeViewContent } from '@tiptap/react'
import BoardBlockWrapper from './BoardBlockWrapper'
import { useDragResize } from './useDragResize'

const STICKY_COLORS: Record<string, string> = {
  yellow: '#fef9c3',
  pink: '#fce7f3',
  green: '#dcfce7',
  blue: '#dbeafe',
}

export default function StickyNoteComponent({ node, updateAttributes, selected, deleteNode, editor, getPos }: any) {
  const { x, y, color } = node.attrs

  const bgColor = STICKY_COLORS[color] || STICKY_COLORS.yellow

  const { handleDragStart } = useDragResize({
    x, y, width: 192, height: 120,
    updateAttributes,
    editor,
    getPos,
  })

  return (
    <BoardBlockWrapper
      selected={selected} deleteNode={deleteNode} editor={editor} getPos={getPos}
      x={x} y={y} bgColor={bgColor}
      className="w-48 min-h-[120px]"
    >
      {/* Drag handle area (custom — includes color picker) */}
      <div
        onMouseDown={handleDragStart}
        className="flex items-center justify-between px-3 pt-2 cursor-grab active:cursor-grabbing"
      >
        <div className="flex gap-1">
          {Object.entries(STICKY_COLORS).map(([name, bg]) => (
            <button
              key={name}
              onClick={(e) => { e.stopPropagation(); updateAttributes({ color: name }) }}
              className={`w-3 h-3 rounded-full opacity-0 group-hover:opacity-100 transition-opacity ${
                color === name ? 'ring-1 ring-gray-400' : ''
              }`}
              style={{ backgroundColor: bg, border: '1px solid rgba(0,0,0,0.1)' }}
            />
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="px-3 py-2">
        <NodeViewContent className="sticky-note-content text-sm outline-none" />
      </div>
    </BoardBlockWrapper>
  )
}
