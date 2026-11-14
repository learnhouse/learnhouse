'use client'
import React, { useState } from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowSquareOut, Check, CheckCircle, Circle, EyeSlash, Globe, PencilSimple, Warning } from '@phosphor-icons/react'
import { useCourse } from '@components/Contexts/CourseContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { getUriWithOrg } from '@services/config/config'
import {
  getTranslationOutline,
  isRtlLocale,
  setActivityTranslationStatus,
  updateChapterTranslation,
  type OutlineActivity,
  type OutlineChapter,
  type TranslationOutline,
} from '@services/courses/translations'
import { Button, buttonClass, Chip, INPUT, SectionCard } from '@components/Dashboard/Shared/DashKit/DashKit'
import AtlasTranslateButton from '@ee/components/Atlas/Translations/AtlasTranslateButton'
import { EditorPage, EditorSkeleton, ErrorNotice } from '../courseEditorUi'
import { itemTranslationState, type ItemTranslationState } from './courseLanguagesModel'
import { courseLanguagesKey, translationOutlineKey, useAccessToken } from './useCourseLanguages'

/**
 * Course editor → Content tab in translation mode: chapter and page names
 * with their translation status. Chapter names are edited inline; pages open
 * the activity editor in that language. The structure itself (add, move,
 * delete) is only edited in the source language.
 */
export default function TranslateCourseStructure({ locale, orgslug }: { locale: string; orgslug: string }) {
  const { t } = useTranslation()
  const course = useCourse() as any
  const org = useOrg() as any
  const token = useAccessToken()
  const queryClient = useQueryClient()
  const courseUuid: string | undefined = course?.courseStructure?.course_uuid
  const { data, isLoading, error } = useQuery<TranslationOutline>({
    queryKey: translationOutlineKey(courseUuid || '', locale),
    queryFn: () => getTranslationOutline(courseUuid!, locale, token),
    enabled: !!courseUuid && !!token,
    retry: false,
  })
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: translationOutlineKey(courseUuid || '', locale) })
    queryClient.invalidateQueries({ queryKey: courseLanguagesKey(courseUuid || '') })
  }

  if (isLoading || !courseUuid) {
    return (
      <EditorPage>
        <EditorSkeleton sections={2} rows={4} />
      </EditorPage>
    )
  }
  if (error || !data) {
    return (
      <EditorPage>
        <ErrorNotice>{t('dashboard.courses.languages.errors.outline', 'Could not load the translation outline.')}</ErrorNotice>
      </EditorPage>
    )
  }

  const editorBase = getUriWithOrg(org?.slug || orgslug, '') + `/course/${courseUuid.replace(/^course_/, '')}/activity/`
  const counts = { translated: 0, outdated: 0, missing: 0 }
  data.chapters.forEach((c) =>
    c.activities.filter((a) => a.translatable).forEach((a) => counts[itemTranslationState(a.translation)]++),
  )

  return (
    <EditorPage width="wide">
      <div className="flex flex-wrap items-center gap-2" data-testid="translate-outline-summary">
        <Chip tone="emerald" icon={<CheckCircle size={12} />}>
          {t('dashboard.courses.languages.outline.translated', { count: counts.translated, defaultValue: '{{count}} translated' })}
        </Chip>
        <Chip tone="amber" icon={<Warning size={12} />}>
          {t('dashboard.courses.languages.outline.outdated', { count: counts.outdated, defaultValue: '{{count}} outdated' })}
        </Chip>
        <Chip tone="neutral" icon={<Circle size={12} />}>
          {t('dashboard.courses.languages.outline.missing', { count: counts.missing, defaultValue: '{{count}} not translated' })}
        </Chip>
        <div className="ms-auto">
          <AtlasTranslateButton courseUuid={courseUuid} locales={[locale]} scope="course" size="sm" onStarted={refresh} />
        </div>
      </div>

      {data.chapters.map((chapter) => (
        <ChapterCard
          // A new saved name (here or by Atlas) resets the inline field
          key={`${chapter.chapter_uuid}:${chapter.translation?.name ?? ''}`}
          chapter={chapter}
          locale={locale}
          courseUuid={courseUuid}
          editorBase={editorBase}
          token={token}
          onChanged={refresh}
        />
      ))}
    </EditorPage>
  )
}

function StateChip({ state }: { state: ItemTranslationState }) {
  const { t } = useTranslation()
  if (state === 'translated')
    return (
      <Chip tone="emerald" icon={<Check size={11} weight="bold" />}>
        {t('dashboard.courses.languages.state.translated', 'Translated')}
      </Chip>
    )
  if (state === 'outdated')
    return (
      <Chip tone="amber" icon={<Warning size={11} />}>
        {t('dashboard.courses.languages.state.outdated', 'Outdated')}
      </Chip>
    )
  return <Chip tone="neutral">{t('dashboard.courses.languages.state.missing', 'Not translated')}</Chip>
}

function ChapterCard({
  chapter,
  locale,
  courseUuid,
  editorBase,
  token,
  onChanged,
}: {
  chapter: OutlineChapter
  locale: string
  courseUuid: string
  editorBase: string
  token?: string
  onChanged: () => void
}) {
  const { t } = useTranslation()
  const [name, setName] = useState(chapter.translation?.name || '')
  const [saving, setSaving] = useState(false)
  const saved = chapter.translation?.name || ''
  const dirty = name.trim() !== saved
  const dir = isRtlLocale(locale) ? 'rtl' : undefined

  const saveName = async () => {
    if (!dirty || !name.trim()) return
    setSaving(true)
    try {
      await updateChapterTranslation(courseUuid, locale, chapter.chapter_uuid, { name: name.trim() }, token)
      onChanged()
      toast.success(t('dashboard.courses.languages.toasts.saved', 'Translation saved'))
    } catch (e: any) {
      toast.error(e?.message || t('dashboard.courses.languages.toasts.error', 'Something went wrong'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <SectionCard bodyClassName="p-0" className="overflow-hidden">
      <div className="px-5 pt-5 pb-4 border-b border-neutral-100" data-testid={`translate-chapter-${chapter.chapter_uuid}`}>
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <span className="text-xs font-medium text-neutral-500">
            {t('dashboard.courses.languages.outline.chapter', 'Chapter')}
          </span>
          <StateChip state={itemTranslationState(chapter.translation)} />
          <div className="ms-auto">
            <AtlasTranslateButton
              courseUuid={courseUuid}
              locales={[locale]}
              scope="chapters"
              chapterUuids={[chapter.chapter_uuid]}
              size="sm"
              label={t('dashboard.courses.languages.atlas.translate_chapter', 'Translate chapter')}
              onStarted={onChanged}
            />
          </div>
        </div>
        <div className="grid md:grid-cols-2 gap-2 md:gap-4 items-center">
          <div className="text-sm font-semibold text-neutral-900 truncate">{chapter.source.name}</div>
          <div className="flex items-center gap-2">
            <input
              className={INPUT}
              value={name}
              dir={dir}
              lang={locale}
              placeholder={chapter.source.name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveName()
                if (e.key === 'Escape') setName(saved)
              }}
              aria-label={t('dashboard.courses.languages.outline.chapter_name', 'Translated chapter name')}
              data-testid="translate-chapter-name"
            />
            {dirty && (
              <Button size="sm" variant="primary" loading={saving} onClick={saveName} disabled={!name.trim()}>
                {t('dashboard.kit.save')}
              </Button>
            )}
          </div>
        </div>
      </div>
      <ul className="divide-y divide-neutral-100">
        {chapter.activities.length === 0 && (
          <li className="px-5 py-4 text-sm text-neutral-400">{t('dashboard.courses.languages.outline.no_pages', 'No pages in this chapter')}</li>
        )}
        {chapter.activities.map((a) => (
          <ActivityRow key={a.activity_uuid} activity={a} locale={locale} courseUuid={courseUuid} editorBase={editorBase} token={token} onChanged={onChanged} />
        ))}
      </ul>
    </SectionCard>
  )
}

function ActivityRow({
  activity,
  locale,
  courseUuid,
  editorBase,
  token,
  onChanged,
}: {
  activity: OutlineActivity
  locale: string
  courseUuid: string
  editorBase: string
  token?: string
  onChanged: () => void
}) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const tr = activity.translation
  const state = itemTranslationState(tr)
  const editable = activity.translatable && activity.activity_type === 'TYPE_DYNAMIC'
  const href = `${editorBase}${activity.activity_uuid.replace(/^activity_/, '')}/edit?lang=${encodeURIComponent(locale)}`

  const toggleStatus = async () => {
    if (!tr) return
    setBusy(true)
    try {
      await setActivityTranslationStatus(activity.activity_uuid, locale, tr.status === 'published' ? 'draft' : 'published', token)
      onChanged()
    } catch (e: any) {
      toast.error(e?.message || t('dashboard.courses.languages.toasts.error', 'Something went wrong'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="px-5 py-3 grid md:grid-cols-2 gap-2 md:gap-4 items-center" data-testid={`translate-activity-${activity.activity_uuid}`}>
      <div className="min-w-0 text-sm text-neutral-700 truncate">{activity.name}</div>
      <div className="flex flex-wrap items-center gap-2 min-w-0">
        {activity.translatable ? (
          <>
            <span className={`min-w-0 grow truncate text-sm ${tr ? 'text-neutral-900' : 'text-neutral-300'}`} dir={isRtlLocale(locale) ? 'rtl' : undefined}>
              {tr?.name || t('dashboard.courses.languages.outline.untitled', 'Not translated yet')}
            </span>
            <StateChip state={state} />
            {tr && (
              <button
                type="button"
                onClick={toggleStatus}
                disabled={busy}
                title={
                  tr.status === 'published'
                    ? t('dashboard.courses.languages.outline.unpublish_page', 'Published: click to set back to draft')
                    : t('dashboard.courses.languages.outline.publish_page', 'Draft: click to publish')
                }
                className={`inline-flex items-center gap-1 h-7 px-2 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50 ${
                  tr.status === 'published' ? 'text-emerald-700 hover:bg-emerald-50' : 'text-neutral-500 hover:bg-neutral-100'
                }`}
                data-testid="translate-activity-status"
              >
                {tr.status === 'published' ? <Globe size={12} /> : <EyeSlash size={12} />}
                {tr.status === 'published'
                  ? t('dashboard.courses.languages.status.published', 'Published')
                  : t('dashboard.courses.languages.status.draft', 'Draft')}
              </button>
            )}
            <AtlasTranslateButton
              courseUuid={courseUuid}
              locales={[locale]}
              scope="activities"
              activityUuids={[activity.activity_uuid]}
              variant="icon"
              size="sm"
              onStarted={onChanged}
            />
            {editable ? (
              <Link href={href} className={buttonClass('secondary', 'sm')} data-testid="translate-activity-edit">
                {tr ? <PencilSimple size={12} /> : <ArrowSquareOut size={12} />}
                {tr ? t('dashboard.courses.languages.outline.edit', 'Edit') : t('dashboard.courses.languages.outline.translate', 'Translate')}
              </Link>
            ) : null}
          </>
        ) : (
          <span className="text-xs text-neutral-400">{t('dashboard.courses.languages.outline.not_translatable', 'Nothing to translate')}</span>
        )}
      </div>
    </li>
  )
}
