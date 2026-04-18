'use client'
import React, { useState, useMemo, useRef, useEffect } from 'react'
import { Check, ChevronsUpDown, X, Type } from 'lucide-react'
import { Input } from '@components/ui/input'
import { Button } from '@components/ui/button'
import { Label } from '@components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@components/ui/popover'
import { CURATED_FONTS, DEFAULT_FONT, getGoogleFontPreviewUrl } from '@/lib/fonts'
import allGoogleFonts from '@/lib/google-fonts-catalog.json'
import { cn } from '@/lib/utils'
import { useTranslation } from 'react-i18next'

interface FontSelectorProps {
  value: string
  onChange: (font: string) => void
}

export default function FontSelector({ value, onChange }: FontSelectorProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [previewFont, setPreviewFont] = useState(value)
  const listRef = useRef<HTMLDivElement>(null)

  const filteredFonts = useMemo(() => {
    if (!search.trim()) return CURATED_FONTS

    const query = search.toLowerCase()
    const results = (allGoogleFonts as string[]).filter((f) =>
      f.toLowerCase().includes(query)
    )
    return results.slice(0, 50)
  }, [search])

  const showingFullCatalog = search.trim().length > 0

  // Load preview font stylesheet
  useEffect(() => {
    if (!previewFont || previewFont === DEFAULT_FONT) return

    const id = `font-preview-${previewFont.replace(/\s/g, '-')}`
    if (document.getElementById(id)) return

    const link = document.createElement('link')
    link.id = id
    link.rel = 'stylesheet'
    link.href = getGoogleFontPreviewUrl(previewFont)
    document.head.appendChild(link)
  }, [previewFont])

  // Load fonts in the dropdown for inline previews
  const loadedFontsRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (!open) return

    const fontsToLoad = filteredFonts.filter(
      (f) => f !== DEFAULT_FONT && !loadedFontsRef.current.has(f)
    )
    if (fontsToLoad.length === 0) return

    fontsToLoad.forEach((f) => {
      const id = `font-preview-${f.replace(/\s/g, '-')}`
      if (document.getElementById(id)) {
        loadedFontsRef.current.add(f)
        return
      }

      const link = document.createElement('link')
      link.id = id
      link.rel = 'stylesheet'
      link.href = getGoogleFontPreviewUrl(f)
      document.head.appendChild(link)
      loadedFontsRef.current.add(f)
    })
  }, [open, filteredFonts])

  const handleSelect = (font: string) => {
    onChange(font)
    setPreviewFont(font)
    setOpen(false)
    setSearch('')
  }

  const handleClear = () => {
    onChange('')
    setPreviewFont('')
    setSearch('')
  }

  const displayValue = value || `${DEFAULT_FONT} (default)`

  return (
    <div className="space-y-4">
      <div>
        <Label className="text-sm font-medium text-gray-700 mb-3 block">
          <Type className="inline h-4 w-4 me-1.5 -mt-0.5" />
          Typography
        </Label>

        <div className="flex items-center gap-2">
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                aria-expanded={open}
                className="w-72 justify-between h-10 bg-white font-normal"
              >
                <span
                  className="truncate"
                  style={value ? { fontFamily: `'${value}', sans-serif` } : undefined}
                >
                  {displayValue}
                </span>
                <ChevronsUpDown className="ms-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-72 p-0" align="start">
              <div className="p-2 border-b">
                <Input
                  placeholder="Search fonts..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-8 text-sm"
                  autoFocus
                />
              </div>
              {showingFullCatalog && filteredFonts.length > 0 && (
                <div className="px-3 py-1.5 text-[11px] text-gray-400 bg-gray-50/50">
                  Showing results from all Google Fonts
                </div>
              )}
              <div ref={listRef} className="max-h-60 overflow-y-auto p-1">
                {filteredFonts.length === 0 ? (
                  <div className="py-6 text-center text-sm text-gray-500">
                    No fonts found
                  </div>
                ) : (
                  filteredFonts.map((font) => (
                    <button
                      key={font}
                      onClick={() => handleSelect(font)}
                      className={cn(
                        'w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded-md hover:bg-gray-100 text-start cursor-pointer',
                        value === font && 'bg-gray-100'
                      )}
                    >
                      <Check
                        className={cn(
                          'h-4 w-4 shrink-0',
                          value === font ? 'opacity-100' : 'opacity-0'
                        )}
                      />
                      <span style={{ fontFamily: `'${font}', sans-serif` }}>
                        {font}
                      </span>
                      {font === DEFAULT_FONT && (
                        <span className="ms-auto text-[10px] text-gray-400">default</span>
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
              onClick={handleClear}
              className="text-gray-400 hover:text-gray-600 h-10 px-2"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>

        <p className="text-xs text-gray-400 mt-2">
          Choose a font for your public pages. Search to browse all Google Fonts.
        </p>
      </div>

      {/* Preview */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <p className="text-xs text-gray-400 mb-2">Preview</p>
        <div
          style={{ fontFamily: `'${previewFont || DEFAULT_FONT}', sans-serif` }}
        >
          <p className="text-2xl font-bold text-gray-900 mb-1">
            The quick brown fox jumps over the lazy dog
          </p>
          <p className="text-sm text-gray-600">
            ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz 0123456789
          </p>
        </div>
      </div>
    </div>
  )
}
