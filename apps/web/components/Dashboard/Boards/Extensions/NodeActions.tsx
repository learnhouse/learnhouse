'use client'

import React from 'react'
import { Trash2, ArrowUp, ArrowDown, Copy } from 'lucide-react'
import type { Editor } from '@tiptap/core'
import { useTranslation } from 'react-i18next'

interface NodeActionsProps {
  selected: boolean
  deleteNode: () => void
  editor?: Editor
  getPos?: () => number
  multiCount?: number
}

export default function NodeActions({ selected, deleteNode, editor, getPos, multiCount }: NodeActionsProps) {
  const { t } = useTranslation()
  const canReorder = !!editor && !!getPos

  const moveUp = (e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    if (!editor || !getPos) return
    const pos = getPos()
    const resolved = editor.state.doc.resolve(pos)
    const index = resolved.index(resolved.depth)
    if (index === 0) return // already first

    const thisNode = resolved.parent.child(index)
    const prevNode = resolved.parent.child(index - 1)

    // Swap: delete this node, insert before previous
    const from = pos
    const to = pos + thisNode.nodeSize
    const insertAt = pos - prevNode.nodeSize

    editor.chain()
      .command(({ tr }) => {
        tr.delete(from, to)
        tr.insert(insertAt, thisNode)
        return true
      })
      .run()
  }

  const duplicate = (e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    if (!editor || !getPos) return
    const pos = getPos()
    const node = editor.state.doc.nodeAt(pos)
    if (!node) return
    const insertPos = pos + node.nodeSize
    const copy = node.toJSON()
    // Offset the duplicate so it doesn't stack exactly on top
    if (copy.attrs) {
      copy.attrs = { ...copy.attrs, x: (copy.attrs.x ?? 0) + 30, y: (copy.attrs.y ?? 0) + 30 }
    }
    editor.chain().insertContentAt(insertPos, copy).run()
  }

  const moveDown = (e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    if (!editor || !getPos) return
    const pos = getPos()
    const resolved = editor.state.doc.resolve(pos)
    const index = resolved.index(resolved.depth)
    const parentChildCount = resolved.parent.childCount
    if (index >= parentChildCount - 1) return // already last

    const thisNode = resolved.parent.child(index)
    const nextNode = resolved.parent.child(index + 1)

    // Swap: delete next node, insert before this
    const nextFrom = pos + thisNode.nodeSize
    const nextTo = nextFrom + nextNode.nodeSize

    editor.chain()
      .command(({ tr }) => {
        tr.delete(nextFrom, nextTo)
        tr.insert(pos, nextNode)
        return true
      })
      .run()
  }

  return (
    <div
      className={`absolute -top-9 start-1/2 -translate-x-1/2 z-30 flex items-center gap-1 transition-opacity ${
        selected && !multiCount ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
      }`}
    >
      {canReorder && (
        <>
          <button
            type="button"
            onMouseDown={moveUp}
            className="flex items-center justify-center w-6 h-6 rounded-full bg-neutral-700 text-white shadow-sm hover:bg-neutral-600 transition-colors"
            title={t('boards.node_actions.move_back')}
          >
            <ArrowDown size={12} />
          </button>
          <button
            type="button"
            onMouseDown={moveDown}
            className="flex items-center justify-center w-6 h-6 rounded-full bg-neutral-700 text-white shadow-sm hover:bg-neutral-600 transition-colors"
            title={t('boards.node_actions.move_forward')}
          >
            <ArrowUp size={12} />
          </button>
          <button
            type="button"
            onMouseDown={duplicate}
            className="flex items-center justify-center w-6 h-6 rounded-full bg-neutral-700 text-white shadow-sm hover:bg-neutral-600 transition-colors"
            title={t('boards.node_actions.duplicate')}
          >
            <Copy size={12} />
          </button>
        </>
      )}
      <button
        type="button"
        onMouseDown={(e) => {
          e.stopPropagation()
          e.preventDefault()
          deleteNode()
        }}
        className={`flex items-center justify-center ${multiCount ? 'gap-0.5 px-2' : 'w-6'} h-6 rounded-full bg-red-500 text-white shadow-sm hover:bg-red-600 transition-colors`}
        title={multiCount ? t('boards.node_actions.delete_multiple', { count: multiCount }) : t('boards.node_actions.delete')}
      >
        <Trash2 size={12} />
        {multiCount && <span className="text-[10px] font-medium">{multiCount}</span>}
      </button>
    </div>
  )
}
