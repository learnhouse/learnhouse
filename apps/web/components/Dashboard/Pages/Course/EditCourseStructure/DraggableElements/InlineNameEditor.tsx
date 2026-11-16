'use client'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'

// Inline rename field for chapters and activities. Enter or leaving the field
// keeps the new name (staged for the header Save); Escape puts the old one back.
export function InlineNameEditor({
  initial,
  placeholder,
  onCommit,
  onCancel,
  className = '',
}: {
  initial: string
  placeholder?: string
  onCommit: (name: string) => void
  onCancel: () => void
  className?: string
}) {
  const { t } = useTranslation()
  const [value, setValue] = useState(initial)

  const commit = () => {
    const name = value.trim()
    // An empty name is never a rename.
    if (!name) onCancel()
    else onCommit(name)
  }

  return (
    <div className={`flex items-center gap-2 min-w-0 ${className}`}>
      <input
        type="text"
        autoFocus
        value={value}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(e) => setValue(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            onCancel()
          }
        }}
        // Keep drag-and-drop from grabbing key presses and clicks in the field.
        onMouseDown={(e) => e.stopPropagation()}
        className="h-8 w-full min-w-0 rounded-lg bg-white ring-2 ring-neutral-900/15 px-2.5 text-[inherit] font-[inherit] text-neutral-900 outline-hidden"
      />
      <span className="hidden sm:inline text-[11px] text-neutral-400 whitespace-nowrap">
        {t('dashboard.courses.editor.content.rename_hint')}
      </span>
    </div>
  )
}
