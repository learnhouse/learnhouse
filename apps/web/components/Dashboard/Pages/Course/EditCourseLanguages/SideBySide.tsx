'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { INPUT, TEXTAREA } from '@components/Dashboard/Shared/DashKit/DashKit'
import { isRtlLocale, localeNativeName } from '@services/courses/translations'

/** Column headers over a side-by-side form: source on the start side, translation on the end side. */
export function SideBySideHeader({ source, locale }: { source: string; locale: string }) {
  const { t } = useTranslation()
  return (
    <div className="hidden md:grid grid-cols-2 gap-4 px-0.5 pb-1 text-xs font-medium text-neutral-500">
      <span>
        {t('dashboard.courses.languages.side.source', { language: localeNativeName(source), defaultValue: 'Source · {{language}}' })}
      </span>
      <span>
        {t('dashboard.courses.languages.side.translation', {
          language: localeNativeName(locale),
          defaultValue: 'Translation · {{language}}',
        })}
      </span>
    </div>
  )
}

/**
 * One translatable field: the source text read-only, the translation
 * editable next to it (stacked on narrow screens). RTL languages get dir=rtl.
 */
export function SideBySideField({
  label,
  source,
  value,
  onChange,
  locale,
  multiline = false,
  rows = 3,
  testId,
  placeholder,
  optional = false,
}: {
  label: React.ReactNode
  source: string | null | undefined
  value: string
  onChange: (_v: string) => void
  locale: string
  multiline?: boolean
  rows?: number
  testId?: string
  placeholder?: string
  /** No "Not translated" hint when left empty. */
  optional?: boolean
}) {
  const { t } = useTranslation()
  const dir = isRtlLocale(locale) ? 'rtl' : undefined
  const empty = !optional && !value.trim() && !!source?.trim()
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center gap-2 text-sm font-semibold text-neutral-800">
        {label}
        {empty && (
          <span className="text-[11px] font-medium text-amber-700">{t('dashboard.courses.languages.side.missing', 'Not translated')}</span>
        )}
      </div>
      <div className="grid md:grid-cols-2 gap-2 md:gap-4">
        <div
          className={`rounded-xl bg-neutral-50 ring-1 ring-inset ring-neutral-100 px-3 py-2 text-sm text-neutral-600 whitespace-pre-wrap break-words ${
            multiline ? 'min-h-[4.5rem] max-h-64 overflow-y-auto' : 'min-h-9'
          }`}
          aria-label={t('dashboard.courses.languages.side.source_aria', 'Source text')}
        >
          {source?.trim() ? source : <span className="text-neutral-300">—</span>}
        </div>
        {multiline ? (
          <textarea
            className={TEXTAREA}
            rows={rows}
            value={value}
            dir={dir}
            lang={locale}
            placeholder={placeholder}
            onChange={(e) => onChange(e.target.value)}
            data-testid={testId}
          />
        ) : (
          <input
            className={INPUT}
            value={value}
            dir={dir}
            lang={locale}
            placeholder={placeholder}
            onChange={(e) => onChange(e.target.value)}
            data-testid={testId}
          />
        )}
      </div>
    </div>
  )
}
