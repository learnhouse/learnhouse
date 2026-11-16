'use client'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Warning, X } from '@phosphor-icons/react'
import { Button, INPUT } from '@components/Dashboard/Shared/DashKit/DashKit'
import { cn } from '@/lib/utils'
import { PALETTE, contrastLevel, contrastRatio, deriveAccentTokens, sanitizeHex } from '@/lib/theme/orgTheme'

/**
 * Hex color input: native picker, a text field that only commits valid hex,
 * and the curated palette. `allowEmpty` adds a Clear button ('' = no color).
 */
export function ColorField({
  value,
  onChange,
  label,
  allowEmpty = false,
  disabled,
  placeholder,
}: {
  value: string
  onChange: (_hex: string) => void
  label: string
  allowEmpty?: boolean
  disabled?: boolean
  placeholder?: string
}) {
  const { t } = useTranslation()
  // Local text so a half-typed hex isn't committed; follows outside changes.
  const [text, setText] = useState(value)
  const [seen, setSeen] = useState(value)
  if (seen !== value) {
    setSeen(value)
    setText(value)
  }
  const invalid = text.trim() !== '' && !sanitizeHex(text)

  const commit = (raw: string) => {
    setText(raw)
    if (!raw.trim()) {
      if (allowEmpty) onChange('')
      return
    }
    const hex = sanitizeHex(raw)
    if (hex) onChange(hex)
  }

  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative h-9 w-9 shrink-0 cursor-pointer overflow-hidden rounded-lg ring-1 ring-inset ring-black/10">
          <input
            type="color"
            aria-label={t('dashboard.organization.branding.theming.color_field.picker', { label, defaultValue: '{{label}}: color picker' })}
            value={value || '#ffffff'}
            onChange={(e) => commit(e.target.value)}
            disabled={disabled}
            className="absolute -inset-2 h-[calc(100%+16px)] w-[calc(100%+16px)] cursor-pointer border-0 p-0"
          />
        </label>
        <input
          type="text"
          aria-label={t('dashboard.organization.branding.theming.color_field.hex', { label, defaultValue: '{{label}}: hex code' })}
          aria-invalid={invalid || undefined}
          value={text}
          onChange={(e) => commit(e.target.value)}
          onBlur={() => setText(value)}
          placeholder={placeholder}
          disabled={disabled}
          data-ltr-content
          className={cn(INPUT, '!w-32 font-mono uppercase', invalid && '!ring-rose-300')}
          maxLength={7}
        />
        {allowEmpty && value && (
          <Button variant="ghost" size="sm" onClick={() => commit('')} disabled={disabled} icon={<X size={12} />}>
            {t('dashboard.organization.branding.theme.clear')}
          </Button>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {PALETTE.map((hex) => (
          <button
            key={hex}
            type="button"
            aria-label={hex}
            title={hex}
            onClick={() => commit(hex)}
            disabled={disabled}
            className={cn(
              'h-6 w-6 rounded-full ring-1 ring-inset ring-black/10 transition-transform hover:scale-110',
              value === hex && 'ring-2 ring-neutral-900 ring-offset-2'
            )}
            style={{ backgroundColor: hex }}
          />
        ))}
      </div>
    </div>
  )
}

/** WCAG check for an accent: text on the button, and the button on the page. */
export function ContrastNote({ accent }: { accent: string }) {
  const { t } = useTranslation()
  const tokens = deriveAccentTokens(accent)
  const onButton = contrastLevel(tokens.contrast, tokens.accent)
  const onPage = contrastRatio(tokens.accent, '#ffffff')
  const weak = onButton.level === 'fail' || onButton.level === 'AA-large' || onPage < 1.6
  return (
    <div
      className={cn(
        'mt-3 flex items-start gap-2 rounded-lg px-3 py-2 text-xs leading-relaxed',
        weak ? 'bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200' : 'bg-neutral-50 text-neutral-600 ring-1 ring-inset ring-neutral-200'
      )}
    >
      {weak ? <Warning size={14} weight="fill" className="mt-0.5 shrink-0" /> : <Check size={14} weight="bold" className="mt-0.5 shrink-0 text-emerald-600" />}
      <span>
        {weak
          ? onPage < 1.6
            ? t('dashboard.organization.branding.theming.contrast.too_light', 'This color is very light: buttons will barely stand out on white pages.')
            : t('dashboard.organization.branding.theming.contrast.low', 'Low contrast: button text may be hard to read.')
          : t('dashboard.organization.branding.theming.contrast.ok', 'Readable: button text is checked against this color automatically.')}{' '}
        <span className="font-mono tabular-nums">
          {onButton.ratio}:1 · {onButton.level === 'fail' ? '✕' : onButton.level}
        </span>
      </span>
    </div>
  )
}

export interface ChoiceTileOption<T extends string> {
  key: T
  label: string
  description?: string
  art?: React.ReactNode
}

/** A radio group of small illustrated tiles (header style, corners, cards…). */
export function ChoiceTiles<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  columns = 3,
  disabled,
}: {
  value: T
  options: ChoiceTileOption<T>[]
  onChange: (_key: T) => void
  ariaLabel: string
  columns?: 2 | 3 | 4
  disabled?: boolean
}) {
  const cols = columns === 4 ? 'grid-cols-2 sm:grid-cols-4' : columns === 2 ? 'grid-cols-2' : 'grid-cols-3'
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={cn('grid gap-2.5', cols)}>
      {options.map((opt) => {
        const selected = opt.key === value
        return (
          <button
            key={opt.key}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(opt.key)}
            className={cn(
              'group flex min-w-0 flex-col gap-2 rounded-xl p-2 text-start transition-all',
              selected ? 'bg-white ring-2 ring-neutral-900 shadow-sm' : 'bg-white ring-1 ring-inset ring-neutral-200 hover:ring-neutral-300'
            )}
          >
            {opt.art && (
              <span className="block overflow-hidden rounded-lg bg-neutral-50 ring-1 ring-inset ring-black/5">{opt.art}</span>
            )}
            <span className="px-0.5">
              <span className="block truncate text-xs font-semibold text-neutral-900">{opt.label}</span>
              {opt.description && <span className="mt-0.5 block text-[11px] leading-snug text-neutral-500">{opt.description}</span>}
            </span>
          </button>
        )
      })}
    </div>
  )
}

/** Field heading + one-line help, the rhythm every theme section uses. */
export function ThemeField({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-sm font-semibold text-neutral-800">{title}</p>
      {description && <p className="mt-0.5 mb-3 text-xs leading-relaxed text-neutral-500">{description}</p>}
      {!description && <div className="mb-3" />}
      {children}
    </div>
  )
}
