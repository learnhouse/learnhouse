'use client'
/**
 * A searchable font menu where every name is drawn in its own face. Previews
 * download only the letters of the names (Google Fonts `text=`), once.
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { CaretDown, Check, MagnifyingGlass } from '@phosphor-icons/react'
import { ALL_FONTS, FONT_GROUPS, fontStack, googleFontsUrl } from '../model/fonts'
import { FIELD } from './controls'

const PREVIEW_ID = 'lhp-font-previews'

function loadPreviews() {
  if (typeof document === 'undefined' || document.getElementById(PREVIEW_ID)) return
  const letters = Array.from(new Set(ALL_FONTS.join('').replace(/\s/g, '') + 'Aa')).join('')
  const url = googleFontsUrl(ALL_FONTS, { text: letters })
  if (!url) return
  const link = document.createElement('link')
  link.id = PREVIEW_ID
  link.rel = 'stylesheet'
  link.href = url
  document.head.appendChild(link)
}

export interface FontChoice {
  value: string
  label: string
  /** CSS font-family used to draw the label. */
  family?: string
}

export default function FontPicker({ value, onChange, extra = [], ariaLabel, testid }: {
  value: string
  onChange: (v: string) => void
  /** Choices listed before the fonts (brand font, theme heading/body, default). */
  extra?: FontChoice[]
  ariaLabel: string
  testid?: string
}) {
  const { t } = useTranslation()
  const [open, setOpen] = React.useState(false)
  const [q, setQ] = React.useState('')
  const ref = React.useRef<HTMLDivElement>(null)
  const search = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    if (!open) return
    loadPreviews()
    search.current?.focus()
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) } }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc, true)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc, true) }
  }, [open])

  // The selected font is drawn in its face too, so load it in full.
  React.useEffect(() => {
    const url = googleFontsUrl([value], { weights: '400;600' })
    if (!url || typeof document === 'undefined') return
    const id = `lhp-font-pick-${value.replace(/\s/g, '-')}`
    if (document.getElementById(id)) return
    const link = document.createElement('link')
    link.id = id
    link.rel = 'stylesheet'
    link.href = url
    document.head.appendChild(link)
  }, [value])

  const pick = (v: string) => { onChange(v); setOpen(false); setQ('') }
  const current = extra.find((c) => c.value === value)
  const needle = q.trim().toLowerCase()
  const groups = FONT_GROUPS.map((g) => ({ ...g, fonts: g.fonts.filter((f) => !needle || f.toLowerCase().includes(needle)) })).filter((g) => g.fonts.length)
  const extras = extra.filter((c) => !needle || c.label.toLowerCase().includes(needle))

  const option = (v: string, label: string, family: string) => (
    <button
      key={v || 'default'}
      type="button"
      role="option"
      aria-selected={value === v}
      onClick={() => pick(v)}
      className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-start text-[14px] text-neutral-800 ${value === v ? 'bg-neutral-100' : 'hover:bg-neutral-50'}`}
      data-font={v}
    >
      <span className="min-w-0 flex-1 truncate" style={{ fontFamily: family }}>{label}</span>
      {value === v && <Check size={13} weight="bold" className="flex-none text-neutral-500" />}
    </button>
  )

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        className={`${FIELD} flex items-center justify-between gap-2 text-start`}
        data-testid={testid}
      >
        <span className="min-w-0 truncate" style={{ fontFamily: current?.family ?? fontStack(value, '--lh-font-body') }}>{current?.label ?? value}</span>
        <CaretDown size={12} className="flex-none text-neutral-400" />
      </button>
      {open && (
        <div className="absolute end-0 start-0 top-full z-50 mt-1 flex max-h-80 flex-col overflow-hidden rounded-xl bg-white nice-shadow ring-1 ring-black/5">
          <div className="relative flex-none border-b border-neutral-100 p-1.5">
            <MagnifyingGlass size={13} className="pointer-events-none absolute start-4 top-1/2 -translate-y-1/2 text-neutral-400" />
            <input ref={search} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('landingBuilder.fonts.search')} aria-label={t('landingBuilder.fonts.search')} className={`${FIELD} ps-7`} />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-1" role="listbox" aria-label={ariaLabel}>
            {extras.map((c) => option(c.value, c.label, c.family ?? 'inherit'))}
            {groups.map((g) => (
              <div key={g.group}>
                <div className="px-2.5 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-neutral-400">{t(`landingBuilder.fonts.group_${g.group}`)}</div>
                {g.fonts.map((f) => option(f, f, fontStack(f, '--lh-font-body')))}
              </div>
            ))}
            {!extras.length && !groups.length && <p className="px-2.5 py-3 text-[12px] text-neutral-500">{t('landingBuilder.fonts.none')}</p>}
          </div>
        </div>
      )}
    </div>
  )
}
