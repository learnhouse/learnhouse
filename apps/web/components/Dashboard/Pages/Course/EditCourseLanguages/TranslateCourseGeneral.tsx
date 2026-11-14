'use client'
import React, { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import { Info, ListChecks, Warning } from '@phosphor-icons/react'
import { useCourse } from '@components/Contexts/CourseContext'
import { Chip, SectionCard, StickySaveBar } from '@components/Dashboard/Shared/DashKit/DashKit'
import { EditorPage, EditorSkeleton, ErrorNotice } from '../courseEditorUi'
import { SideBySideField, SideBySideHeader } from './SideBySide'
import { learningTextsById, mergeLearningTexts, parseLearningItems } from './courseLanguagesModel'
import { useCourseTranslation } from './useCourseTranslation'
import { useCourseLanguages } from './useCourseLanguages'

type Draft = { name: string; description: string; about: string; tags: string; learnings: Record<string, string> }

/**
 * Course editor → General tab in translation mode: the course texts side by
 * side, source read-only on the start side, translation editable.
 */
export default function TranslateCourseGeneral({ locale }: { locale: string }) {
  const { t } = useTranslation()
  const course = useCourse() as any
  const courseUuid: string | undefined = course?.courseStructure?.course_uuid
  const { data: overview } = useCourseLanguages(courseUuid)
  const { data, isLoading, error, save } = useCourseTranslation(courseUuid, locale)
  const sourceLocale = overview?.default_locale || 'en'

  const sourceLearnings = useMemo(() => parseLearningItems(data?.source?.learnings), [data?.source?.learnings])
  const initial = useMemo<Draft | null>(
    () =>
      data
        ? {
            name: data.name || '',
            description: data.description || '',
            about: data.about || '',
            tags: data.tags || '',
            learnings: learningTextsById(sourceLearnings, data.learnings),
          }
        : null,
    [data, sourceLearnings],
  )
  const [draft, setDraft] = useState<Draft | null>(initial)
  const [saving, setSaving] = useState(false)
  // A new server copy (loaded, saved, Atlas) resets the form
  const [seen, setSeen] = useState(initial)
  if (initial !== seen) {
    setSeen(initial)
    setDraft(initial)
  }

  if (isLoading || (!draft && !error)) {
    return (
      <EditorPage>
        <EditorSkeleton sections={2} />
      </EditorPage>
    )
  }
  if (error || !data || !draft) {
    return (
      <EditorPage>
        <ErrorNotice>{t('dashboard.courses.languages.errors.translation', 'Could not load this translation.')}</ErrorNotice>
      </EditorPage>
    )
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(initial)
  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch })

  const onSave = async () => {
    setSaving(true)
    try {
      await save({
        name: draft.name,
        description: draft.description,
        about: draft.about,
        tags: draft.tags,
        learnings: sourceLearnings.length ? mergeLearningTexts(sourceLearnings, draft.learnings) : data.learnings,
      })
      toast.success(t('dashboard.courses.languages.toasts.saved', 'Translation saved'))
    } catch (e: any) {
      toast.error(e?.message || t('dashboard.courses.languages.toasts.error', 'Something went wrong'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <EditorPage width="wide">
      {data.outdated && (
        <div className="flex items-center gap-2 rounded-xl bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200 px-4 py-3 text-sm font-medium">
          <Warning size={16} className="shrink-0" />
          {t('dashboard.courses.languages.general.outdated', 'The source texts changed since this translation. Review and save to mark it up to date.')}
        </div>
      )}
      <SectionCard
        icon={<Info size={18} />}
        title={t('dashboard.courses.languages.general.title', 'Course details')}
        actions={
          data.translated_by === 'atlas' ? <Chip tone="violet">{t('dashboard.courses.languages.status.by_atlas', 'By Atlas')}</Chip> : undefined
        }
      >
        <div className="space-y-5" data-testid="translate-general">
          <SideBySideHeader source={sourceLocale} locale={locale} />
          <SideBySideField
            label={t('dashboard.courses.languages.fields.name', 'Name')}
            source={data.source?.name}
            value={draft.name}
            onChange={(v) => set({ name: v })}
            locale={locale}
            testId="translate-name"
          />
          <SideBySideField
            label={t('dashboard.courses.languages.fields.description', 'Description')}
            source={data.source?.description}
            value={draft.description}
            onChange={(v) => set({ description: v })}
            locale={locale}
            multiline
            rows={3}
            testId="translate-description"
          />
          <SideBySideField
            label={t('dashboard.courses.languages.fields.about', 'About')}
            source={data.source?.about}
            value={draft.about}
            onChange={(v) => set({ about: v })}
            locale={locale}
            multiline
            rows={6}
            testId="translate-about"
          />
          <SideBySideField
            label={t('dashboard.courses.languages.fields.tags', 'Tags')}
            source={data.source?.tags}
            value={draft.tags}
            onChange={(v) => set({ tags: v })}
            locale={locale}
          />
        </div>
      </SectionCard>

      {sourceLearnings.length > 0 && (
        <SectionCard icon={<ListChecks size={18} />} title={t('dashboard.courses.languages.fields.learnings', 'What learners will learn')}>
          <div className="space-y-4">
            {sourceLearnings.map((item, i) => (
              <SideBySideField
                key={item.id}
                label={
                  <span className="flex items-center gap-1.5">
                    {item.emoji && <span>{item.emoji}</span>}
                    {t('dashboard.courses.languages.fields.learning_item', { n: i + 1, defaultValue: 'Item {{n}}' })}
                  </span>
                }
                source={item.text}
                value={draft.learnings[item.id] || ''}
                onChange={(v) => set({ learnings: { ...draft.learnings, [item.id]: v } })}
                locale={locale}
              />
            ))}
          </div>
        </SectionCard>
      )}

      <StickySaveBar visible={dirty} saving={saving} onSave={onSave} onDiscard={() => setDraft(initial)} />
    </EditorPage>
  )
}
