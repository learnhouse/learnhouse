'use client'
/*
 Selection menu pieces added by the block upgrades: the text alignment
 control and the "Math" action that turns the selected text into an inline
 formula. Both only show where the editor has the extension behind them.
*/
import React from 'react'
import { Check, TextAlignCenter, TextAlignJustify, TextAlignLeft, TextAlignRight } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { readTextAlign, type TextAlignment } from '../schema/blockAttrs'
import { latexFromSelection } from '../../Extensions/Plus/upgrades/upgradesModel'

export const ALIGN_ICON: Record<TextAlignment, React.ElementType> = {
  start: TextAlignLeft,
  center: TextAlignCenter,
  end: TextAlignRight,
  justify: TextAlignJustify,
}

/** The alignment of the block the selection starts in (null = default, start). */
export function selectionTextAlign(editor: any): TextAlignment | null {
  return readTextAlign(editor.getAttributes('heading').textAlign) ?? readTextAlign(editor.getAttributes('paragraph').textAlign)
}

export function canAlignText(editor: any): boolean {
  return typeof editor?.commands?.setTextAlign === 'function' && (editor.isActive('paragraph') || editor.isActive('heading'))
}

export function canMakeInlineMath(editor: any): boolean {
  if (!editor?.schema?.nodes?.inlineMath) return false
  const { from, to, $from, $to } = editor.state.selection
  return from !== to && $from.sameParent($to) && $from.parent.inlineContent && !$from.parent.type.spec.code
}

/** Replace the selected text with an inline formula holding it as LaTeX. */
export function selectionToInlineMath(editor: any): boolean {
  const { from, to } = editor.state.selection
  const latex = latexFromSelection(editor.state.doc.textBetween(from, to, ' ', ' '))
  if (!latex) return false
  return editor.chain().focus().insertContentAt({ from, to }, { type: 'inlineMath', attrs: { latex } }).run()
}

/**
 * Start / center / end / justify. "Start" clears the attribute, so text that
 * is left as it was keeps storing nothing.
 */
export function AlignPanel({ editor, current, className, itemClass, onDone }: {
  editor: any
  current: TextAlignment | null
  className?: string
  itemClass: string
  onDone: () => void
}) {
  const { t } = useTranslation()
  const labels: Record<TextAlignment, string> = {
    start: t('editor.blocks_v2.align.start', 'Align to start'),
    center: t('editor.blocks_v2.align.center', 'Center'),
    end: t('editor.blocks_v2.align.end', 'Align to end'),
    justify: t('editor.blocks_v2.align.justify', 'Justify'),
  }
  const active = current ?? 'start'
  return (
    <div role="menu" aria-label={t('editor.blocks_v2.align.label', 'Text alignment')} className={className}>
      {(Object.keys(ALIGN_ICON) as TextAlignment[]).map((a) => {
        const Icon = ALIGN_ICON[a]
        return (
          <button
            key={a}
            type="button"
            role="menuitemradio"
            aria-checked={active === a}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              const chain = editor.chain().focus()
              if (a === 'start') chain.unsetTextAlign().run()
              else chain.setTextAlign(a).run()
              onDone()
            }}
            className={cn(itemClass, active === a && 'bg-neutral-100')}
          >
            <Icon size={16} className="text-neutral-500 rtl:-scale-x-100" />
            <span className="flex-1">{labels[a]}</span>
            {active === a && <Check size={13} className="text-neutral-500" />}
          </button>
        )
      })}
    </div>
  )
}
