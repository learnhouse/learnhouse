'use client'
import React from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { CaretDown, Check, Star, Translate } from '@phosphor-icons/react'
import { localeName, localeNativeName } from '@services/courses/translations'
import { useCourseLanguages } from '@components/Dashboard/Pages/Course/EditCourseLanguages/useCourseLanguages'
import { withLangParam } from '@components/Dashboard/Pages/Course/EditCourseLanguages/courseLanguagesModel'
import * as PopoverPrimitive from '@radix-ui/react-popover'
import { HBTN, HLABEL, HMENU, HMENU_ITEM } from '../Header/headerStyles'
import { useEditorLocale } from './EditorLocaleContext'

/**
 * Language switcher in the activity editor header (only when the course has
 * other languages). A language opens its translation side by side with the
 * source (`?lang=fr`); the source language goes back to the page itself.
 */
export default function EditorLanguageSwitcher({ courseUuid }: { courseUuid: string }) {
  const { t, i18n } = useTranslation()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const ctx = useEditorLocale()
  const { data } = useCourseLanguages(courseUuid)
  const [open, setOpen] = React.useState(false)
  if (!data || data.languages.length === 0) return null
  const display = i18n.language || 'en'
  const current = ctx?.locale ?? null
  const go = (lang: string | null) => {
    const href = withLangParam(`${pathname}${searchParams?.toString() ? `?${searchParams}` : ''}`, lang)
    router.push(href)
  }

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          className={`${HBTN} ${current ? '!bg-sky-50 !text-sky-800 shadow-[0_0_0_1px_rgba(2,132,199,0.3)]' : ''}`}
          aria-label={t('editor.translation.switcher.label', 'Language')}
          data-testid="editor-language-switcher"
        >
          <Translate size={16} />
          <span className={`${HLABEL} uppercase tabular-nums`} title={localeNativeName(current || data.default_locale || 'en')}>
            {current || data.default_locale || 'en'}
          </span>
          <CaretDown size={11} />
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="end"
          sideOffset={6}
          collisionPadding={8}
          style={{ zIndex: 'var(--z-editor-bubble, 60)', width: 260 }}
          className={`${HMENU} max-w-[calc(100vw-16px)]`}
        >
        <div>
          <button
            type="button"
            className={HMENU_ITEM}
            onClick={() => {
              setOpen(false)
              if (current) go(null)
            }}
            data-testid="editor-language-source"
          >
            <Star size={14} className="text-neutral-500" />
            <span className="flex-1 truncate">{localeNativeName(data.default_locale || 'en')}</span>
            <span className="text-xs text-neutral-400">{t('editor.translation.source_label', 'Source')}</span>
            {!current && <Check size={14} />}
          </button>
          <div className="my-1 h-px bg-neutral-100" />
          {data.languages.map((l) => (
            <button
              key={l.locale}
              type="button"
              className={HMENU_ITEM}
              onClick={() => {
                setOpen(false)
                if (current !== l.locale) go(l.locale)
              }}
              data-testid={`editor-language-${l.locale}`}
            >
              <span className="w-5 text-[10px] font-semibold uppercase text-neutral-500">{l.locale.split('-')[0]}</span>
              <span className="flex-1 min-w-0 truncate">
                {localeNativeName(l.locale)} <span className="text-xs text-neutral-400">{localeName(l.locale, display)}</span>
              </span>
              {l.status === 'draft' && <span className="text-[10px] font-semibold uppercase text-neutral-400">{t('editor.translation.status.draft', 'Draft')}</span>}
              {current === l.locale && <Check size={14} />}
            </button>
          ))}
        </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}
