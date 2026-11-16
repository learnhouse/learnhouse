'use client'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Hexagon, Smiley, Trash } from '@phosphor-icons/react'
import { Popover, PopoverContent, PopoverTrigger } from '@components/ui/popover'
import { EmojiPickerPanel } from '@components/Messaging/ui/EmojiPicker'
import { Button } from '@components/Dashboard/Shared/DashKit/DashKit'

// The chapter's icon tile: shows its emoji, or a neutral hexagon that turns
// into an "add emoji" smiley on hover. Clicking opens the emoji picker.
export function ChapterEmojiButton({
  emoji,
  onChange,
  size = 'md',
  disabled,
}: {
  emoji: string
  onChange: (emoji: string) => void
  size?: 'md' | 'lg'
  disabled?: boolean
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const tile = size === 'lg' ? 'w-10 h-10 text-xl' : 'w-9 h-9 text-lg'

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={emoji ? t('dashboard.courses.editor.chapter_emoji.change') : t('dashboard.courses.editor.chapter_emoji.add')}
          title={emoji ? t('dashboard.courses.editor.chapter_emoji.change') : t('dashboard.courses.editor.chapter_emoji.add')}
          // Keep the chapter card from starting a drag on this tile.
          onMouseDown={(e) => e.stopPropagation()}
          className={`group/emoji ${tile} shrink-0 rounded-xl flex items-center justify-center leading-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/20 ${
            emoji
              ? 'bg-neutral-50 ring-1 ring-inset ring-neutral-200/70 hover:bg-neutral-100'
              : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200/70 hover:text-neutral-800'
          }`}
        >
          {emoji ? (
            <span aria-hidden="true">{emoji}</span>
          ) : (
            <>
              <Hexagon weight="bold" size={16} className="group-hover/emoji:hidden group-focus-visible/emoji:hidden" />
              <Smiley size={17} className="hidden group-hover/emoji:block group-focus-visible/emoji:block" />
            </>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-auto p-0 border-0 bg-transparent shadow-none">
        <div className="rounded-xl overflow-hidden bg-white nice-shadow">
          <EmojiPickerPanel
            onPick={(value) => {
              onChange(value)
              setOpen(false)
            }}
          />
          {emoji && (
            <div className="flex items-center justify-between gap-3 border-t border-neutral-100 px-3 py-2">
              <span className="text-xs text-neutral-500">
                {t('dashboard.courses.editor.chapter_emoji.current')} <span aria-hidden="true">{emoji}</span>
              </span>
              <Button
                size="sm"
                variant="danger-ghost"
                icon={<Trash size={12} />}
                onClick={() => {
                  onChange('')
                  setOpen(false)
                }}
              >
                {t('dashboard.courses.editor.chapter_emoji.remove')}
              </Button>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
