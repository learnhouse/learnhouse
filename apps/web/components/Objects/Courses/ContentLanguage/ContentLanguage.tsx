'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { CaretDown, Check, Info, Translate } from '@phosphor-icons/react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@components/ui/dropdown-menu'
import { isRtlLocale, localeNativeName } from '@services/courses/translations'
import { courseDefaultLocale, courseLocales, servedLocale } from '@/lib/contentLanguage'

/*
 Learner-facing pieces of multilingual courses: the language switcher, the
 "not translated yet" notice and the content wrapper that carries `lang` and
 `dir` for the language the content is in (not the UI language).
*/

/**
 * `lang` / `dir` attributes for content in `locale`. Left-to-right content says
 * so too: a no-op in a left-to-right interface, but in an Arabic or Persian one
 * English content would otherwise inherit `rtl` and render flipped (trailing
 * punctuation jumping to the front, text hugging the wrong edge).
 */
export function contentLangProps(locale?: string | null): { lang?: string; dir?: 'rtl' | 'ltr' } {
  if (!locale) return {}
  return { lang: locale, dir: isRtlLocale(locale) ? 'rtl' : 'ltr' }
}

/**
 * Compact language picker. Renders nothing when the course has no published
 * translation, so single-language courses look exactly as before.
 */
export function ContentLanguageSwitcher({
  course,
  onChange,
  size = 'md',
  tone = 'light',
  align = 'end',
  className = '',
}: {
  course: any
  onChange: (_locale: string) => void
  size?: 'sm' | 'md'
  tone?: 'light' | 'dark'
  align?: 'start' | 'end'
  className?: string
}) {
  const { t } = useTranslation()
  const locales = courseLocales(course)
  if (locales.length < 2) return null
  const current = servedLocale(course)
  const defaultLocale = courseDefaultLocale(course)
  const triggerTone =
    tone === 'dark'
      ? 'text-white/80 hover:text-white hover:bg-white/10'
      : 'text-neutral-600 hover:text-neutral-900 bg-white nice-shadow hover:bg-neutral-50'
  const triggerSize = size === 'sm' ? 'h-7 px-2 text-xs gap-1' : 'h-8 px-2.5 text-[13px] gap-1.5'
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-testid="content-language-switcher"
          aria-label={t('courses.i18n.switcher_label', 'Course language')}
          title={t('courses.i18n.switcher_label', 'Course language')}
          className={`inline-flex items-center rounded-lg font-semibold transition-colors ${triggerSize} ${triggerTone} ${className}`}
        >
          <Translate size={size === 'sm' ? 13 : 15} aria-hidden="true" />
          <span lang={current} className={size === 'sm' ? 'uppercase tracking-wide' : ''}>
            {size === 'sm' ? current.split('-')[0] : localeNativeName(current)}
          </span>
          <CaretDown size={11} aria-hidden="true" className="opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="min-w-[11rem]">
        {locales.map((locale) => (
          <DropdownMenuItem
            key={locale}
            data-testid={`content-language-${locale}`}
            onSelect={() => {
              if (locale !== current) onChange(locale)
            }}
            className="flex items-center gap-2 cursor-pointer"
          >
            <span className="w-4 flex justify-center shrink-0">{locale === current ? <Check size={13} weight="bold" /> : null}</span>
            <span lang={locale} dir="auto" className="grow">
              {localeNativeName(locale)}
            </span>
            {locale === defaultLocale && (
              <span className="text-[11px] text-neutral-400">{t('courses.i18n.original', 'Original')}</span>
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Shown above an activity whose translation isn't published yet in the language being read. */
export function TranslationFallbackNotice({ locale, className = '' }: { locale: string; className?: string }) {
  const { t } = useTranslation()
  return (
    <div
      role="note"
      data-testid="translation-fallback-notice"
      className={`flex items-center gap-2 rounded-xl bg-neutral-50 ring-1 ring-inset ring-neutral-200/70 px-3 py-2 text-[13px] text-neutral-600 ${className}`}
    >
      <Info size={15} className="shrink-0 text-neutral-400" aria-hidden="true" />
      <span>
        {t('courses.i18n.fallback_notice', {
          defaultValue: "This page isn't available in {{language}} yet. Showing the original.",
          language: localeNativeName(locale),
        })}
      </span>
    </div>
  )
}

/** Subtle "EN · FR" chip on course cards; nothing for single-language courses. */
export function CourseLanguageBadges({ course, max = 4 }: { course: any; max?: number }) {
  const { t } = useTranslation()
  const locales = courseLocales(course)
  if (locales.length < 2) return null
  const shown = locales.slice(0, max)
  const rest = locales.length - shown.length
  const names = locales.map((l) => localeNativeName(l)).join(', ')
  return (
    <span
      data-testid="course-language-badges"
      title={t('courses.i18n.available_in', { defaultValue: 'Available in {{languages}}', languages: names })}
      className="inline-flex items-center gap-1 rounded-md bg-white/90 backdrop-blur-sm px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-neutral-600 shadow-sm"
    >
      <Translate size={10} aria-hidden="true" />
      <span className="uppercase" aria-hidden="true">{shown.map((l) => l.split('-')[0]).join(' · ')}</span>
      {rest > 0 && <span className="text-neutral-400" aria-hidden="true">+{rest}</span>}
      <span className="sr-only">{names}</span>
    </span>
  )
}
