'use client'
import React from 'react'
import * as PopoverPrimitive from '@radix-ui/react-popover'
import { CaretDown, Check, MagnifyingGlass } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { PLAYGROUND_LANGUAGES } from '../languages'
import { FIELD_CLASS } from '../../../Blocks/ui/BlockChrome'

/** Searchable language picker (30 languages don't fit a plain menu). */
export default function LanguagePicker({ languageId, languageName, onChange }: { languageId: number; languageName: string; onChange: (_id: number) => void }) {
  const { t } = useTranslation()
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const [active, setActive] = React.useState(0)
  const list = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? PLAYGROUND_LANGUAGES.filter((l) => l.name.toLowerCase().includes(q)) : PLAYGROUND_LANGUAGES
  }, [query])

  const pick = (id: number) => {
    setOpen(false)
    setQuery('')
    if (id !== languageId) onChange(id)
  }

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={(o) => { setOpen(o); if (o) setActive(Math.max(0, PLAYGROUND_LANGUAGES.findIndex((l) => l.id === languageId))) }}>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          aria-label={t('editor.blocks_v2.language', 'Language')}
          className="flex items-center gap-1.5 px-1 py-1.5 text-[12px] font-medium text-neutral-500 outline-none transition-colors hover:text-neutral-300 focus-visible:text-neutral-300"
        >
          {languageName}
          <CaretDown weight="duotone" size={11} className="text-neutral-500" />
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="end"
          sideOffset={6}
          collisionPadding={12}
          style={{ zIndex: 'var(--z-popover)' }}
          className="w-60 max-w-[calc(100vw-24px)] rounded-xl bg-white p-2 shadow-[0_8px_24px_rgba(0,0,0,0.08),0_0_0_1px_rgba(0,0,0,0.08)] outline-none"
        >
          <div className="relative mb-1.5">
            <MagnifyingGlass size={13} className="pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2 text-neutral-400" />
            <input
              autoFocus
              value={query}
              onChange={(e) => { setQuery(e.target.value); setActive(0) }}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(list.length - 1, i + 1)) }
                if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)) }
                if (e.key === 'Enter' && list[active]) { e.preventDefault(); pick(list[active].id) }
              }}
              placeholder={t('editor.blocks_v2.code.search_language', 'Search languages…')}
              aria-label={t('editor.blocks_v2.code.search_language', 'Search languages…')}
              className={cn(FIELD_CLASS, 'h-7 ps-7 text-xs')}
            />
          </div>
          <div role="listbox" className="max-h-64 overflow-y-auto">
            {list.map((lang, i) => (
              <button
                key={lang.id}
                type="button"
                role="option"
                aria-selected={lang.id === languageId}
                ref={(el) => { if (el && i === active) el.scrollIntoView({ block: 'nearest' }) }}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(lang.id)}
                className={cn(
                  'flex w-full items-center justify-between rounded-md px-2 py-1.5 text-start text-xs transition-colors',
                  i === active ? 'bg-neutral-100 text-neutral-900' : 'text-neutral-600',
                )}
              >
                {lang.name}
                {lang.id === languageId && <Check size={12} weight="bold" className="text-neutral-900" />}
              </button>
            ))}
            {list.length === 0 && <p className="px-2 py-3 text-xs text-neutral-400">{t('editor.blocks_v2.code.no_language', 'No language matches.')}</p>}
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}
