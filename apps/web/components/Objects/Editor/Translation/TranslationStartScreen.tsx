'use client'
import React from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import { ArrowLeft, Copy, FileDashed, Translate } from '@phosphor-icons/react'
import { useAuth } from '@components/Contexts/AuthContext'
import { localeName, localeNativeName, seedActivityTranslation, type ActivityTranslation } from '@services/courses/translations'
import { Button, buttonClass } from '@components/Dashboard/Shared/DashKit/DashKit'
import AtlasTranslateButton from '@ee/components/Atlas/Translations/AtlasTranslateButton'
import EditorPreview from '../EditorPreview'

function sourceHref() {
  if (typeof window === 'undefined') return '#'
  const url = new URL(window.location.href)
  url.searchParams.delete('lang')
  return url.pathname + url.search
}

/** The translation can't be opened (language not on the course, no access). */
export function TranslationUnavailable({ locale, status }: { locale: string; status?: number }) {
  const { t, i18n } = useTranslation()
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f8f8f8] px-4" data-testid="translation-unavailable">
      <div className="max-w-md text-center bg-white rounded-2xl nice-shadow p-8">
        <div className="mx-auto w-11 h-11 rounded-xl bg-neutral-100 text-neutral-500 flex items-center justify-center">
          <Translate size={20} />
        </div>
        <h1 className="mt-4 text-lg font-semibold text-neutral-900">
          {status === 404
            ? t('editor.translation.unavailable.not_on_course', {
                language: localeName(locale, i18n.language || 'en'),
                defaultValue: '{{language}} is not a language of this course',
              })
            : t('editor.translation.unavailable.title', 'This translation could not be opened')}
        </h1>
        <p className="mt-1 text-sm text-neutral-500">
          {t('editor.translation.unavailable.hint', 'Add the language in the course editor (Languages tab), then come back.')}
        </p>
        <Link href={sourceHref()} className={`mt-5 ${buttonClass('secondary', 'md')}`}>
          <ArrowLeft size={14} className="rtl:rotate-180" />
          {t('editor.translation.back_to_source', 'Edit the source')}
        </Link>
      </div>
    </div>
  )
}

/**
 * The page has no translation in this language yet: start it from a copy of
 * the source, with Atlas (EE), or empty. The source shows below.
 */
export default function TranslationStartScreen({
  locale,
  activity,
  course,
  translation,
  onStarted,
  onAtlasDone,
}: {
  locale: string
  activity: any
  course: any
  translation: ActivityTranslation
  onStarted: (_t: ActivityTranslation) => void
  onAtlasDone: () => void
}) {
  const { t, i18n } = useTranslation()
  const { getAccessToken } = useAuth()
  const [pending, setPending] = React.useState<'source' | 'empty' | null>(null)
  const display = i18n.language || 'en'

  const seed = async (from: 'source' | 'empty') => {
    setPending(from)
    try {
      const token = await getAccessToken()
      const created = await seedActivityTranslation(activity.activity_uuid, locale, from, token)
      onStarted({ ...created, source: created.source ?? translation.source })
    } catch (e: any) {
      toast.error(e?.message || t('editor.translation.start.error', 'Could not start the translation'))
      setPending(null)
    }
  }

  return (
    <div className="min-h-screen bg-[#f8f8f8] px-4 py-10" data-testid="translation-start">
      <div className="mx-auto max-w-5xl space-y-6">
        <Link href={sourceHref()} className="inline-flex items-center gap-1.5 text-sm text-neutral-500 hover:text-neutral-800">
          <ArrowLeft size={14} className="rtl:rotate-180" />
          {course?.name ? `${course.name} · ` : ''}
          {activity.name}
        </Link>
        <div className="bg-white rounded-2xl nice-shadow p-6 sm:p-8">
          <div className="flex items-start gap-4">
            <div className="w-11 h-11 rounded-xl bg-sky-50 text-sky-600 flex items-center justify-center shrink-0">
              <Translate size={20} />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg font-semibold text-neutral-900">
                {t('editor.translation.start.title', {
                  language: localeNativeName(locale),
                  defaultValue: 'Translate this page to {{language}}',
                })}
              </h1>
              <p className="mt-1 text-sm text-neutral-500">
                {t('editor.translation.start.description', {
                  language: localeName(locale, display),
                  defaultValue:
                    'There is no {{language}} version of this page yet. Learners keep seeing the source until a translation is published.',
                })}
              </p>
            </div>
          </div>
          <div className="mt-6 grid sm:grid-cols-3 gap-3">
            <StartOption
              icon={<Copy size={18} />}
              title={t('editor.translation.start.copy', 'Start from a copy of the source')}
              description={t('editor.translation.start.copy_hint', 'Same blocks and media; replace the texts.')}
              action={t('editor.translation.start.copy_action', 'Copy the source')}
              onClick={() => seed('source')}
              loading={pending === 'source'}
              disabled={!!pending}
              testId="translation-start-copy"
              primary
            />
            <div className="rounded-xl ring-1 ring-inset ring-neutral-200 p-4 flex flex-col gap-3">
              <div>
                <div className="text-sm font-semibold text-neutral-900">{t('editor.translation.start.atlas', 'Translate with Atlas')}</div>
                <p className="mt-1 text-xs text-neutral-500">
                  {t('editor.translation.start.atlas_hint', 'Atlas writes a draft you review here. Uses AI credits.')}
                </p>
              </div>
              <div className="mt-auto">
                <AtlasTranslateButton
                  courseUuid={course?.course_uuid}
                  locales={[locale]}
                  scope="activities"
                  activityUuids={[activity.activity_uuid]}
                  size="sm"
                  waitForCompletion
                  onDone={onAtlasDone}
                />
              </div>
            </div>
            <StartOption
              icon={<FileDashed size={18} />}
              title={t('editor.translation.start.empty', 'Start empty')}
              description={t('editor.translation.start.empty_hint', 'A blank page, written from scratch.')}
              action={t('editor.translation.start.empty_action', 'Start blank')}
              onClick={() => seed('empty')}
              loading={pending === 'empty'}
              disabled={!!pending}
              testId="translation-start-empty"
            />
          </div>
        </div>
        {translation.source?.content && (
          <div className="bg-white rounded-2xl nice-shadow p-6 sm:p-8">
            <div className="text-sm font-semibold text-neutral-900 mb-3">
              {t('editor.translation.source_label', 'Source')} · {translation.source.name}
            </div>
            <div className="lh-translation-source">
              <EditorPreview content={translation.source.content} activity={activity} />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function StartOption({
  icon,
  title,
  description,
  action,
  onClick,
  loading,
  disabled,
  primary,
  testId,
}: {
  icon: React.ReactNode
  title: string
  description: string
  action: string
  onClick: () => void
  loading: boolean
  disabled: boolean
  primary?: boolean
  testId: string
}) {
  return (
    <div className="rounded-xl ring-1 ring-inset ring-neutral-200 p-4 flex flex-col gap-3">
      <div className="flex items-start gap-2">
        <span className="text-neutral-500 mt-0.5">{icon}</span>
        <div>
          <div className="text-sm font-semibold text-neutral-900">{title}</div>
          <p className="mt-1 text-xs text-neutral-500">{description}</p>
        </div>
      </div>
      <Button size="sm" variant={primary ? 'primary' : 'secondary'} className="mt-auto self-start" onClick={onClick} loading={loading} disabled={disabled} data-testid={testId}>
        {action}
      </Button>
    </div>
  )
}
