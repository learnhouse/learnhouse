'use client'
/*
 Flipcard grid: lays its flipcards out side by side. In the editor the
 original control row under the grid sets the column count, adds a card or
 ungroups the cards back into stacked blocks, and can now style every card
 at once. Each card has its own row (drag to reorder, size, look, duplicate,
 delete), see FlipcardExtension.
*/
import { NodeViewContent, NodeViewWrapper } from '@tiptap/react'
import React from 'react'
import { Palette, Plus, Rows } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { useEditorProvider } from '@components/Contexts/Editor/EditorContext'
import EditorBlockFrame from '../../Blocks/ui/EditorBlockFrame'
import { BlockPopover } from '../../Blocks/ui/BlockChrome'
import { isCompactFlipcardGrid } from './compactGrid'
import { CardControl, ControlDivider } from './FlipcardExtension'
import { FlipcardStylePicker, type FlipcardLook } from './FlipcardStylePicker'
import { NEW_CARD_TEXT, applyToAllCards, insertCard, requestCardFocus, ungroupGrid } from './flipcardOps'

const COLUMN_OPTIONS = [2, 3, 4]

/** Column-count glyph (the original used lucide's Columns2/3/4). */
function ColumnsGlyph({ n }: { n: number }) {
  const w = 10 / n
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
      <rect x="1" y="1.5" width="10" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
      {Array.from({ length: n - 1 }, (_, i) => (
        <line key={i} x1={1 + w * (i + 1)} y1="1.5" x2={1 + w * (i + 1)} y2="10.5" stroke="currentColor" strokeWidth="1.2" />
      ))}
    </svg>
  )
}

const FlipcardGridExtension: React.FC = (props: any) => {
  const { t } = useTranslation()
  const editorState = useEditorProvider() as any
  const isEditable = !!editorState?.isEditable
  const columns: number = props.node.attrs.columns || 2
  const [lookOpen, setLookOpen] = React.useState(false)

  const gridPos = () => (typeof props.getPos === 'function' ? props.getPos() : null)

  // New cards copy the look of the last one, so a styled deck stays consistent.
  const addCard = () => {
    const pos = gridPos()
    if (typeof pos !== 'number') return
    const last = props.node.lastChild?.attrs ?? {}
    const at = insertCard(props.editor, pos, {
      color: last.color ?? 'blue',
      style: last.style ?? 'solid',
      size: last.size ?? 'medium',
      alignment: 'center',
      ...NEW_CARD_TEXT,
    })
    if (at >= 0) requestCardFocus(pos, at, 'text')
  }

  const first = props.node.firstChild?.attrs ?? {}
  const applyAll = (patch: FlipcardLook) => {
    const pos = gridPos()
    if (typeof pos === 'number') applyToAllCards(props.editor, pos, patch as Record<string, unknown>)
  }

  return (
    <NodeViewWrapper
      className="flipcard-grid my-4"
      data-reorder-list=""
      // Short-term grids stay two-up on phones (mobile-activities.css).
      data-compact={isCompactFlipcardGrid(props.node) ? '' : undefined}
      style={{ ['--flipcard-grid-columns' as any]: columns }}
    >
      <EditorBlockFrame editable={isEditable} node={props.node} editor={props.editor} getPos={props.getPos} selected={props.selected} tone="interactive">
        {/* The column count rides a CSS variable rather than a Tailwind class:
            Tiptap injects its own content holder inside this element, so the grid
            has to be declared in CSS where that holder can be dissolved. */}
        <NodeViewContent className="flipcard-grid-content" />

        {isEditable && (
          <div
            className={'flex mt-3 gap-1 justify-center transition-opacity ' + (lookOpen ? 'opacity-100' : 'opacity-60 hover:opacity-100 focus-within:opacity-100')}
            contentEditable={false}
          >
            {COLUMN_OPTIONS.map((value) => (
              <CardControl
                key={value}
                active={columns === value}
                onClick={() => props.updateAttributes({ columns: value })}
                title={t(`activities.grid_columns_${value}`)}
                aria-label={t(`activities.grid_columns_${value}`)}
              >
                <ColumnsGlyph n={value} />
              </CardControl>
            ))}
            <ControlDivider />
            <CardControl onClick={addCard} title={t('activities.add_card')} aria-label={t('activities.add_card')}>
              <Plus weight="bold" size={12} />
            </CardControl>
            <BlockPopover
              open={lookOpen}
              onOpenChange={setLookOpen}
              align="center"
              title={t('editor.blocks_v2.flipcard.look_all', 'Style every card')}
              width={264}
              trigger={
                <CardControl title={t('editor.blocks_v2.flipcard.look_all', 'Style every card')} aria-label={t('editor.blocks_v2.flipcard.look_all', 'Style every card')}>
                  <Palette weight="duotone" size={12} />
                </CardControl>
              }
            >
              <FlipcardStylePicker look={{ color: first.color, style: first.style, size: first.size }} onChange={applyAll} />
            </BlockPopover>
            <CardControl
              onClick={() => {
                const pos = gridPos()
                if (typeof pos === 'number') ungroupGrid(props.editor, pos)
              }}
              title={t('activities.ungroup_cards')}
              aria-label={t('activities.ungroup_cards')}
            >
              <Rows weight="duotone" size={12} />
            </CardControl>
          </div>
        )}
      </EditorBlockFrame>
    </NodeViewWrapper>
  )
}

export default FlipcardGridExtension
