'use client'

import React from 'react'
import { NodeViewContent } from '@tiptap/react'
import { Note } from '@phosphor-icons/react'
import BoardBlockWrapper from './BoardBlockWrapper'
import DragHandle from './DragHandle'
import ResizeHandle from './ResizeHandle'
import { useDragResize } from './useDragResize'

const NOTE_COLORS = [
  { name: 'yellow', bg: '#fef9c3', border: '#fde68a', text: '#92400e' },
  { name: 'pink', bg: '#fce7f3', border: '#fbcfe8', text: '#9d174d' },
  { name: 'blue', bg: '#e0f2fe', border: '#bae6fd', text: '#0c4a6e' },
  { name: 'green', bg: '#ecfccb', border: '#d9f99d', text: '#365314' },
  { name: 'orange', bg: '#fff7ed', border: '#fed7aa', text: '#9a3412' },
  { name: 'purple', bg: '#f5f3ff', border: '#e9d5ff', text: '#5b21b6' },
]

function getColorSet(colorName: string) {
  return NOTE_COLORS.find((c) => c.name === colorName) || NOTE_COLORS[0]
}

export default function NoteBlockComponent({ node, updateAttributes, selected, deleteNode, editor, getPos }: any) {
  const { x, y, width, height, color, zIndex } = node.attrs
  const colorSet = getColorSet(color)

  const { handleDragStart, handleResizeStart } = useDragResize({
    x, y, width, height,
    minWidth: 150, minHeight: 120,
    updateAttributes,
    editor,
    getPos,
  })

  return (
    <BoardBlockWrapper
      selected={selected}
      deleteNode={deleteNode}
      editor={editor}
      getPos={getPos}
      x={x}
      y={y}
      width={width}
      zIndex={zIndex}
      styled={false}
      className="rounded-2xl nice-shadow"
      style={{
        minHeight: height,
        backgroundColor: colorSet.bg,
      }}
    >
      <DragHandle onMouseDown={handleDragStart} />

      {/* Header — icon, label, color swatches */}
      <div className="flex items-center px-4 pt-3 pb-0.5 select-none">
        <div className="flex items-center gap-1">
          <Note size={11} weight="fill" style={{ color: colorSet.text }} />
          <span
            className="text-[9px] font-semibold tracking-wider uppercase"
            style={{ color: colorSet.text }}
          >
            Note
          </span>
        </div>

        <div className="flex-1" />

        {/* Color swatches — visible on hover */}
        <div className="flex items-center gap-1">
          {NOTE_COLORS.map((c) => (
            <button
              key={c.name}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation()
                updateAttributes({ color: c.name })
              }}
              className={`w-3.5 h-3.5 rounded-full border-2 transition-transform hover:scale-125 ${
                color === c.name ? 'ring-2 ring-offset-1 ring-gray-400 scale-110' : 'border-white/60'
              }`}
              style={{ backgroundColor: c.border }}
            />
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="px-4 pt-1.5 pb-4">
        <NodeViewContent className="board-card-content text-[14px] leading-[1.6] outline-none" style={{ color: colorSet.text }} />
      </div>

      <ResizeHandle onMouseDown={handleResizeStart} selected={selected} />
    </BoardBlockWrapper>
  )
}
