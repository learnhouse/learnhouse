'use client'
/*
 Caption under a media block.

 Editor: a quiet inline field ("Add a caption") that commits on blur/Enter,
 so collaborators get one attr update per edit, not one per keystroke.
 Learner: a <figcaption>, rendered only when there is a caption, so blocks
 saved before captions existed render exactly as they did.
*/
import React from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { CommitInput } from './BlockChrome'

interface BlockCaptionProps {
  value: string | null | undefined
  editable: boolean
  onCommit?: (_value: string) => void
  /** Show the empty field only while the block is hovered or selected. */
  selected?: boolean
  align?: 'start' | 'center' | 'end'
  className?: string
  style?: React.CSSProperties
}

export function BlockCaption({ value, editable, onCommit, selected, align = 'center', className, style }: BlockCaptionProps) {
  const { t } = useTranslation()
  const text = (value || '').trim()
  const alignClass = align === 'start' ? 'text-start' : align === 'end' ? 'text-end' : 'text-center'

  if (!editable) {
    if (!text) return null
    return (
      <figcaption
        className={cn('mt-2 text-[13px] leading-snug text-neutral-500 whitespace-pre-line', alignClass, className)}
        style={style}
      >
        {text}
      </figcaption>
    )
  }

  return (
    <div
      className={cn(
        'mt-1.5 transition-opacity',
        text || selected ? 'opacity-100' : 'opacity-0 group-hover/block:opacity-100 focus-within:opacity-100',
        className,
      )}
      style={style}
    >
      <CommitInput
        value={value || ''}
        onCommit={(v) => onCommit?.(v.trim())}
        placeholder={t('editor.blocks_v2.caption_placeholder', 'Add a caption…')}
        aria-label={t('editor.blocks_v2.caption', 'Caption')}
        maxLength={500}
        className={cn(
          'w-full bg-transparent px-1 py-0.5 text-[13px] leading-snug text-neutral-500 outline-none placeholder:text-neutral-300 focus:text-neutral-700 rounded-md focus:bg-neutral-50',
          alignClass,
        )}
      />
    </div>
  )
}

export default BlockCaption
