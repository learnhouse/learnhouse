'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import { useQuery } from '@tanstack/react-query'
import { CheckCircle, EyeSlash, GitDiff, Globe, Warning } from '@phosphor-icons/react'
import { useAuth } from '@components/Contexts/AuthContext'
import {
  isRtlLocale,
  localeNativeName,
  setActivityTranslationStatus,
  updateActivityTranslation,
} from '@services/courses/translations'
import { getActivityVersion } from '@services/courses/activities'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import AtlasTranslateButton from '@ee/components/Atlas/Translations/AtlasTranslateButton'
import EditorPreview from '../EditorPreview'
import { wordDiff } from '../Blocks/bubble/selectionTools'
import { useEditorLocale } from './EditorLocaleContext'
import { docPlainText, sourceDiffRange, translationBanner } from './translationEditorModel'
import './translation.css'

/** Read-only source of the page, next to the translation editor. */
export function TranslationSourcePane({ activity }: { activity: any }) {
  const { t } = useTranslation()
  const ctx = useEditorLocale()
  if (!ctx) return null
  const source = ctx.translation.source
  return (
    <aside className="lh-translation-source-pane" aria-label={t('editor.translation.source_label', 'Source')} data-testid="translation-source-pane">
      <div className="lh-translation-pane-label">
        <span>
          {t('editor.translation.source_label', 'Source')} · {localeNativeName(ctx.sourceLocale)}
        </span>
        <span className="lh-translation-readonly">{t('editor.translation.read_only', 'Read only')}</span>
      </div>
      <h2 className="lh-translation-source-title">{source?.name || activity.name}</h2>
      <div className="lh-translation-source" dir={isRtlLocale(ctx.sourceLocale) ? 'rtl' : undefined}>
        {source?.content ? (
          <EditorPreview content={source.content} activity={activity} />
        ) : (
          <p className="text-sm text-neutral-400">{t('editor.translation.no_source', 'The source page is empty.')}</p>
        )}
      </div>
    </aside>
  )
}

/**
 * Above the translation editor: the translated page title, draft/published,
 * and the "source changed" notice with its diff, "mark as up to date" and
 * "retranslate with Atlas".
 */
export function TranslationBar({ activity, course }: { activity: any; course: any }) {
  const { t } = useTranslation()
  const ctx = useEditorLocale()
  const { getAccessToken } = useAuth()
  const [name, setName] = React.useState(ctx?.translation.name || '')
  const [busy, setBusy] = React.useState<'status' | 'uptodate' | null>(null)
  const [diffOpen, setDiffOpen] = React.useState(false)
  const savedName = React.useRef(ctx?.translation.name || '')
  if (!ctx) return null
  const tr = ctx.translation
  const locale = ctx.locale
  const published = tr.status === 'published'
  const dir = isRtlLocale(locale) ? 'rtl' : undefined
  const range = sourceDiffRange(tr)

  const saveName = async () => {
    const next = name.trim()
    if (!next || next === savedName.current) return
    try {
      const token = await getAccessToken()
      await updateActivityTranslation(activity.activity_uuid, locale, { name: next }, token)
      savedName.current = next
      void ctx.refresh()
    } catch (e: any) {
      toast.error(e?.message || t('editor.translation.errors.save', 'Could not save the translation'))
    }
  }

  const toggleStatus = async () => {
    setBusy('status')
    try {
      const token = await getAccessToken()
      await setActivityTranslationStatus(activity.activity_uuid, locale, published ? 'draft' : 'published', token)
      await ctx.refresh()
    } catch (e: any) {
      toast.error(e?.message || t('editor.translation.errors.save', 'Could not save the translation'))
    } finally {
      setBusy(null)
    }
  }

  const markUpToDate = async () => {
    setBusy('uptodate')
    try {
      const token = await getAccessToken()
      // Saving the translation records the current source as its base
      await updateActivityTranslation(activity.activity_uuid, locale, { name: name.trim() || tr.name }, token)
      await ctx.refresh()
      toast.success(t('editor.translation.marked_up_to_date', 'Marked as up to date'))
    } catch (e: any) {
      toast.error(e?.message || t('editor.translation.errors.save', 'Could not save the translation'))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="lh-translation-bar" data-testid="translation-bar">
      <div className="lh-translation-pane-label">
        <span>
          {t('editor.translation.translation_label', 'Translation')} · {localeNativeName(locale)}
        </span>
        <button
          type="button"
          onClick={toggleStatus}
          disabled={busy === 'status'}
          className={`lh-translation-status ${published ? 'is-published' : ''}`}
          title={
            published
              ? t('editor.translation.status.unpublish_hint', 'Published: learners in this language see it. Click to set back to draft.')
              : t('editor.translation.status.publish_hint', 'Draft: only editors see it. Click to publish.')
          }
          data-testid="translation-status-toggle"
        >
          {published ? <Globe size={12} /> : <EyeSlash size={12} />}
          {published ? t('editor.translation.status.published', 'Published') : t('editor.translation.status.draft', 'Draft')}
        </button>
      </div>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={saveName}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        }}
        dir={dir}
        lang={locale}
        placeholder={tr.source?.name || activity.name}
        aria-label={t('editor.translation.title_label', 'Translated page title')}
        className="lh-translation-title"
        data-testid="translation-title"
      />
      {translationBanner(tr) === 'outdated' && (
        <div className="lh-translation-outdated" role="status" data-testid="translation-outdated">
          <Warning size={16} className="shrink-0 mt-0.5" />
          <div className="min-w-0 grow">
            <div className="font-semibold">{t('editor.translation.outdated.title', 'Source changed since this translation')}</div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {range && (
                <button type="button" className="lh-translation-chip" onClick={() => setDiffOpen(true)} data-testid="translation-outdated-diff">
                  <GitDiff size={12} />
                  {t('editor.translation.outdated.view_changes', {
                    from: range.from,
                    to: range.to,
                    defaultValue: 'See changes (v{{from}} → v{{to}})',
                  })}
                </button>
              )}
              <button type="button" className="lh-translation-chip" onClick={markUpToDate} disabled={busy === 'uptodate'} data-testid="translation-mark-up-to-date">
                <CheckCircle size={12} />
                {t('editor.translation.outdated.mark_up_to_date', 'Mark as up to date')}
              </button>
              <AtlasTranslateButton
                courseUuid={course?.course_uuid}
                locales={[locale]}
                scope="activities"
                activityUuids={[activity.activity_uuid]}
                size="sm"
                label={t('editor.translation.outdated.retranslate', 'Retranslate')}
                waitForCompletion
                onDone={() => void ctx.refresh()}
              />
            </div>
          </div>
        </div>
      )}
      {diffOpen && range && (
        <SourceChangesDialog
          activityUuid={activity.activity_uuid}
          from={range.from}
          to={range.to}
          current={tr.source?.content}
          onClose={() => setDiffOpen(false)}
        />
      )}
    </div>
  )
}

/** What changed in the source since the translation was made (text diff of two versions). */
function SourceChangesDialog({
  activityUuid,
  from,
  to,
  current,
  onClose,
}: {
  activityUuid: string
  from: number
  to: number
  current: unknown
  onClose: () => void
}) {
  const { t } = useTranslation()
  const { getAccessToken } = useAuth()
  const { data, isLoading, error } = useQuery({
    queryKey: ['courseI18n', 'sourceVersion', activityUuid, from],
    queryFn: async () => {
      const token = await getAccessToken()
      const v = await getActivityVersion(activityUuid, from, token || '')
      if (!v || v.detail) throw new Error(typeof v?.detail === 'string' ? v.detail : 'not found')
      return v
    },
  })
  const parts = React.useMemo(
    () => (data ? wordDiff(docPlainText(data.content), docPlainText(current)) : []),
    [data, current],
  )
  return (
    <Modal
      isDialogOpen
      onOpenChange={(o) => !o && onClose()}
      size="lg"
      dialogTitle={t('editor.translation.diff.title', 'Changes in the source')}
      dialogDescription={t('editor.translation.diff.description', {
        from,
        to,
        defaultValue: 'Version {{from}} (translated) compared with version {{to}} (now).',
      })}
      dialogContent={
        <div className="max-h-[60vh] overflow-y-auto" data-testid="translation-diff">
          {isLoading && <p className="text-sm text-neutral-400">{t('common.loading', 'Loading…')}</p>}
          {error && <p className="text-sm text-rose-600">{t('editor.translation.diff.error', 'This version is no longer available.')}</p>}
          {data && (
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-neutral-700">
              {parts.map((p, i) =>
                p.kind === 'same' ? (
                  <span key={i}>{p.text}</span>
                ) : p.kind === 'add' ? (
                  <ins key={i} className="no-underline bg-emerald-100 text-emerald-900 rounded-sm">
                    {p.text}
                  </ins>
                ) : (
                  <del key={i} className="bg-rose-100 text-rose-800 rounded-sm">
                    {p.text}
                  </del>
                ),
              )}
              {parts.length === 0 && t('editor.translation.diff.no_text_change', 'No text changed (only formatting or media).')}
            </p>
          )}
        </div>
      }
    />
  )
}

