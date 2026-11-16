'use client'
/*
 Drop-in block chrome for the blocks that keep their own UI (quiz, math,
 flipcards, scenarios, H5P, code playground, magic block, …).

 In the editor it adds what every block now has: the selection ring, a
 colored hover label in the block's own toolbar color, and a small floating
 toolbar (the block's extra tools + Duplicate + Delete). For learners it
 renders the children untouched, so their markup is exactly as before.
*/
import React from 'react'
import type { NodeViewProps } from '@tiptap/react'
import { Copy, Trash } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { BlockChrome, BlockToolbarButton, BlockToolbarDivider, type BlockTone } from './BlockChrome'
import { deleteBlock } from '../nodeViewUtils'

interface Props {
  editable: boolean
  node: NodeViewProps['node']
  editor: NodeViewProps['editor']
  getPos: NodeViewProps['getPos']
  selected?: boolean
  tone: BlockTone
  label?: React.ReactNode
  tools?: React.ReactNode
  /** For blocks with editable text inside (callout, badge, conditional). */
  editableContent?: boolean
  /** Keep the toolbar visible (e.g. while one of its popovers is open). */
  forceToolbar?: boolean
  className?: string
  children: React.ReactNode
}

export function EditorBlockFrame({ editable, node, editor, getPos, selected, tone, label, tools, editableContent, forceToolbar, className, children }: Props) {
  const { t } = useTranslation()
  if (!editable) return <>{children}</>
  const duplicate = () => {
    const pos = typeof getPos === 'function' ? getPos() : undefined
    if (typeof pos !== 'number') return
    editor.chain().focus().insertContentAt(pos + node.nodeSize, node.toJSON()).run()
  }
  return (
    <BlockChrome
      selected={selected}
      tone={tone}
      label={label}
      editableContent={editableContent}
      forceToolbar={forceToolbar}
      className={className}
      toolbar={
        <>
          {tools}
          {tools && <BlockToolbarDivider />}
          <BlockToolbarButton label={t('editor.drag_handle.duplicate', 'Duplicate')} onClick={duplicate}>
            <Copy size={14} />
          </BlockToolbarButton>
          <BlockToolbarButton label={t('common.delete', 'Delete')} tone="danger" onClick={() => deleteBlock({ editor, getPos, node })}>
            <Trash size={14} />
          </BlockToolbarButton>
        </>
      }
    >
      {children}
    </BlockChrome>
  )
}

export default EditorBlockFrame
