'use client'
import React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Sparkles } from 'lucide-react'

type AIFollowUpSuggestionsProps = {
  suggestions: string[]
  onSuggestionClick: (suggestion: string) => void
  disabled?: boolean
}

function AIFollowUpSuggestions({
  suggestions,
  onSuggestionClick,
  disabled = false,
}: AIFollowUpSuggestionsProps) {
  if (!suggestions || suggestions.length === 0) {
    return null
  }

  return (
    <div className="flex flex-col items-center gap-2 mt-3 mb-2">
      <div className="flex items-center gap-1.5 text-white/40 text-xs">
        <Sparkles size={12} />
        <span>Follow-up suggestions</span>
      </div>
      <AnimatePresence>
        <div className="flex flex-wrap justify-center gap-2">
          {suggestions.map((suggestion, index) => (
            <motion.button
              key={`${suggestion}-${index}`}
              initial={{ opacity: 0, y: 8, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -5, scale: 0.98 }}
              transition={{
                type: 'spring',
                stiffness: 400,
                damping: 25,
                mass: 0.8,
                delay: index * 0.08,
              }}
              onClick={() => !disabled && onSuggestionClick(suggestion)}
              disabled={disabled}
              className={`
                flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium
                bg-white/5 border border-white/10 text-white/60
                transition-all duration-200 ease-out
                ${
                  disabled
                    ? 'opacity-50 cursor-not-allowed'
                    : 'hover:bg-white/10 hover:text-white/80 hover:border-white/20 cursor-pointer hover:scale-[1.02]'
                }
              `}
            >
              <span className="truncate max-w-[250px]">{suggestion}</span>
            </motion.button>
          ))}
        </div>
      </AnimatePresence>
    </div>
  )
}

export default AIFollowUpSuggestions
