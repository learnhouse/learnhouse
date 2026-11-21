'use client'
/*
 InlineText: text the author edits right where learners will read it.

 It wraps DraftText (local draft, live commits after a pause, Escape reverts)
 and inherits the typography of the element it stands in for: pass the same
 font size / weight / colour classes in `className`. No input box: a dashed
 underline on hover and a soft ring while focused (styles/experiences.css,
 .lh-exp-edit). Enter commits; in `multiline` fields Shift+Enter adds a line.

 `fit` sizes the field to its text (chips, pills, tiles in a row) instead of
 filling the line: an invisible copy of the text sets the width and height,
 and the textarea lies over it.
*/
import React from 'react'
import DraftText, { type DraftTextHandle } from '../../../Blocks/ui/DraftText'
import { cn } from '@/lib/utils'

export type InlineTextHandle = DraftTextHandle

export interface InlineTextProps {
  value: string
  onCommit: (_value: string) => void
  /** Screen-reader name of the field (required: there is no visible label). */
  ariaLabel: string
  placeholder?: string
  multiline?: boolean
  maxLength?: number
  /** Typography of the element it replaces (size, weight, colour, alignment). */
  className?: string
  /** Size to the text instead of filling the line. */
  fit?: boolean
  autoFocus?: boolean
  /** Enter (after the commit). Without it Enter commits and leaves the field. */
  onEnter?: (_value: string) => void
  onEmptyBackspace?: () => void
  onFocusChange?: (_focused: boolean) => void
}

export const InlineText = React.forwardRef<InlineTextHandle, InlineTextProps>(function InlineText(
  { value, onCommit, ariaLabel, placeholder, multiline = false, maxLength, className, fit = false, autoFocus, onEnter, onEmptyBackspace, onFocusChange },
  ref,
) {
  const [draft, setDraft] = React.useState(value)
  const wrap = React.useRef<HTMLSpanElement>(null)
  // Multiline fields still commit on Enter (Shift+Enter is the newline).
  const enter = onEnter ?? (multiline ? () => wrap.current?.querySelector('textarea')?.blur() : undefined)

  const field = (
    <DraftText
      ref={ref}
      value={value}
      onCommit={onCommit}
      ariaLabel={ariaLabel}
      placeholder={placeholder}
      multiline={multiline}
      maxLength={maxLength}
      autoFocus={autoFocus}
      onEnter={enter}
      onEmptyBackspace={onEmptyBackspace}
      onFocusChange={onFocusChange}
      onDraftChange={setDraft}
      className={cn('m-0 p-0 [text-align:inherit] placeholder:text-current placeholder:opacity-40', fit && 'absolute inset-0 h-full')}
    />
  )

  if (!fit) {
    return (
      <span ref={wrap} data-empty={draft ? undefined : ''} className={cn('lh-exp-edit block min-w-0', className)}>
        {field}
      </span>
    )
  }
  return (
    <span ref={wrap} data-empty={draft ? undefined : ''} className={cn('lh-exp-edit inline-block max-w-full min-w-[2ch] align-top', className)}>
      {/* Sets the size; the textarea lies over it (3px wider, room for the caret). The zero-width space keeps a trailing newline's height. */}
      <span aria-hidden className="lh-exp-edit-mirror invisible block pe-[3px] whitespace-pre-wrap [overflow-wrap:anywhere]">
        {draft || placeholder || ' '}
        {'​'}
      </span>
      {field}
    </span>
  )
})

export default InlineText
