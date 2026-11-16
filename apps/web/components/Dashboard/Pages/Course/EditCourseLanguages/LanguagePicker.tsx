'use client'
import React, { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MagnifyingGlass, Translate } from '@phosphor-icons/react'
import { Popover, PopoverContent, PopoverTrigger } from '@components/ui/popover'
import { localeName, normalizeLocale } from '@services/courses/translations'
import { languageOptions } from './courseLanguagesModel'

function capitalize(name: string, locale: string): string {
  try {
    return name.charAt(0).toLocaleUpperCase(locale) + name.slice(1)
  } catch {
    return name
  }
}

/**
 * Searchable language list in a popover: the 22 UI languages first, then any
 * other code (names from Intl.DisplayNames). `trigger` is the button.
 */
export function LanguagePicker({
  trigger,
  exclude,
  onPick,
  align = 'end',
}: {
  trigger: React.ReactNode
  exclude: string[]
  onPick: (_code: string) => void | Promise<void>
  align?: 'start' | 'end'
}) {
  const { t, i18n } = useTranslation()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const display = i18n.language || 'en'
  const options = useMemo(
    () =>
      languageOptions({
        query,
        exclude,
        displayLocale: display,
        nameOf: (code, d) => localeName(code, d),
        normalize: (v) => normalizeLocale(v),
      }),
    [query, exclude, display],
  )

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) setQuery('')
      }}
    >
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align={align} className="w-80 p-0 rounded-xl bg-white border-0 nice-shadow overflow-hidden">
        <div className="p-2 border-b border-neutral-100">
          <div className="relative">
            <MagnifyingGlass size={14} className="absolute start-3 top-1/2 -translate-y-1/2 text-neutral-400" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('dashboard.courses.languages.picker.search', 'Search a language or code (e.g. pt-BR)')}
              aria-label={t('dashboard.courses.languages.picker.search', 'Search a language or code (e.g. pt-BR)')}
              className="w-full h-9 ps-8 pe-3 text-sm rounded-lg bg-neutral-50 ring-1 ring-inset ring-neutral-200 focus:outline-none focus:ring-2 focus:ring-neutral-900/15"
              data-testid="language-picker-search"
            />
          </div>
        </div>
        <ul className="max-h-72 overflow-y-auto py-1" role="listbox">
          {options.length === 0 && (
            <li className="px-4 py-6 text-center text-sm text-neutral-400">
              {t('dashboard.courses.languages.picker.empty', 'No language matches')}
            </li>
          )}
          {options.map((o, i) => (
            <li key={o.code}>
              {i > 0 && o.ui !== options[i - 1].ui && <div className="mx-3 my-1 border-t border-neutral-100" />}
              <button
                type="button"
                role="option"
                aria-selected={false}
                onClick={async () => {
                  setOpen(false)
                  setQuery('')
                  await onPick(o.code)
                }}
                className="w-full flex items-center gap-3 px-3 py-2 text-start hover:bg-neutral-50 focus:bg-neutral-50 focus:outline-none"
                data-testid={`language-option-${o.code}`}
              >
                <span className="w-8 h-6 shrink-0 rounded-md bg-neutral-100 text-[11px] font-semibold uppercase text-neutral-600 flex items-center justify-center">
                  {o.code.split('-')[0]}
                </span>
                <span className="min-w-0 grow">
                  <span className="block text-sm font-medium text-neutral-900 truncate">{capitalize(o.native, o.code)}</span>
                  {o.name !== o.native && <span className="block text-xs text-neutral-500 truncate">{o.name}</span>}
                </span>
                <span className="text-[11px] font-mono text-neutral-400">{o.code}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="px-3 py-2 border-t border-neutral-100 flex items-center gap-1.5 text-[11px] text-neutral-400">
          <Translate size={12} />
          {t('dashboard.courses.languages.picker.hint', 'Type any language code to add a language not listed')}
        </div>
      </PopoverContent>
    </Popover>
  )
}
