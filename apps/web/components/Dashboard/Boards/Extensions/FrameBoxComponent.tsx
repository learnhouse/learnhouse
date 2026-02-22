'use client'

import React, { useCallback, useState } from 'react'
import { Lock, Unlock } from 'lucide-react'
import BoardBlockWrapper from './BoardBlockWrapper'
import DragHandle from './DragHandle'
import ResizeHandle from './ResizeHandle'
import { useFrameDrag } from './useFrameDrag'

const FRAME_COLORS = [
  { name: 'purple', bg: '#f3e8ff', border: '#c084fc', pill: '#a855f7' },
  { name: 'blue', bg: '#dbeafe', border: '#93c5fd', pill: '#3b82f6' },
  { name: 'green', bg: '#dcfce7', border: '#86efac', pill: '#22c55e' },
  { name: 'pink', bg: '#fce7f3', border: '#f9a8d4', pill: '#ec4899' },
  { name: 'orange', bg: '#ffedd5', border: '#fdba74', pill: '#f97316' },
  { name: 'gray', bg: '#f3f4f6', border: '#d1d5db', pill: '#6b7280' },
]

function getColorSet(colorName: string) {
  return FRAME_COLORS.find((c) => c.name === colorName) || FRAME_COLORS[0]
}

export default function FrameBoxComponent({ node, updateAttributes, selected, deleteNode, editor, getPos }: any) {
  const { x, y, width, height, title, locked, color } = node.attrs
  const [isEditingTitle, setIsEditingTitle] = useState(false)

  const colorSet = getColorSet(color)

  const { handleDragStart, handleResizeStart } = useFrameDrag({
    x, y, width, height,
    minWidth: 200,
    minHeight: 200,
    updateAttributes,
    editor,
    getPos,
  })

  const handleTitleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    updateAttributes({ title: e.target.value })
  }, [updateAttributes])

  const handleTitleBlur = useCallback(() => {
    setIsEditingTitle(false)
  }, [])

  const handleTitleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      setIsEditingTitle(false)
    }
  }, [])

  const toggleLock = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    updateAttributes({ locked: !locked })
  }, [locked, updateAttributes])

  return (
    <BoardBlockWrapper
      selected={selected}
      deleteNode={deleteNode}
      editor={editor}
      getPos={getPos}
      x={x}
      y={y}
      width={width}
      height={height}
      styled={false}
      zIndex={0}
      selectedRing={false}
      className="rounded-2xl"
      style={{
        backgroundColor: colorSet.bg,
        border: `2px solid ${colorSet.border}`,
      }}
    >
      <DragHandle onMouseDown={handleDragStart} />

      {/* Top bar — title pill, color picker, lock */}
      <div
        onMouseDown={handleDragStart}
        className="flex items-center gap-2 px-3 pt-3 pb-1 cursor-grab active:cursor-grabbing select-none"
      >
        {/* Title pill */}
        {isEditingTitle ? (
          <input
            type="text"
            value={title}
            onChange={handleTitleChange}
            onBlur={handleTitleBlur}
            onKeyDown={handleTitleKeyDown}
            onMouseDown={(e) => e.stopPropagation()}
            autoFocus
            className="text-sm font-semibold text-white outline-none rounded-md px-2.5 py-1"
            style={{ backgroundColor: colorSet.pill, minWidth: 60 }}
          />
        ) : (
          <span
            onDoubleClick={(e) => {
              e.stopPropagation()
              setIsEditingTitle(true)
            }}
            className="text-sm font-semibold text-white rounded-md px-2.5 py-1 truncate max-w-[70%]"
            style={{ backgroundColor: colorSet.pill }}
          >
            {title}
          </span>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Color swatches — visible on hover */}
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {FRAME_COLORS.map((c) => (
            <button
              key={c.name}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation()
                updateAttributes({ color: c.name })
              }}
              className={`w-4 h-4 rounded-full border-2 transition-transform hover:scale-125 ${
                color === c.name ? 'ring-2 ring-offset-1 ring-gray-400 scale-110' : 'border-white/60'
              }`}
              style={{ backgroundColor: c.pill }}
            />
          ))}
        </div>

        {/* Lock toggle */}
        <button
          onMouseDown={(e) => e.stopPropagation()}
          onClick={toggleLock}
          className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-md hover:bg-black/5"
        >
          {locked ? (
            <Lock size={13} style={{ color: colorSet.pill }} />
          ) : (
            <Unlock size={13} className="text-gray-400" />
          )}
        </button>
      </div>

      {/* Body — transparent, just takes up remaining space */}
      <div
        className="pointer-events-none"
        style={{ height: height - 44 }}
      />

      <ResizeHandle onMouseDown={handleResizeStart} color={`text-[${colorSet.border}]`} selected={selected} />
    </BoardBlockWrapper>
  )
}
