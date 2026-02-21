'use client'

import React from 'react'
import { NodeViewContent } from '@tiptap/react'
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
      selected={selected} deleteNode={deleteNode} editor={editor} getPos={getPos}
      x={x} y={y} width={width} bgColor={color} zIndex={zIndex}
      style={{ minHeight: height }}
    >
      <DragHandle onMouseDown={handleDragStart} autoHide />

      {/* Content area */}
      <div className="p-4">
        <NodeViewContent className="board-card-content prose prose-sm max-w-none" />
      </div>

      <ResizeHandle onMouseDown={handleResizeStart} size="w-4 h-4" selected={selected} />
    </BoardBlockWrapper>
  )
}
