'use client'

import React, { useState, useRef, useEffect, useCallback } from 'react'
import { CheckSquare, Plus, X } from '@phosphor-icons/react'
import BoardBlockWrapper from './BoardBlockWrapper'
import DragHandle from './DragHandle'
import ResizeHandle from './ResizeHandle'
import { useDragResize } from './useDragResize'

interface TodoItem {
  id: string
  text: string
  done: boolean
}

const TODO_COLORS = [
  { name: 'blue', bg: '#eff6ff', border: '#bfdbfe', accent: '#3b82f6', text: '#1e40af', doneBg: '#dbeafe' },
  { name: 'green', bg: '#f0fdf4', border: '#bbf7d0', accent: '#22c55e', text: '#166534', doneBg: '#dcfce7' },
  { name: 'purple', bg: '#faf5ff', border: '#e9d5ff', accent: '#a855f7', text: '#6b21a8', doneBg: '#f3e8ff' },
  { name: 'orange', bg: '#fff7ed', border: '#fed7aa', accent: '#f97316', text: '#9a3412', doneBg: '#ffedd5' },
  { name: 'pink', bg: '#fdf2f8', border: '#fbcfe8', accent: '#ec4899', text: '#9d174d', doneBg: '#fce7f3' },
  { name: 'yellow', bg: '#fefce8', border: '#fde68a', accent: '#eab308', text: '#854d0e', doneBg: '#fef9c3' },
]

function getColorSet(colorName: string) {
  return TODO_COLORS.find((c) => c.name === colorName) || TODO_COLORS[0]
}

function genId() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
}

export default function TodoBlockComponent({ node, updateAttributes, selected, deleteNode, editor, getPos }: any) {
  const { x, y, width, height, color, zIndex, title, items: savedItems } = node.attrs
  const colorSet = getColorSet(color)

  const [items, setItems] = useState<TodoItem[]>(() =>
    Array.isArray(savedItems) ? savedItems : []
  )
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleValue, setTitleValue] = useState(title)
  const [newItemText, setNewItemText] = useState('')
  const newItemRef = useRef<HTMLInputElement>(null)
  const titleInputRef = useRef<HTMLInputElement>(null)

  // Sync items to node attrs
  const syncItems = useCallback((next: TodoItem[]) => {
    setItems(next)
    updateAttributes({ items: next })
  }, [updateAttributes])

  // Sync from external updates (collaboration)
  useEffect(() => {
    if (Array.isArray(savedItems)) {
      setItems(savedItems)
    }
  }, [savedItems])

  useEffect(() => {
    setTitleValue(title)
  }, [title])

  const { handleDragStart, handleResizeStart } = useDragResize({
    x, y, width, height,
    minWidth: 200, minHeight: 160,
    updateAttributes,
    editor,
    getPos,
  })

  const toggleItem = (id: string) => {
    const next = items.map((it) => it.id === id ? { ...it, done: !it.done } : it)
    syncItems(next)
  }

  const removeItem = (id: string) => {
    syncItems(items.filter((it) => it.id !== id))
  }

  const addItem = () => {
    const text = newItemText.trim()
    if (!text) return
    syncItems([...items, { id: genId(), text, done: false }])
    setNewItemText('')
    setTimeout(() => newItemRef.current?.focus(), 0)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      addItem()
    }
  }

  const commitTitle = () => {
    setEditingTitle(false)
    const trimmed = titleValue.trim() || 'To-do'
    setTitleValue(trimmed)
    updateAttributes({ title: trimmed })
  }

  const doneCount = items.filter((it) => it.done).length
  const totalCount = items.length
  const progress = totalCount > 0 ? (doneCount / totalCount) * 100 : 0

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
        border: `1.5px solid ${colorSet.border}`,
      }}
    >
      <DragHandle onMouseDown={handleDragStart} />

      {/* Header */}
      <div className="flex items-center px-4 pt-3 pb-0.5 select-none">
        <div className="flex items-center gap-1.5">
          <CheckSquare size={12} weight="fill" style={{ color: colorSet.accent }} />
          {editingTitle ? (
            <input
              ref={titleInputRef}
              value={titleValue}
              onChange={(e) => setTitleValue(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={(e) => { if (e.key === 'Enter') commitTitle() }}
              onMouseDown={(e) => e.stopPropagation()}
              className="text-[9px] font-semibold tracking-wider uppercase bg-transparent border-none outline-none w-24"
              style={{ color: colorSet.text }}
              autoFocus
            />
          ) : (
            <span
              className="text-[9px] font-semibold tracking-wider uppercase cursor-pointer hover:opacity-70"
              style={{ color: colorSet.text }}
              onDoubleClick={(e) => {
                e.stopPropagation()
                setEditingTitle(true)
              }}
            >
              {titleValue}
            </span>
          )}
        </div>

        <div className="flex-1" />

        {/* Progress pill */}
        {totalCount > 0 && (
          <span
            className="text-[9px] font-medium px-1.5 py-0.5 rounded-full"
            style={{
              backgroundColor: colorSet.doneBg,
              color: colorSet.text,
            }}
          >
            {doneCount}/{totalCount}
          </span>
        )}

        {/* Color swatches */}
        <div className="flex items-center gap-1 ml-2">
          {TODO_COLORS.map((c) => (
            <button
              key={c.name}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation()
                updateAttributes({ color: c.name })
              }}
              className={`w-3 h-3 rounded-full border-2 transition-transform hover:scale-125 ${
                color === c.name ? 'ring-2 ring-offset-1 ring-gray-400 scale-110' : 'border-white/60'
              }`}
              style={{ backgroundColor: c.accent }}
            />
          ))}
        </div>
      </div>

      {/* Progress bar */}
      {totalCount > 0 && (
        <div className="px-4 pt-1.5">
          <div
            className="h-1 rounded-full overflow-hidden"
            style={{ backgroundColor: colorSet.border }}
          >
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{
                width: `${progress}%`,
                backgroundColor: colorSet.accent,
              }}
            />
          </div>
        </div>
      )}

      {/* Items list */}
      <div className="px-3 pt-2 pb-1 flex flex-col gap-0.5 overflow-y-auto" style={{ maxHeight: height - 90 }}>
        {items.map((item) => (
          <div
            key={item.id}
            className="group/item flex items-center gap-2 px-1.5 py-1 rounded-lg hover:bg-white/50 transition-colors"
          >
            {/* Custom checkbox */}
            <button
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation()
                toggleItem(item.id)
              }}
              className="flex-shrink-0 w-4 h-4 rounded border-[1.5px] flex items-center justify-center transition-all"
              style={{
                borderColor: item.done ? colorSet.accent : colorSet.border,
                backgroundColor: item.done ? colorSet.accent : 'transparent',
              }}
            >
              {item.done && (
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <path d="M2 5L4.5 7.5L8 3" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>

            <span
              className={`flex-1 text-[13px] leading-tight ${item.done ? 'line-through opacity-50' : ''}`}
              style={{ color: colorSet.text }}
            >
              {item.text}
            </span>

            {/* Remove button */}
            <button
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation()
                removeItem(item.id)
              }}
              className="flex-shrink-0 opacity-0 group-hover/item:opacity-100 transition-opacity p-0.5 rounded hover:bg-white/70"
            >
              <X size={10} style={{ color: colorSet.text }} />
            </button>
          </div>
        ))}

        {/* Add new item */}
        <div className="flex items-center gap-2 px-1.5 py-1 mt-0.5">
          <Plus size={12} style={{ color: colorSet.accent, opacity: 0.6 }} className="flex-shrink-0" />
          <input
            ref={newItemRef}
            value={newItemText}
            onChange={(e) => setNewItemText(e.target.value)}
            onKeyDown={handleKeyDown}
            onMouseDown={(e) => e.stopPropagation()}
            placeholder="Add item..."
            className="flex-1 text-[13px] bg-transparent border-none outline-none placeholder:opacity-40"
            style={{ color: colorSet.text }}
          />
          {newItemText.trim() && (
            <button
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation()
                addItem()
              }}
              className="text-[10px] font-medium px-2 py-0.5 rounded-md transition-colors"
              style={{
                backgroundColor: colorSet.accent,
                color: 'white',
              }}
            >
              Add
            </button>
          )}
        </div>
      </div>

      <ResizeHandle onMouseDown={handleResizeStart} selected={selected} />
    </BoardBlockWrapper>
  )
}
