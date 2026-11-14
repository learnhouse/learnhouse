'use client'
import React, { useState, useMemo, useRef, useEffect, useId } from 'react'
import { Check, CaretUpDown, X } from '@phosphor-icons/react'
import { Button, INPUT } from '@components/Dashboard/Shared/DashKit/DashKit'
import { Popover, PopoverContent, PopoverTrigger } from '@components/ui/popover'
import { CURATED_FONTS, DEFAULT_FONT, getGoogleFontPreviewUrl } from '@/lib/fonts'
import allGoogleFonts from '@/lib/google-fonts-catalog.json'
import { cn } from '@/lib/utils'
import { useTranslation } from 'react-i18next'

interface FontSelectorProps {
  value: string
  onChange: (_font: string) => void
  /** Shown when no font is picked (defaults to the platform font). */
  emptyLabel?: string
  /** Hide the sample box under the picker. */
  hideSample?: boolean
  /** Accessible name of the picker button. */
  ariaLabel?: string
}

function ensureFontLoaded(font: string) {
  if (!font || font === DEFAULT_FONT) return
  const id = `font-preview-${font.replace(/\s/g, '-')}`
  if (document.getElementById(id)) return
  const link = document.createElement('link')
  link.id = id
  link.rel = 'stylesheet'
  link.href = getGoogleFontPreviewUrl(font)
  document.head.appendChild(link)
}

export default function FontSelector({ value, onChange, emptyLabel, hideSample = false, ariaLabel }: FontSelectorProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const listId = `font-selector-list-${useId().replace(/:/g, '')}`

  const filteredFonts = useMemo(() => {
    if (!search.trim()) return CURATED_FONTS
    const query = search.toLowerCase()
    return (allGoogleFonts as string[]).filter((f) => f.toLowerCase().includes(query)).slice(0, 50)
  }, [search])

  const showingFullCatalog = search.trim().length > 0

  // The chosen font has to be loaded for the live preview on the page.
  useEffect(() => {
    ensureFontLoaded(value)
  }, [value])

  // Fonts in the open list load on demand so each row previews itself.
  useEffect(() => {
    if (!open) return
    filteredFonts.forEach(ensureFontLoaded)
  }, [open, filteredFonts])

  const handleSelect = (font: string) => {
    onChange(font)
    setOpen(false)
    setSearch('')
  }

  const displayValue = value || emptyLabel || `${DEFAULT_FONT} (${t('dashboard.organization.branding.theme.default')})`

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              role="combobox"
              aria-expanded={open}
              aria-label={ariaLabel}
              aria-controls={listId}
              className={`${INPUT} !w-72 max-w-full flex items-center justify-between text-start cursor-pointer`}
            >
              <span className="truncate" style={value ? { fontFamily: `'${value}', sans-serif` } : undefined}>
                {displayValue}
              </span>
              <CaretUpDown size={14} className="ms-2 shrink-0 text-neutral-400" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-72 p-0" align="start">
            <div className="border-b p-2">
              <input
                placeholder={t('dashboard.organization.branding.theme.search_fonts')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className={`${INPUT} !h-8`}
                autoFocus
              />
            </div>
            {showingFullCatalog && filteredFonts.length > 0 && (
              <div className="bg-neutral-50/50 px-3 py-1.5 text-[11px] text-neutral-400">
                {t('dashboard.organization.branding.theme.all_fonts')}
              </div>
            )}
            <div ref={listRef} id={listId} className="max-h-60 overflow-y-auto p-1">
              {filteredFonts.length === 0 ? (
                <div className="py-6 text-center text-sm text-neutral-500">
                  {t('dashboard.organization.branding.theme.no_fonts')}
                </div>
              ) : (
                filteredFonts.map((font) => (
                  <button
                    key={font}
                    type="button"
                    onClick={() => handleSelect(font)}
                    className={cn(
                      'flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-start text-sm hover:bg-neutral-100',
                      value === font && 'bg-neutral-100'
                    )}
                  >
                    <Check size={14} className={cn('shrink-0', value === font ? 'opacity-100' : 'opacity-0')} />
                    <span style={{ fontFamily: `'${font}', sans-serif` }}>{font}</span>
                    {font === DEFAULT_FONT && (
                      <span className="ms-auto text-[10px] text-neutral-400">
                        {t('dashboard.organization.branding.theme.default')}
                      </span>
                    )}
                  </button>
                ))
              )}
            </div>
          </PopoverContent>
        </Popover>

        {value && (
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('dashboard.organization.branding.theme.clear')}
            title={t('dashboard.organization.branding.theme.clear')}
            onClick={() => {
              onChange('')
              setSearch('')
            }}
            icon={<X size={14} />}
          />
        )}
      </div>

      {!hideSample && (
        <div className="rounded-xl ring-1 ring-inset ring-neutral-200 bg-white p-4" style={{ fontFamily: `'${value || DEFAULT_FONT}', sans-serif` }}>
          <p className="mb-1 text-2xl font-bold text-neutral-900">{t('dashboard.organization.branding.font_sample')}</p>
          <p className="text-sm text-neutral-600">ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz 0123456789</p>
        </div>
      )}
    </div>
  )
}
