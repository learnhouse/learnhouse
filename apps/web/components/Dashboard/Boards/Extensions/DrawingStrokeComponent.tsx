'use client'

import React from 'react'
import { NodeViewWrapper } from '@tiptap/react'
import NodeActions from './NodeActions'
import { useDragResize } from './useDragResize'

export default function DrawingStrokeComponent({ node, updateAttributes, selected, deleteNode, editor, getPos }: any) {
  const { pathData, strokeColor, strokeWidth, x, y, viewBox } = node.attrs

  const vbParts = (viewBox || '0 0 100 100').split(' ').map(Number)
  const svgWidth = vbParts[2] || 100
  const svgHeight = vbParts[3] || 100

  const { handleDragStart } = useDragResize({
    x, y, width: svgWidth, height: svgHeight,
    updateAttributes,
  })

  if (!pathData) return <NodeViewWrapper as="div" />

  return (
    <NodeViewWrapper
      as="div"
      className="absolute group"
      style={{
        left: x,
        top: y,
        width: svgWidth,
        height: svgHeight,
      }}
    >
      <NodeActions selected={selected} deleteNode={deleteNode} editor={editor} getPos={getPos} />
      {/* Hit area + drag handle */}
      <div
        onMouseDown={handleDragStart}
        className={`w-full h-full rounded transition-colors cursor-grab active:cursor-grabbing ${
          selected ? 'outline outline-2 outline-blue-400 outline-offset-2 bg-blue-50/20' : 'hover:bg-gray-100/30'
        }`}
      >
        <svg
          width={svgWidth}
          height={svgHeight}
          viewBox={viewBox}
          className="overflow-visible pointer-events-none"
        >
          <path
            d={pathData}
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </NodeViewWrapper>
  )
}
