'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { CaretDown, Check, Star, Translate } from '@phosphor-icons/react'
import { localeName, localeNativeName } from '@services/courses/translations'
import { buttonClass } from '@components/Dashboard/Shared/DashKit/DashKit'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@components/ui/dropdown-menu'
import { useCourseLanguages, useEditingLocale } from './useCourseLanguages'

/**
 * Language switcher in the course editor header. Picking a language puts the
 * editor in translation mode (`?lang=fr`); the source language leaves it.
 * Hidden while the course has no other language.
 */
export function CourseLanguageSwitcher({ courseUuid }: { courseUuid: string }) {
  const { t, i18n } = useTranslation()
  const { data } = useCourseLanguages(courseUuid)
  const { locale, setLocale } = useEditingLocale(courseUuid)
  if (!data || data.languages.length === 0) return null
  const display = i18n.language || 'en'
  const current = locale || data.default_locale || 'en'
  const translating = !!locale

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={`${buttonClass(translating ? 'primary' : 'secondary', 'md')} ${translating ? '!bg-sky-600 hover:!bg-sky-700 !shadow-[inset_0_1px_0_rgba(255,255,255,0.1),0_1px_1px_rgba(3,105,161,0.12),0_0_0_1px_rgba(3,105,161,0.6)]' : ''}`}
          aria-label={t('dashboard.courses.languages.switcher.label', 'Editing language')}
          data-testid="course-language-switcher"
        >
          <Translate size={15} />
          <span className="max-w-32 truncate">{localeNativeName(current)}</span>
          <CaretDown size={12} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64 rounded-xl">
        <DropdownMenuLabel className="text-xs font-medium text-neutral-500">
          {t('dashboard.courses.languages.switcher.label', 'Editing language')}
        </DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => setLocale(null)} data-testid="course-language-option-source">
          <span className="flex items-center gap-2 grow min-w-0">
            <Star size={13} className="text-neutral-400 shrink-0" />
            <span className="truncate">{localeNativeName(data.default_locale || 'en')}</span>
            <span className="text-xs text-neutral-400 truncate">{t('dashboard.courses.languages.switcher.source', 'Source')}</span>
          </span>
          {!translating && <Check size={14} />}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {data.languages.map((l) => (
          <DropdownMenuItem key={l.locale} onSelect={() => setLocale(l.locale)} data-testid={`course-language-option-${l.locale}`}>
            <span className="flex items-center gap-2 grow min-w-0">
              <span className="w-6 text-[10px] font-semibold uppercase text-neutral-500 shrink-0">{l.locale.split('-')[0]}</span>
              <span className="truncate">{localeNativeName(l.locale)}</span>
              <span className="text-xs text-neutral-400 truncate">{localeName(l.locale, display)}</span>
            </span>
            {l.status === 'draft' && (
              <span className="text-[10px] font-semibold uppercase text-neutral-400">{t('dashboard.courses.languages.status.draft', 'Draft')}</span>
            )}
            {locale === l.locale && <Check size={14} className="ms-1" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
