'use client'
import React, { useState, useMemo, useRef, useEffect } from 'react'
import { Check, CaretUpDown, X } from '@phosphor-icons/react'
import { Input } from '@components/ui/input'
import { Button } from '@components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@components/ui/popover'
import { CURATED_FONTS, DEFAULT_FONT, getGoogleFontPreviewUrl } from '@/lib/fonts'
import allGoogleFonts from '@/lib/google-fonts-catalog.json'
import { cn } from '@/lib/utils'
import { useTranslation } from 'react-i18next'

interface FontSelectorProps {
  value: string
  onChange: (_font: string) => void
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

export default function FontSelector({ value, onChange }: FontSelectorProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const listRef = useRef<HTMLDivElement>(null)

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

  const displayValue = value || `${DEFAULT_FONT} (${t('dashboard.organization.branding.theme.default')})`

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={open}
              className="h-10 w-72 justify-between bg-white font-normal"
            >
              <span className="truncate" style={value ? { fontFamily: `'${value}', sans-serif` } : undefined}>
                {displayValue}
              </span>
              <CaretUpDown size={14} className="ms-2 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-72 p-0" align="start">
            <div className="border-b p-2">
              <Input
                placeholder={t('dashboard.organization.branding.theme.search_fonts')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8 text-sm"
                autoFocus
              />
            </div>
            {showingFullCatalog && filteredFonts.length > 0 && (
              <div className="bg-gray-50/50 px-3 py-1.5 text-[11px] text-gray-400">
                {t('dashboard.organization.branding.theme.all_fonts')}
              </div>
            )}
            <div ref={listRef} className="max-h-60 overflow-y-auto p-1">
              {filteredFonts.length === 0 ? (
                <div className="py-6 text-center text-sm text-gray-500">
                  {t('dashboard.organization.branding.theme.no_fonts')}
                </div>
              ) : (
                filteredFonts.map((font) => (
                  <button
                    key={font}
                    type="button"
                    onClick={() => handleSelect(font)}
                    className={cn(
                      'flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-start text-sm hover:bg-gray-100',
                      value === font && 'bg-gray-100'
                    )}
                  >
                    <Check size={14} weight="bold" className={cn('shrink-0', value === font ? 'opacity-100' : 'opacity-0')} />
                    <span style={{ fontFamily: `'${font}', sans-serif` }}>{font}</span>
                    {font === DEFAULT_FONT && (
                      <span className="ms-auto text-[10px] text-gray-400">
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
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              onChange('')
              setSearch('')
            }}
            className="h-10 px-2 text-gray-400 hover:text-gray-700"
          >
            <X size={14} weight="bold" />
          </Button>
        )}
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-4" style={{ fontFamily: `'${value || DEFAULT_FONT}', sans-serif` }}>
        <p className="mb-1 text-2xl font-bold text-gray-900">The quick brown fox jumps over the lazy dog</p>
        <p className="text-sm text-gray-600">ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz 0123456789</p>
      </div>
    </div>
  )
}
