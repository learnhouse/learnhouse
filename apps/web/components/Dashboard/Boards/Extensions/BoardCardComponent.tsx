'use client'

import React from 'react'
import { NodeViewContent } from '@tiptap/react'
import { Article } from '@phosphor-icons/react'
import BoardBlockWrapper from './BoardBlockWrapper'
import DragHandle from './DragHandle'
import ResizeHandle from './ResizeHandle'
import { useDragResize } from './useDragResize'

export default function BoardCardComponent({ node, updateAttributes, selected, deleteNode, editor, getPos }: any) {
  const { x, y, width, height, color, zIndex } = node.attrs

  const { handleDragStart, handleResizeStart } = useDragResize({
    x, y, width, height,
    minWidth: 150, minHeight: 100,
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
      bgColor={color}
      zIndex={zIndex}
      className="rounded-2xl"
      style={{ minHeight: height }}
    >
      <DragHandle onMouseDown={handleDragStart} />

      {/* Header with icon + label */}
      <div className="flex items-center px-4 pt-4 pb-0.5">
        <div className="flex items-center gap-1">
          <Article size={11} weight="fill" className="text-neutral-400" />
          <span className="text-[9px] font-semibold tracking-wider uppercase select-none text-neutral-400">
            Card
          </span>
        </div>
      </div>

      {/* Content */}
      <div className="px-4 pt-1.5 pb-4">
        <NodeViewContent className="board-card-content text-[14px] leading-[1.6] outline-none text-neutral-700" />
      </div>

      <ResizeHandle onMouseDown={handleResizeStart} selected={selected} />
    </BoardBlockWrapper>
  )
}
