'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { Translate, X } from '@phosphor-icons/react'
import { localeName, localeNativeName } from '@services/courses/translations'
import { Button } from '@components/Dashboard/Shared/DashKit/DashKit'
import { useEditingLocale } from './useCourseLanguages'

/** Tabs that have a translation view; the others show the shared settings. */
export const TRANSLATED_TABS = ['general', 'content', 'seo'] as const

/**
 * Strip under the course editor header while it edits a translation:
 * which language, what stays in the source language, and a way back.
 */
export function TranslationModeBanner({ courseUuid, subpage }: { courseUuid: string; subpage: string }) {
  const { t, i18n } = useTranslation()
  const { locale, setLocale, overview } = useEditingLocale(courseUuid)
  if (!locale) return null
  const display = i18n.language || 'en'
  const source = overview?.default_locale || 'en'
  const translatedTab = (TRANSLATED_TABS as readonly string[]).includes(subpage)
  return (
    <div className="px-4 sm:px-10 pt-4" data-testid="translation-mode-banner">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-sky-50 ring-1 ring-inset ring-sky-600/10 px-4 py-2.5 text-sm text-sky-900">
        <Translate size={16} className="shrink-0" />
        <span className="font-semibold">
          {t('dashboard.courses.languages.mode.title', {
            language: localeNativeName(locale),
            defaultValue: 'Translating to {{language}}',
          })}
        </span>
        <span className="text-sky-800/80 min-w-0">
          {translatedTab
            ? t('dashboard.courses.languages.mode.hint', {
                source: localeName(source, display),
                defaultValue: 'Adding, moving or deleting chapters and pages happens in {{source}}.',
              })
            : t('dashboard.courses.languages.mode.shared_tab', 'These settings are shared by every language.')}
        </span>
        <Button
          size="sm"
          onClick={() => setLocale(null)}
          className="ms-auto"
          data-testid="translation-mode-exit"
          icon={<X size={12} />}
        >
          {t('dashboard.courses.languages.mode.exit', { language: localeNativeName(source), defaultValue: 'Back to {{language}}' })}
        </Button>
      </div>
    </div>
  )
}
