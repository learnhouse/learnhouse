import React, { useState } from 'react'
import { Sparkles } from 'lucide-react'
import AIImagePicker from './AIImagePicker'

// Drop-in trigger for the shared AI image generator. Place next to an existing
// Unsplash button on any image-upload surface; it manages its own modal state,
// so wiring a new surface is a single line:
//   <AIImageButton onSelect={handleSelect} />
// onSelect receives an absolute image URL (same contract as UnsplashImagePicker).
interface AIImageButtonProps {
  onSelect: (_imageUrl: string) => void
  className?: string
  label?: string
  variant?: 'button' | 'chip'
}

const AIImageButton: React.FC<AIImageButtonProps> = ({
  onSelect,
  className,
  label = 'Generate with AI',
  variant = 'button',
}) => {
  const [open, setOpen] = useState(false)

  const base =
    variant === 'chip'
      ? 'px-3 py-1 bg-neutral-100 rounded-lg hover:bg-neutral-200 nice-shadow transition-colors flex items-center gap-1.5 text-sm'
      : 'px-3 py-2 bg-neutral-900 text-white rounded-lg hover:bg-neutral-800 nice-shadow transition-colors flex items-center gap-1.5 text-sm'

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className || base}>
        <Sparkles size={15} />
        {label}
      </button>
      {open && (
        <AIImagePicker
          isOpen={open}
          onSelect={onSelect}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

export default AIImageButton
