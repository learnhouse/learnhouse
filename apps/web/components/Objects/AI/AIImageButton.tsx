import React, { useState } from 'react'
import { Sparkle } from '@phosphor-icons/react'
import AIImagePicker from './AIImagePicker'

// Drop-in trigger for the shared AI image generator. Place next to an existing
// Unsplash button on any image-upload surface; it manages its own modal state,
// so wiring a new surface is a single line:
//   <AIImageButton onSelect={handleSelect} />
// onSelect receives an absolute image URL (same contract as UnsplashImagePicker).
interface AIImageButtonProps {
  onSelect: (_imageUrl: string) => void
  // Upload surfaces pass this to receive a ready-to-upload File (fetched
  // same-origin via the API), instead of re-fetching a cross-origin URL.
  onSelectFile?: (_file: File) => void | Promise<void>
  className?: string
  label?: string
  variant?: 'button' | 'chip'
}

const AIImageButton: React.FC<AIImageButtonProps> = ({
  onSelect,
  onSelectFile,
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
        <Sparkle weight="duotone" size={15} />
        {label}
      </button>
      {open && (
        <AIImagePicker
          isOpen={open}
          onSelect={onSelect}
          onSelectFile={onSelectFile}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

export default AIImageButton
