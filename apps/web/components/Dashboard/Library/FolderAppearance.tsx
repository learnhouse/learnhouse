'use client'
import { FOLDER_COLORS, folderTone } from '@components/Dashboard/Library/LibraryToolbar'
import { FieldLabel } from '@components/Dashboard/Shared/DashKit/DashKit'
import { Check, FolderSimple, ImageSquare, X } from '@phosphor-icons/react'
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
  const pick = (e: React.ChangeEvent<HTMLInputElement>) => onFileChange(e.target.files?.[0] || null)

  return (
    <div className="grid gap-5 sm:grid-cols-[1fr_auto] sm:items-start">
      <div>
        <FieldLabel hint={t('library.dash.color_hint')}>{t('library.color')}</FieldLabel>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('library.color')}>
          {Object.entries(FOLDER_COLORS).map(([key, c]) => (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={color === key}
              aria-label={key}
              onClick={() => onColorChange(key)}
              className={`w-7 h-7 rounded-full flex items-center justify-center transition-transform hover:scale-110 ${c.dot} ${
                color === key ? 'ring-2 ring-offset-2 ring-neutral-900/30' : ''
              }`}
            >
              {color === key && <Check size={13} weight="bold" className="text-white" />}
            </button>
          ))}
        </div>
      </div>

      {/* Cover: the tile shows what the folder card will look like. */}
      <div>
        <FieldLabel>{t('library.thumbnail')}</FieldLabel>
        <div className="flex items-center gap-3">
          <label
            className="relative w-14 h-14 rounded-xl overflow-hidden shrink-0 cursor-pointer ring-1 ring-inset ring-black/5 group"
            title={t('media.choose_file')}
          >
            {preview ? (
              <span className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url(${preview})` }} />
            ) : (
              <span className={`absolute inset-0 flex items-center justify-center ${folderTone(color)}`}>
                <FolderSimple size={26} weight="fill" />
              </span>
            )}
            <span className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center text-white opacity-0 group-hover:opacity-100">
              <ImageSquare size={18} />
            </span>
            <input type="file" accept="image/*" className="absolute inset-0 opacity-0 cursor-pointer" onChange={pick} />
          </label>
          <div className="flex flex-col gap-0.5 min-w-0">
            <label className="relative text-xs font-semibold text-neutral-700 hover:text-neutral-900 cursor-pointer">
              {preview ? t('library.replace_cover') : t('media.choose_file')}
              <input type="file" accept="image/*" className="absolute inset-0 opacity-0 cursor-pointer" onChange={pick} />
            </label>
            {file ? (
              <button
                type="button"
                onClick={() => onFileChange(null)}
                className="inline-flex items-center gap-1 text-xs text-neutral-400 hover:text-rose-600 text-start"
              >
                <X size={11} /> {t('library.remove_thumbnail')}
              </button>
            ) : (
              <span className="text-xs text-neutral-400">{t('library.cover_hint')}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
