import { NodeViewContent, NodeViewWrapper } from '@tiptap/react'
import React from 'react'
import { Columns2, Columns3, Columns4, Plus, Ungroup } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useEditorProvider } from '@components/Contexts/Editor/EditorContext'
import { useTranslation } from 'react-i18next'

const COLUMN_OPTIONS: { value: number; Icon: any; labelKey: string }[] = [
  { value: 2, Icon: Columns2, labelKey: 'activities.grid_columns_2' },
  { value: 3, Icon: Columns3, labelKey: 'activities.grid_columns_3' },
  { value: 4, Icon: Columns4, labelKey: 'activities.grid_columns_4' },
]

const FlipcardGridExtension: React.FC = (props: any) => {
  const { t } = useTranslation()
  const editorState = useEditorProvider() as any
  const isEditable = editorState.isEditable
  const columns: number = props.node.attrs.columns || 2

  const setColumns = (value: number) => {
    props.updateAttributes({ columns: value })
  }

  /** Append an extra card at the end of the grid. */
  const addCard = () => {
    const pos = typeof props.getPos === 'function' ? props.getPos() : null
    if (pos === null || pos === undefined) return
    // nodeSize - 1 lands just inside the closing token, i.e. after the last card.
    const insertAt = pos + props.node.nodeSize - 1
    props.editor
      .chain()
      .focus()
      .insertContentAt(insertAt, {
        type: 'flipcard',
        attrs: {
          question: 'Click to reveal the answer',
          answer: 'This is the answer',
          color: 'blue',
          alignment: 'center',
          size: 'medium',
        },
      })
      .run()
  }

  /** Drop the container, leaving the cards as ordinary stacked blocks. */
  const ungroup = () => {
    const pos = typeof props.getPos === 'function' ? props.getPos() : null
    if (pos === null || pos === undefined) return
    props.editor
      .chain()
      .focus()
      .command(({ tr, dispatch }: any) => {
        const node = tr.doc.nodeAt(pos)
        if (!node) return false
        if (dispatch) tr.replaceWith(pos, pos + node.nodeSize, node.content)
        return true
      })
      .run()
  }

  return (
    <NodeViewWrapper
      className="flipcard-grid my-4"
      style={{ ['--flipcard-grid-columns' as any]: columns }}
    >
      {/* The column count rides a CSS variable rather than a Tailwind class:
          Tiptap injects its own content holder inside this element, so the grid
          has to be declared in CSS where that holder can be dissolved. */}
      <NodeViewContent className="flipcard-grid-content" />

      {isEditable && (
        <div
          className="flex mt-3 gap-1 justify-center opacity-60 hover:opacity-100 transition-opacity"
          contentEditable={false}
        >
          {COLUMN_OPTIONS.map(({ value, Icon, labelKey }) => (
            <button
              key={value}
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setColumns(value)
              }}
              className={cn(
                'p-1.5 rounded-md transition-colors text-xs',
                columns === value
                  ? 'bg-neutral-700 text-white'
                  : 'bg-neutral-200 hover:bg-neutral-300 text-neutral-600'
              )}
              title={t(labelKey)}
            >
              <Icon size={12} />
            </button>
          ))}

          <div className="w-px h-4 bg-neutral-300 self-center mx-1" />

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              addCard()
            }}
            className="p-1.5 bg-neutral-200 hover:bg-neutral-300 text-neutral-600 rounded-md transition-colors text-xs"
            title={t('activities.add_card')}
          >
            <Plus size={12} />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              ungroup()
            }}
            className="p-1.5 bg-neutral-200 hover:bg-neutral-300 text-neutral-600 rounded-md transition-colors text-xs"
            title={t('activities.ungroup_cards')}
          >
            <Ungroup size={12} />
          </button>
        </div>
      )}
    </NodeViewWrapper>
  )
}

export default FlipcardGridExtension
