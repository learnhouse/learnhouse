'use client'
import React, { useState } from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import {
  ArrowsClockwise,
  CheckCircle,
  CircleNotch,
  DotsThree,
  EyeSlash,
  Globe,
  PencilSimple,
  Plus,
  Star,
  Translate,
  Trash,
  Warning,
} from '@phosphor-icons/react'
import { useCourse } from '@components/Contexts/CourseContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { getUriWithOrg } from '@services/config/config'
import {
  addCourseLanguage,
  localeName,
  localeNativeName,
  removeCourseLanguage,
  setCourseDefaultLocale,
  setCourseLanguageStatus,
  type CourseLanguage,
  type TranslationJob,
} from '@services/courses/translations'
import { Button, buttonClass, Chip, ConfirmDialog, EmptyState, SectionCard } from '@components/Dashboard/Shared/DashKit/DashKit'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@components/ui/dropdown-menu'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import AtlasTranslateButton from '@ee/components/Atlas/Translations/AtlasTranslateButton'
import { EditorPage, EditorSkeleton, ErrorNotice } from '../courseEditorUi'
import { LanguagePicker } from './LanguagePicker'
import { GlossaryEditor } from './GlossaryEditor'
import { jobPercent, progressSummary, runningJobs } from './courseLanguagesModel'
import { useAccessToken, useCourseLanguages } from './useCourseLanguages'

/**
 * Course editor → Languages tab: the source language, the language versions
 * (status, progress, publish, edit, Atlas, remove), running translation jobs
 * and the glossary.
 */
export default function EditCourseLanguages({ orgslug }: { orgslug: string }) {
  const { t, i18n } = useTranslation()
  const course = useCourse() as any
  const org = useOrg() as any
  const token = useAccessToken()
  const courseUuid: string | undefined = course?.courseStructure?.course_uuid
  const { data, isLoading, error, refresh } = useCourseLanguages(courseUuid)
  const display = i18n.language || 'en'

  const [adding, setAdding] = useState<string | null>(null)
  const [toRemove, setToRemove] = useState<CourseLanguage | null>(null)
  const [toPublish, setToPublish] = useState<CourseLanguage | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  if (!courseUuid || isLoading) {
    return (
      <EditorPage>
        <EditorSkeleton sections={2} />
      </EditorPage>
    )
  }
  if (error || !data) {
    return (
      <EditorPage>
        <ErrorNotice>
          {(error as any)?.status === 404
            ? t('dashboard.courses.languages.errors.unavailable', 'Course languages are not available on this server yet.')
            : t('dashboard.courses.languages.errors.load', 'Could not load the course languages.')}
        </ErrorNotice>
      </EditorPage>
    )
  }

  const defaultLocale = data.default_locale || 'en'
  const existing = [defaultLocale, ...data.languages.map((l) => l.locale)]
  const jobs = runningJobs(data.jobs)
  const editorBase = getUriWithOrg(org?.slug || orgslug, '') + `/dash/courses/course/${courseUuid.replace(/^course_/, '')}`

  const add = async (locale: string) => {
    setAdding(locale)
    try {
      await addCourseLanguage(courseUuid, locale, token)
      await refresh()
      toast.success(t('dashboard.courses.languages.toasts.added', { language: localeName(locale, display), defaultValue: '{{language}} added' }))
    } catch (e: any) {
      toast.error(e?.message || t('dashboard.courses.languages.toasts.add_error', 'Could not add the language'))
    } finally {
      setAdding(null)
    }
  }

  const changeDefault = async (locale: string) => {
    try {
      await setCourseDefaultLocale(courseUuid, locale, token)
      await refresh()
      toast.success(t('dashboard.courses.languages.toasts.default_set', { language: localeName(locale, display), defaultValue: 'Source language set to {{language}}' }))
    } catch (e: any) {
      toast.error(
        e?.status === 409
          ? t('dashboard.courses.languages.toasts.default_conflict', 'Remove the translation in that language first.')
          : e?.message || t('dashboard.courses.languages.toasts.error', 'Something went wrong'),
      )
    }
  }

  const setStatus = async (lang: CourseLanguage, status: 'published' | 'draft', includeItems = true) => {
    setBusy(lang.locale)
    try {
      await setCourseLanguageStatus(courseUuid, lang.locale, status, token, includeItems)
      await refresh()
      toast.success(
        status === 'published'
          ? t('dashboard.courses.languages.toasts.published', { language: localeName(lang.locale, display), defaultValue: '{{language}} is live for learners' })
          : t('dashboard.courses.languages.toasts.unpublished', { language: localeName(lang.locale, display), defaultValue: '{{language}} is back to draft' }),
      )
    } catch (e: any) {
      toast.error(e?.message || t('dashboard.courses.languages.toasts.error', 'Something went wrong'))
    } finally {
      setBusy(null)
    }
  }

  const remove = async (lang: CourseLanguage) => {
    try {
      await removeCourseLanguage(courseUuid, lang.locale, token)
      await refresh()
      toast.success(t('dashboard.courses.languages.toasts.removed', { language: localeName(lang.locale, display), defaultValue: '{{language}} removed' }))
    } catch (e: any) {
      toast.error(e?.message || t('dashboard.courses.languages.toasts.error', 'Something went wrong'))
    }
  }

  return (
    <EditorPage width="wide">
      {/* Source language */}
      <SectionCard
        icon={<Star size={18} />}
        title={t('dashboard.courses.languages.source.title', 'Source language')}
        description={t(
          'dashboard.courses.languages.source.description',
          'The language the course is written in. Translations are made from it, and learners see it when their language is not available.',
        )}
        actions={
          <LanguagePicker
            exclude={existing}
            onPick={changeDefault}
            trigger={
              <Button size="sm" data-testid="change-default-language">
                {t('dashboard.courses.languages.source.change', 'Change')}
              </Button>
            }
          />
        }
      >
        <div className="flex items-center gap-3" data-testid="default-language">
          <LocaleBadge locale={defaultLocale} />
          <div className="min-w-0">
            <div className="text-sm font-semibold text-neutral-900">{localeNativeName(defaultLocale)}</div>
            <div className="text-xs text-neutral-500">{localeName(defaultLocale, display)}</div>
          </div>
          <Chip tone="neutral" className="ms-auto" icon={<Star size={12} />}>
            {t('dashboard.courses.languages.source.badge', 'Default')}
          </Chip>
        </div>
      </SectionCard>

      {/* Running jobs */}
      {jobs.length > 0 && (
        <div className="space-y-2" data-testid="translation-jobs">
          {jobs.map((job) => (
            <JobRow key={job.job_id} job={job} display={display} />
          ))}
        </div>
      )}

      {/* Language versions */}
      <SectionCard
        icon={<Translate size={18} />}
        title={t('dashboard.courses.languages.list.title', 'Languages')}
        description={t(
          'dashboard.courses.languages.list.description',
          'One course, several languages. Progress, enrollments and certificates stay shared; only texts are translated.',
        )}
        actions={
          <>
            {data.languages.length > 0 && (
              <AtlasTranslateButton
                courseUuid={courseUuid}
                locales={data.languages.map((l) => l.locale)}
                scope="course"
                size="sm"
                label={t('dashboard.courses.languages.atlas.translate_all', 'Translate all with Atlas')}
                onStarted={() => refresh()}
              />
            )}
            <LanguagePicker
              exclude={existing}
              onPick={add}
              trigger={
                <Button size="sm" variant="primary" icon={<Plus size={14} />} loading={!!adding} data-testid="add-language">
                  {t('dashboard.courses.languages.add', 'Add language')}
                </Button>
              }
            />
          </>
        }
        bodyClassName="p-0 pt-4"
      >
        {data.languages.length === 0 ? (
          <div className="px-5 pb-5">
            <EmptyState
              icon={<Globe size={22} />}
              title={t('dashboard.courses.languages.empty.title', 'Only one language so far')}
              description={t(
                'dashboard.courses.languages.empty.description',
                'Add a language to translate this course. Learners get their language automatically once it is published.',
              )}
            />
          </div>
        ) : (
          <ul className="divide-y divide-neutral-100" data-testid="language-list">
            {data.languages.map((lang) => (
              <LanguageRow
                key={lang.locale}
                lang={lang}
                display={display}
                job={runningJobs(data.jobs, lang.locale)[0]}
                busy={busy === lang.locale}
                editHref={`${editorBase}/general?lang=${encodeURIComponent(lang.locale)}`}
                courseUuid={courseUuid}
                onPublish={() => setToPublish(lang)}
                onUnpublish={() => setStatus(lang, 'draft')}
                onRemove={() => setToRemove(lang)}
                onAtlasStarted={() => refresh()}
              />
            ))}
          </ul>
        )}
      </SectionCard>

      <GlossaryEditor courseUuid={courseUuid} locales={data.languages.map((l) => l.locale)} />

      {toPublish && (
        <PublishDialog
          lang={toPublish}
          display={display}
          onClose={() => setToPublish(null)}
          onConfirm={(includeItems) => setStatus(toPublish, 'published', includeItems)}
        />
      )}
      <ConfirmDialog
        open={!!toRemove}
        onOpenChange={(o) => !o && setToRemove(null)}
        title={t('dashboard.courses.languages.remove.title', {
          language: toRemove ? localeName(toRemove.locale, display) : '',
          defaultValue: 'Remove {{language}}?',
        })}
        message={t(
          'dashboard.courses.languages.remove.message',
          'Every translated text in this language (course details, chapters, pages and their comments) is deleted. This cannot be undone.',
        )}
        confirmLabel={t('dashboard.courses.languages.remove.confirm', 'Remove language')}
        onConfirm={() => (toRemove ? remove(toRemove) : undefined)}
      />
    </EditorPage>
  )
}

export function LocaleBadge({ locale, size = 'md' }: { locale: string; size?: 'sm' | 'md' }) {
  return (
    <span
      className={`shrink-0 rounded-lg bg-neutral-100 font-semibold uppercase text-neutral-600 flex items-center justify-center ${
        size === 'sm' ? 'w-7 h-5 text-[10px] rounded-md' : 'w-10 h-8 text-xs'
      }`}
    >
      {locale.split('-')[0]}
    </span>
  )
}

function LanguageRow({
  lang,
  display,
  job,
  busy,
  editHref,
  courseUuid,
  onPublish,
  onUnpublish,
  onRemove,
  onAtlasStarted,
}: {
  lang: CourseLanguage
  display: string
  job?: TranslationJob
  busy: boolean
  editHref: string
  courseUuid: string
  onPublish: () => void
  onUnpublish: () => void
  onRemove: () => void
  onAtlasStarted: () => void
}) {
  const { t } = useTranslation()
  const p = progressSummary(lang.progress)
  const published = lang.status === 'published'
  return (
    <li className="px-5 py-4 flex flex-wrap items-center gap-x-4 gap-y-3" data-testid={`language-row-${lang.locale}`}>
      <div className="flex items-center gap-3 min-w-0 grow basis-60">
        <LocaleBadge locale={lang.locale} />
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-neutral-900">{localeNativeName(lang.locale)}</span>
            <span className="text-xs text-neutral-500">{localeName(lang.locale, display)}</span>
            {published ? (
              <Chip tone="emerald" icon={<CheckCircle size={12} />}>
                {t('dashboard.courses.languages.status.published', 'Published')}
              </Chip>
            ) : (
              <Chip tone="neutral" icon={<EyeSlash size={12} />}>
                {t('dashboard.courses.languages.status.draft', 'Draft')}
              </Chip>
            )}
            {lang.translated_by === 'atlas' && (
              <Chip tone="violet">{t('dashboard.courses.languages.status.by_atlas', 'By Atlas')}</Chip>
            )}
          </div>
          {lang.name && (
            <div className="mt-0.5 text-xs text-neutral-500 truncate max-w-md">
              <bdi lang={lang.locale}>{lang.name}</bdi>
            </div>
          )}
        </div>
      </div>

      <div className="basis-56 grow sm:grow-0 min-w-0">
        {job ? (
          <JobProgress job={job} display={display} compact />
        ) : (
          <>
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="text-neutral-600 tabular-nums" data-testid="language-progress">
                {t('dashboard.courses.languages.progress', {
                  done: p.translated,
                  total: p.total,
                  defaultValue: '{{done}}/{{total}} pages translated',
                })}
              </span>
              {p.outdated > 0 && (
                <span className="flex items-center gap-1 font-medium text-amber-700">
                  <Warning size={12} />
                  {t('dashboard.courses.languages.outdated', { count: p.outdated, defaultValue: '{{count}} outdated' })}
                </span>
              )}
            </div>
            <div className="mt-1.5 h-1.5 rounded-full bg-neutral-100 overflow-hidden">
              <div className="h-full rounded-full bg-neutral-900 transition-all" style={{ width: `${p.percent}%` }} />
            </div>
          </>
        )}
      </div>

      <div className="flex items-center gap-2 ms-auto">
        <Button
          size="sm"
          variant={published ? 'secondary' : 'primary'}
          loading={busy}
          icon={published ? <EyeSlash size={13} /> : <Globe size={13} />}
          onClick={published ? onUnpublish : onPublish}
          data-testid={`language-publish-${lang.locale}`}
        >
          {published ? t('dashboard.courses.languages.unpublish', 'Unpublish') : t('dashboard.courses.languages.publish', 'Publish')}
        </Button>
        <Link href={editHref} className={buttonClass('secondary', 'sm')} data-testid={`language-edit-${lang.locale}`}>
          <PencilSimple size={13} />
          {t('dashboard.courses.languages.edit', 'Edit')}
        </Link>
        <AtlasTranslateButton
          courseUuid={courseUuid}
          locales={[lang.locale]}
          scope="course"
          size="sm"
          disabled={!!job}
          onStarted={onAtlasStarted}
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" aria-label={t('dashboard.courses.languages.more', 'More actions')} className="px-2">
              <DotsThree size={16} weight="bold" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="rounded-xl">
            <DropdownMenuItem asChild>
              <Link href={editHref.replace('/general?', '/content?')}>
                <ArrowsClockwise size={14} className="me-2" />
                {t('dashboard.courses.languages.review_pages', 'Review pages')}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onRemove} className="text-rose-600 focus:text-rose-700" data-testid={`language-remove-${lang.locale}`}>
              <Trash size={14} className="me-2" />
              {t('dashboard.courses.languages.remove.action', 'Remove language')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  )
}

function JobRow({ job, display }: { job: TranslationJob; display: string }) {
  return (
    <div className="bg-white rounded-2xl nice-shadow px-5 py-4">
      <JobProgress job={job} display={display} />
    </div>
  )
}

export function JobProgress({ job, display, compact = false }: { job: TranslationJob; display: string; compact?: boolean }) {
  const { t } = useTranslation()
  const pct = jobPercent(job)
  const label =
    job.label ||
    t('dashboard.courses.languages.jobs.label', {
      done: job.done,
      total: job.total,
      language: localeName(job.locale, display),
      defaultValue: 'Translating {{done}}/{{total}} pages to {{language}}',
    })
  return (
    <div data-testid="translation-job">
      <div className={`flex items-center gap-2 ${compact ? 'text-xs' : 'text-sm'} font-medium text-neutral-800`}>
        <CircleNotch size={compact ? 12 : 14} className="animate-spin text-violet-600 shrink-0" />
        <span className="truncate">{label}</span>
        {job.failed > 0 && (
          <span className="ms-auto shrink-0 text-xs text-rose-600">
            {t('dashboard.courses.languages.jobs.failed', { count: job.failed, defaultValue: '{{count}} failed' })}
          </span>
        )}
      </div>
      <div className={`${compact ? 'mt-1.5 h-1.5' : 'mt-2 h-2'} rounded-full bg-violet-100 overflow-hidden`}>
        <div className="h-full rounded-full bg-violet-600 transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function PublishDialog({
  lang,
  display,
  onClose,
  onConfirm,
}: {
  lang: CourseLanguage
  display: string
  onClose: () => void
  onConfirm: (_includeItems: boolean) => Promise<void>
}) {
  const { t } = useTranslation()
  const [includeItems, setIncludeItems] = useState(true)
  const [pending, setPending] = useState(false)
  const p = progressSummary(lang.progress)
  return (
    <Modal
      isDialogOpen
      onOpenChange={(o) => !o && !pending && onClose()}
      preventClose={pending}
      size="sm"
      dialogContent={
        <div className="flex flex-col gap-5" data-testid="publish-language-dialog">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
              <Globe size={18} />
            </div>
            <div className="min-w-0">
              <p className="text-base font-semibold text-neutral-900">
                {t('dashboard.courses.languages.publish_dialog.title', {
                  language: localeName(lang.locale, display),
                  defaultValue: 'Publish {{language}}?',
                })}
              </p>
              <p className="mt-1 text-sm text-neutral-500">
                {t(
                  'dashboard.courses.languages.publish_dialog.message',
                  'Learners who prefer this language will see the translated texts. Pages without a published translation stay in the source language.',
                )}
              </p>
            </div>
          </div>
          <label className="flex items-start gap-3 rounded-xl ring-1 ring-inset ring-neutral-200 px-4 py-3 cursor-pointer">
            <input
              type="checkbox"
              checked={includeItems}
              onChange={(e) => setIncludeItems(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-neutral-900"
              data-testid="publish-include-items"
            />
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-neutral-900">
                {t('dashboard.courses.languages.publish_dialog.include_items', 'Also publish every translated chapter and page')}
              </span>
              <span className="block text-xs text-neutral-500 mt-0.5">
                {t('dashboard.courses.languages.publish_dialog.include_items_hint', {
                  done: p.translated,
                  total: p.total,
                  defaultValue: '{{done}} of {{total}} pages are translated.',
                })}
              </span>
            </span>
          </label>
          <div className="flex justify-end gap-2">
            <Button onClick={onClose} disabled={pending}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              loading={pending}
              data-testid="publish-language-confirm"
              onClick={async () => {
                setPending(true)
                try {
                  await onConfirm(includeItems)
                  onClose()
                } finally {
                  setPending(false)
                }
              }}
            >
              {t('dashboard.courses.languages.publish', 'Publish')}
            </Button>
          </div>
        </div>
      }
    />
  )
}
