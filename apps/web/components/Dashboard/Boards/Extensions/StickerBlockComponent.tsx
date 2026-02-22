'use client'

import React, { lazy, Suspense, useEffect, useRef, useState } from 'react'
import BoardBlockWrapper from './BoardBlockWrapper'
import { useDragResize } from './useDragResize'
import data from '@emoji-mart/data'

const Picker = lazy(() => import('@emoji-mart/react'))

export default function StickerBlockComponent({ node, updateAttributes, selected, deleteNode, editor, getPos }: any) {
  const { x, y, emoji } = node.attrs
  const [pickerOpen, setPickerOpen] = useState(false)
  const pickerRef = useRef<HTMLDivElement>(null)

  const { handleDragStart } = useDragResize({
    x, y, width: 80, height: 80,
    updateAttributes,
    editor,
    getPos,
  })

  // Close picker on click outside
  useEffect(() => {
    if (!pickerOpen) return
    function handleClickOutside(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [pickerOpen])

  return (
    <BoardBlockWrapper
      selected={selected}
      deleteNode={deleteNode}
      editor={editor}
      getPos={getPos}
      x={x}
      y={y}
      styled={false}
      selectedRing={true}
      className="flex items-center justify-center"
    >
      {/* Drag + click area */}
      <div
        onMouseDown={handleDragStart}
        onClick={(e) => {
          e.stopPropagation()
          setPickerOpen((o) => !o)
        }}
        className="cursor-grab active:cursor-grabbing select-none"
        style={{ fontSize: 64, lineHeight: 1 }}
      >
        {emoji}
      </div>

      {/* Emoji picker popover */}
      {pickerOpen && (
        <div
          ref={pickerRef}
          className="absolute z-50"
          style={{ top: '100%', left: 0, marginTop: 4 }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <Suspense fallback={<div className="p-4 text-xs text-neutral-400">Loading…</div>}>
            <Picker
              data={data}
              onEmojiSelect={(emojiData: any) => {
                updateAttributes({ emoji: emojiData.native })
                setPickerOpen(false)
              }}
              theme="light"
              previewPosition="none"
            />
          </Suspense>
        </div>
      )}
    </BoardBlockWrapper>
  )
}
