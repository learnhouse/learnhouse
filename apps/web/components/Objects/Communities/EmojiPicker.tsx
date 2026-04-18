'use client'
import React, { useState } from 'react'
import { X } from 'lucide-react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@components/ui/popover'

// Common emojis organized by category
const EMOJI_CATEGORIES = {
  'Smileys': ['😀', '😃', '😄', '😁', '😅', '😂', '🤣', '😊', '😇', '🙂', '😉', '😌', '😍', '🥰', '😘'],
  'Gestures': ['👍', '👎', '👏', '🙌', '🤝', '✌️', '🤞', '🤟', '🤙', '👋', '🖐️', '✋', '🖖', '💪', '🙏'],
  'Hearts': ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '💖', '💝', '💘', '💕', '💓', '💗', '💞'],
  'Objects': ['💡', '🔥', '⭐', '🌟', '✨', '💫', '🎯', '🎨', '📚', '💻', '🚀', '🎉', '🎊', '🏆', '🥇'],
  'Nature': ['🌈', '☀️', '🌙', '⚡', '🌸', '🌺', '🌻', '🍀', '🌲', '🌴', '🌵', '🍁', '🍂', '🌾', '🐝'],
  'Food': ['🍎', '🍊', '🍋', '🍇', '🍓', '🍒', '🍑', '🥝', '🍕', '🍔', '🍟', '☕', '🍵', '🧁', '🍰'],
}

interface EmojiPickerProps {
  value: string | null
  onChange: (emoji: string | null) => void
  triggerClassName?: string
  disabled?: boolean
}

export function EmojiPicker({ value, onChange, triggerClassName, disabled = false }: EmojiPickerProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [activeCategory, setActiveCategory] = useState<string>('Smileys')

  const handleSelectEmoji = (emoji: string) => {
    onChange(emoji)
    setIsOpen(false)
  }

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!disabled) onChange(null)
  }

  return (
    <Popover open={disabled ? false : isOpen} onOpenChange={disabled ? undefined : setIsOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={triggerClassName || `flex items-center justify-center w-12 h-12 rounded-lg border-2 border-dashed border-gray-300 hover:border-gray-400 transition-colors ${value ? 'border-solid border-gray-200 bg-gray-50' : ''}`}
        >
          {value ? (
            <div className="relative">
              <span className="text-2xl">{value}</span>
              <button
                onClick={handleClear}
                className="absolute -top-2 -right-2 w-4 h-4 bg-gray-500 hover:bg-gray-600 text-white rounded-full flex items-center justify-center"
              >
                <X size={10} />
              </button>
            </div>
          ) : (
            <span className="text-xl text-gray-400">+</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start" side="bottom" style={{ zIndex: 9999 }}>
        {/* Category tabs */}
        <div className="flex overflow-x-auto border-b border-gray-100 px-1 py-1 gap-1">
          {Object.keys(EMOJI_CATEGORIES).map((category) => (
            <button
              key={category}
              type="button"
              onClick={() => setActiveCategory(category)}
              className={`px-2.5 py-1.5 text-xs font-medium rounded-md whitespace-nowrap transition-colors ${
                activeCategory === category
                  ? 'bg-gray-100 text-gray-900'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
              }`}
            >
              {category}
            </button>
          ))}
        </div>

        {/* Emoji grid */}
        <div className="p-2 max-h-48 overflow-y-auto">
          <div className="grid grid-cols-8 gap-1">
            {EMOJI_CATEGORIES[activeCategory as keyof typeof EMOJI_CATEGORIES].map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => handleSelectEmoji(emoji)}
                className={`w-8 h-8 flex items-center justify-center text-lg rounded hover:bg-gray-100 transition-colors ${
                  value === emoji ? 'bg-indigo-100' : ''
                }`}
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>

        {/* Clear button */}
        {value && (
          <div className="px-2 pb-2">
            <button
              type="button"
              onClick={() => {
                onChange(null)
                setIsOpen(false)
              }}
              className="w-full py-1.5 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-50 rounded-md transition-colors"
            >
              Remove emoji
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

export default EmojiPicker
