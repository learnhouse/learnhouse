'use client'
/*
 Button group: the existing buttons side by side, wrapping on narrow
 screens. Authors set the alignment and add buttons from the block toolbar;
 each button keeps its own settings (link, color, style, size).
*/
import React from 'react'
import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { Plus, TextAlignCenter, TextAlignLeft, TextAlignRight } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { useEditorProvider } from '@components/Contexts/Editor/EditorContext'
import EditorBlockFrame from '../../../../Blocks/ui/EditorBlockFrame'
import { BlockToolbarButton, BlockToolbarDivider } from '../../../../Blocks/ui/BlockChrome'
import { BUTTON_GROUP_ALIGNMENTS, buttonGroupAlignmentOf, buttonGroupJustify, newGroupButton } from '../upgradesModel'

const ALIGN_ICON = { left: TextAlignLeft, center: TextAlignCenter, right: TextAlignRight } as const

export default function ButtonGroupView(props: NodeViewProps) {
  const { t } = useTranslation()
  const editorState = useEditorProvider() as any
  const isEditable = !!editorState?.isEditable
  const alignment = buttonGroupAlignmentOf(props.node.attrs)
  const row = (
    <NodeViewContent className="lh-button-group-row" style={{ justifyContent: buttonGroupJustify(alignment) }} />
  )

  if (!isEditable) {
    return (
      <NodeViewWrapper className="lh-button-group" data-alignment={alignment}>
        {row}
      </NodeViewWrapper>
    )
  }

  const addButton = () => {
    const pos = typeof props.getPos === 'function' ? props.getPos() : undefined
    if (typeof pos !== 'number') return
    // At the end of the group, inside it.
    props.editor
      .chain()
      .focus()
      .insertContentAt(pos + props.node.nodeSize - 1, newGroupButton(t('editor.blocks_v2.button_group.new_button', 'Button')))
      .run()
  }

  const tools = (
    <>
      {BUTTON_GROUP_ALIGNMENTS.map((a) => {
        const Icon = ALIGN_ICON[a]
        return (
          <BlockToolbarButton
            key={a}
            label={t(`editor.blocks.common.align_${a}`)}
            active={alignment === a}
            onClick={() => props.updateAttributes({ alignment: a })}
          >
            <Icon size={14} />
          </BlockToolbarButton>
        )
      })}
      <BlockToolbarDivider />
      <BlockToolbarButton label={t('editor.blocks_v2.button_group.add_button', 'Add a button')} onClick={addButton}>
        <Plus size={14} />
      </BlockToolbarButton>
    </>
  )

  return (
    <NodeViewWrapper className="lh-button-group" data-alignment={alignment}>
      <EditorBlockFrame
        editable
        node={props.node}
        editor={props.editor}
        getPos={props.getPos}
        selected={props.selected}
        tone="interactive"
        editableContent
        tools={tools}
        label={t('editor.blocks_v2.button_group.label', 'Button group')}
        className="px-1 pb-1 pt-2"
      >
        {row}
      </EditorBlockFrame>
    </NodeViewWrapper>
  )
}
