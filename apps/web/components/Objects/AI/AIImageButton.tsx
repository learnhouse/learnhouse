import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import AIImagePicker from './AIImagePicker'
import { AIMark, aiButtonClass } from './AIBrand'

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
  label,
  variant = 'button',
}) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  // Callers usually pass their own className to sit in a row of sibling
  // buttons; the AI mark is what brands it either way.
  const base = variant === 'chip' ? aiButtonClass('soft', 'sm') : aiButtonClass('solid', 'md')

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className || base}>
        {variant === 'button' && !className ? (
          <AIMark size={18} alt="" />
        ) : (
          <AIMark size={16} alt="" />
        )}
        {label ?? t('ai.image_picker.button_label')}
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
