'use client'
import React, { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import { MagnifyingGlass, Plus, Question, ShareNetwork, X } from '@phosphor-icons/react'
import { useCourse } from '@components/Contexts/CourseContext'
import { Button, SectionCard, StickySaveBar } from '@components/Dashboard/Shared/DashKit/DashKit'
import { AtlasLocalizeSeoButton } from '@ee/components/Atlas/Translations/AtlasTranslateButton'
import { EditorPage, EditorSkeleton, ErrorNotice } from '../courseEditorUi'
import { SideBySideField, SideBySideHeader } from './SideBySide'
import { cleanTranslatedSeo, type TranslatableSeoKey } from './courseLanguagesModel'
import { useCourseTranslation } from './useCourseTranslation'
import { useCourseLanguages } from './useCourseLanguages'

type Faq = { question: string; answer: string }
type Draft = { seo: Partial<Record<TranslatableSeoKey, string>>; faq: Faq[]; slug: string }

const SEARCH_KEYS: TranslatableSeoKey[] = ['title', 'description', 'keywords', 'image_alt']
const SOCIAL_KEYS: TranslatableSeoKey[] = ['og_title', 'og_description', 'twitter_title', 'twitter_description']
const AUDIENCE_KEYS: TranslatableSeoKey[] = ['audience', 'prerequisites']
const MULTILINE = new Set<TranslatableSeoKey>(['description', 'og_description', 'twitter_description', 'prerequisites'])

/**
 * Course editor → SEO tab in translation mode: the localized SEO texts (the
 * `seo` object of the course translation) and the localized URL slug, side by
 * side with the source. Settings that are not text (robots, images, JSON-LD)
 * are shared with the source and edited there.
 */
export default function TranslateCourseSEO({ locale }: { locale: string }) {
  const { t } = useTranslation()
  const course = useCourse() as any
  const courseUuid: string | undefined = course?.courseStructure?.course_uuid
  const { data: overview } = useCourseLanguages(courseUuid)
  const { data, isLoading, error, save, refetch } = useCourseTranslation(courseUuid, locale)
  const sourceLocale = overview?.default_locale || 'en'
  const sourceSeo: Record<string, any> = data?.source?.seo || {}

  const initial = useMemo<Draft | null>(() => {
    if (!data) return null
    const seo: Draft['seo'] = {}
    const s = data.seo || {}
    for (const key of [...SEARCH_KEYS, ...SOCIAL_KEYS, ...AUDIENCE_KEYS]) seo[key] = typeof s[key] === 'string' ? s[key] : ''
    const sourceFaq: Faq[] = Array.isArray(sourceSeo.faq) ? sourceSeo.faq : []
    const faq: Faq[] = Array.isArray(s.faq) ? s.faq : []
    // One translated pair per source pair, then any extra ones
    const rows = Math.max(sourceFaq.length, faq.length)
    return {
      seo,
      faq: Array.from({ length: rows }, (_, i) => ({ question: faq[i]?.question || '', answer: faq[i]?.answer || '' })),
      slug: data.slug || '',
    }
    // sourceSeo derives from data
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])
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
        <EditorSkeleton sections={3} />
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
  const setSeo = (key: TranslatableSeoKey, v: string) => setDraft({ ...draft, seo: { ...draft.seo, [key]: v } })
  const sourceFaq: Faq[] = Array.isArray(sourceSeo.faq) ? sourceSeo.faq : []

  const label = (key: TranslatableSeoKey) =>
    ({
      title: t('dashboard.courses.languages.seo.fields.title', 'Search title'),
      description: t('dashboard.courses.languages.seo.fields.description', 'Search description'),
      keywords: t('dashboard.courses.languages.seo.fields.keywords', 'Keywords'),
      image_alt: t('dashboard.courses.languages.seo.fields.image_alt', 'Image description'),
      og_title: t('dashboard.courses.languages.seo.fields.og_title', 'Social title'),
      og_description: t('dashboard.courses.languages.seo.fields.og_description', 'Social description'),
      twitter_title: t('dashboard.courses.languages.seo.fields.twitter_title', 'X / Twitter title'),
      twitter_description: t('dashboard.courses.languages.seo.fields.twitter_description', 'X / Twitter description'),
      audience: t('dashboard.courses.languages.seo.fields.audience', 'Audience'),
      prerequisites: t('dashboard.courses.languages.seo.fields.prerequisites', 'Prerequisites'),
    })[key]

  const fields = (keys: TranslatableSeoKey[]) =>
    keys.map((key) => (
      <SideBySideField
        key={key}
        label={label(key)}
        source={typeof sourceSeo[key] === 'string' ? sourceSeo[key] : ''}
        value={draft.seo[key] || ''}
        onChange={(v) => setSeo(key, v)}
        locale={locale}
        multiline={MULTILINE.has(key)}
        rows={2}
        testId={`translate-seo-${key}`}
      />
    ))

  const onSave = async () => {
    setSaving(true)
    try {
      // Keep any non-text keys the translation already had (Atlas may set some)
      const seo = { ...(data.seo || {}), ...cleanTranslatedSeo({ ...draft.seo, faq: draft.faq }) }
      for (const key of Object.keys(draft.seo) as TranslatableSeoKey[]) if (!draft.seo[key]?.trim()) delete seo[key]
      if (!draft.faq.some((f) => f.question.trim() || f.answer.trim())) delete seo.faq
      await save({ seo, slug: draft.slug.trim() || null })
      toast.success(t('dashboard.courses.languages.toasts.saved', 'Translation saved'))
    } catch (e: any) {
      toast.error(e?.message || t('dashboard.courses.languages.toasts.error', 'Something went wrong'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <EditorPage width="wide">
      <SectionCard
        icon={<MagnifyingGlass size={18} />}
        title={t('dashboard.courses.languages.seo.search', 'Search engines')}
        description={t(
          'dashboard.courses.languages.seo.description',
          'How this language version shows in search results. Robots, images and structured data settings are shared with the source.',
        )}
        actions={courseUuid ? <AtlasLocalizeSeoButton courseUuid={courseUuid} locale={locale} size="sm" onDone={() => refetch()} /> : undefined}
      >
        <div className="space-y-5" data-testid="translate-seo">
          <SideBySideHeader source={sourceLocale} locale={locale} />
          {fields(SEARCH_KEYS)}
          <SideBySideField
            label={t('dashboard.courses.languages.seo.fields.slug', 'URL slug')}
            source={course?.courseStructure?.slug || ''}
            value={draft.slug}
            onChange={(v) => setDraft({ ...draft, slug: v.toLowerCase().replace(/\s+/g, '-') })}
            locale={locale}
            placeholder={t('dashboard.courses.languages.seo.slug_placeholder', 'Optional, e.g. cours-de-francais')}
            optional
          />
        </div>
      </SectionCard>

      <SectionCard icon={<ShareNetwork size={18} />} title={t('dashboard.courses.languages.seo.social', 'Social sharing')}>
        <div className="space-y-5">{fields(SOCIAL_KEYS)}</div>
      </SectionCard>

      <SectionCard icon={<Question size={18} />} title={t('dashboard.courses.languages.seo.audience_faq', 'Audience & FAQ')}>
        <div className="space-y-5">
          {fields(AUDIENCE_KEYS)}
          {draft.faq.map((f, i) => (
            <div key={i} className="rounded-xl ring-1 ring-inset ring-neutral-100 p-3 space-y-3 relative">
              {i >= sourceFaq.length && (
                <button
                  type="button"
                  aria-label={t('dashboard.courses.languages.seo.remove_faq', 'Remove question')}
                  onClick={() => setDraft({ ...draft, faq: draft.faq.filter((_, j) => j !== i) })}
                  className="absolute top-2 end-2 w-7 h-7 rounded-lg flex items-center justify-center text-neutral-400 hover:text-rose-600 hover:bg-rose-50"
                >
                  <X size={13} />
                </button>
              )}
              <SideBySideField
                label={t('dashboard.courses.languages.seo.faq_question', { n: i + 1, defaultValue: 'Question {{n}}' })}
                source={sourceFaq[i]?.question || ''}
                value={f.question}
                onChange={(v) => setDraft({ ...draft, faq: draft.faq.map((x, j) => (j === i ? { ...x, question: v } : x)) })}
                locale={locale}
              />
              <SideBySideField
                label={t('dashboard.courses.languages.seo.faq_answer', 'Answer')}
                source={sourceFaq[i]?.answer || ''}
                value={f.answer}
                onChange={(v) => setDraft({ ...draft, faq: draft.faq.map((x, j) => (j === i ? { ...x, answer: v } : x)) })}
                locale={locale}
                multiline
                rows={2}
              />
            </div>
          ))}
          <Button size="sm" icon={<Plus size={12} />} onClick={() => setDraft({ ...draft, faq: [...draft.faq, { question: '', answer: '' }] })}>
            {t('dashboard.courses.languages.seo.add_faq', 'Add question')}
          </Button>
        </div>
      </SectionCard>

      <StickySaveBar visible={dirty} saving={saving} onSave={onSave} onDiscard={() => setDraft(initial)} />
    </EditorPage>
  )
}
