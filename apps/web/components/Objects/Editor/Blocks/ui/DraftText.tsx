'use client'
/*
 Inline text field for block interiors (quiz questions/options, flipcard
 faces). Keeps a local draft while focused and commits once on blur (or
 Enter when `onEnter` is set), so collaborators get one update per edit
 instead of one per keystroke. While not focused it follows the stored value,
 so undo and remote edits show up.

 Escape reverts the draft. The draft lives in a ref as well as in state:
 blur() called from the keydown handler runs the blur handler of the CURRENT
 render, which would otherwise still see the old draft.
*/
import React from 'react'
import { cn } from '@/lib/utils'

export interface DraftTextHandle {
  focus: (_atEnd?: boolean) => void
}

interface Props {
  value: string
  onCommit: (_value: string) => void
  placeholder?: string
  ariaLabel?: string
  className?: string
  /** Enter commits and calls this (Shift+Enter still inserts a newline when multiline). */
  onEnter?: (_value: string) => void
  /** Backspace in an empty field. */
  onEmptyBackspace?: () => void
  multiline?: boolean
  maxLength?: number
  autoFocus?: boolean
  dir?: 'auto' | 'ltr' | 'rtl'
  onFocusChange?: (_focused: boolean) => void
}

export const DraftText = React.forwardRef<DraftTextHandle, Props>(function DraftText(
  { value, onCommit, placeholder, ariaLabel, className, onEnter, onEmptyBackspace, multiline = true, maxLength, autoFocus, dir = 'auto', onFocusChange },
  ref,
) {
  const [draft, setDraft] = React.useState(value)
  const draftRef = React.useRef(value)
  const editing = React.useRef(false)
  // What this field last committed (or found on focus): blur only commits a change.
  const committed = React.useRef(value)
  const el = React.useRef<HTMLTextAreaElement>(null)

  React.useEffect(() => {
    if (!editing.current) {
      setDraft(value)
      draftRef.current = value
    }
  }, [value])

  // Grow with the text instead of scrolling inside a tiny box.
  React.useLayoutEffect(() => {
    const t = el.current
    if (!t) return
    t.style.height = '0px'
    t.style.height = `${t.scrollHeight}px`
  }, [draft])

  React.useImperativeHandle(ref, () => ({
    focus: (atEnd = true) => {
      const t = el.current
      if (!t) return
      t.focus({ preventScroll: false })
      if (atEnd) t.setSelectionRange(t.value.length, t.value.length)
    },
  }))

  React.useEffect(() => {
    if (autoFocus) el.current?.focus()
    // Only on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const commit = () => {
    editing.current = false
    onFocusChange?.(false)
    if (draftRef.current !== committed.current) {
      committed.current = draftRef.current
      onCommit(draftRef.current)
    }
  }

  return (
    <textarea
      ref={el}
      rows={1}
      dir={dir}
      value={draft}
      maxLength={maxLength}
      placeholder={placeholder}
      aria-label={ariaLabel}
      spellCheck
      className={cn('block w-full resize-none overflow-hidden bg-transparent outline-none placeholder:text-neutral-400', className)}
      onFocus={() => {
        editing.current = true
        committed.current = value
        onFocusChange?.(true)
      }}
      onChange={(e) => {
        const next = multiline ? e.target.value : e.target.value.replace(/\n/g, ' ')
        draftRef.current = next
        setDraft(next)
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        // Let editor-wide shortcuts (save, undo outside fields…) through.
        if (!e.metaKey && !e.ctrlKey) e.stopPropagation()
        if (e.key === 'Escape') {
          e.preventDefault()
          draftRef.current = committed.current
          setDraft(committed.current)
          e.currentTarget.blur()
          return
        }
        if (e.key === 'Enter' && !e.nativeEvent.isComposing && (onEnter || !multiline) && !(multiline && e.shiftKey)) {
          e.preventDefault()
          const v = draftRef.current
          if (v !== committed.current) {
            committed.current = v
            onCommit(v)
          }
          if (onEnter) onEnter(v)
          else e.currentTarget.blur()
          return
        }
        if (e.key === 'Backspace' && onEmptyBackspace && draftRef.current === '') {
          e.preventDefault()
          committed.current = ''
          onEmptyBackspace()
        }
      }}
    />
  )
})

export default DraftText
