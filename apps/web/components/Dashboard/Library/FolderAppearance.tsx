'use client'
import { FOLDER_COLORS } from '@components/Dashboard/Library/LibraryToolbar'
import { Check, ImagePlus, X } from 'lucide-react'
import React from 'react'
import { useTranslation } from 'react-i18next'

type Props = {
  color: string
  onColorChange: (_c: string) => void
  file: File | null
  onFileChange: (_f: File | null) => void
  existingThumbUrl?: string | null
}

export default function FolderAppearance({ color, onColorChange, file, onFileChange, existingThumbUrl }: Props) {
  const { t } = useTranslation()
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [objectUrl, setObjectUrl] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!file) {
      setObjectUrl(null)
      return
    }
    const url = URL.createObjectURL(file)
    setObjectUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  const preview = objectUrl || existingThumbUrl || null

  return (
    <div className="flex flex-col gap-3">
      {/* Color */}
      <div>
        <span className="text-sm font-medium text-gray-700">{t('library.color')}</span>
        <div className="flex flex-wrap gap-2 mt-1.5">
          {Object.entries(FOLDER_COLORS).map(([key, c]) => (
            <button
              key={key}
              type="button"
              aria-label={key}
              onClick={() => onColorChange(key)}
              className={`w-7 h-7 rounded-full flex items-center justify-center transition-transform hover:scale-110 ${c.dot} ${
                color === key ? 'ring-2 ring-offset-2 ring-gray-300' : ''
              }`}
            >
              {color === key && <Check size={14} className="text-white" strokeWidth={3} />}
            </button>
          ))}
        </div>
      </div>

      {/* Cover image */}
      <div>
        <span className="text-sm font-medium text-gray-700">{t('library.thumbnail')}</span>
        {preview ? (
          <div className="mt-1.5 flex items-center gap-3 rounded-xl border border-gray-200 p-2.5">
            {/* The thumbnail itself is the (replace) file input — real click target */}
            <label className="relative w-14 h-14 rounded-lg bg-cover bg-center flex-shrink-0 ring-1 ring-inset ring-black/10 cursor-pointer overflow-hidden" style={{ backgroundImage: `url(${preview})` }}>
              <input type="file" accept="image/*" className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" onChange={(e) => onFileChange(e.target.files?.[0] || null)} />
            </label>
            <label className="text-sm font-medium text-gray-600 hover:text-gray-900 cursor-pointer relative">
              {t('library.replace_cover')}
              <input type="file" accept="image/*" className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" onChange={(e) => onFileChange(e.target.files?.[0] || null)} />
            </label>
            <button type="button" onClick={() => onFileChange(null)} className="ml-auto text-gray-400 hover:text-rose-600 p-1" aria-label="Remove cover">
              <X size={16} />
            </button>
          </div>
        ) : (
          <label className="mt-1.5 relative block w-full rounded-xl border-2 border-dashed border-gray-200 bg-gray-50/60 hover:bg-gray-100/60 transition-colors py-5 cursor-pointer">
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              onChange={(e) => onFileChange(e.target.files?.[0] || null)}
            />
            <div className="pointer-events-none flex flex-col items-center justify-center gap-1 text-center">
              <ImagePlus className="w-5 h-5 text-gray-400" />
              <span className="text-sm font-semibold text-gray-700">{t('media.choose_file')}</span>
              <span className="text-xs text-gray-400">{t('library.cover_hint')}</span>
            </div>
          </label>
        )}
      </div>
    </div>
  )
}
