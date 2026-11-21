'use client'
/*
 "Suggest an edit": edit a few blocks in the light editor, then review the
 change as a diff and add a note before sending it (GitHub's suggested
 changes, Google Docs' suggestion mode). Also used by reviewers for
 "Edit, then accept" and by authors revising a suggestion.
*/
import React from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowsLeftRight, PencilSimpleLine, Rows, Trash } from '@phosphor-icons/react'
import { Button, FieldLabel, Modal, SegmentedControl, TEXTAREA } from '@/design'
import LightEditor, { type LightEditorHandle } from './LightEditor'
import ContributionDiff, { type DiffLayout } from './ContributionDiff'
import { blockConfig, textBlockTypes } from './blockRegistry'
import { isTextOnly, sameBlocks, stripEmptyTail, type JSONNode } from './contributionModel'

const NOTE_MAX = 1000

export type SuggestEditModalProps = {
  open: boolean
  onClose: () => void
  activity: any
  courseUuid?: string
  orgUuid?: string
  /** The page's blocks this edit replaces (empty: adding new blocks). */
  before: JSONNode[]
  /** What the editor starts from (defaults to `before`). */
  initial?: JSONNode[]
  title: string
  submitLabel: string
  /** Shown above the editor: what happens on submit (review, publish). */
  hint?: string
  showNote?: boolean
  initialNote?: string
  onSubmit: (after: JSONNode[], note: string) => Promise<void>
}

export default function SuggestEditModal(props: SuggestEditModalProps) {
  const { t } = useTranslation()
  const { open, onClose, activity, courseUuid, orgUuid, before, title, submitLabel, hint, showNote = true } = props
  const initial = props.initial ?? before
  const [step, setStep] = React.useState<'edit' | 'review'>('edit')
  const [after, setAfter] = React.useState<JSONNode[]>(initial)
  const [note, setNote] = React.useState(props.initialNote ?? '')
  const [layout, setLayout] = React.useState<DiffLayout>('inline')
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const editorRef = React.useRef<LightEditorHandle>(null)

  // Mounted fresh for each edit (callers render it conditionally), so the
  // state above starts clean every time.

  const textMode = before.length === 0 || isTextOnly(before, textBlockTypes())
  const blockLabel = before.length === 1 ? t(`contributions.blocks.${blockConfig(before[0]?.type).label}`) : null
  const cleaned = stripEmptyTail(after)
  const unchanged = sameBlocks(before, cleaned)

  const goReview = () => {
    const latest = editorRef.current?.getBlocks() ?? after
    setAfter(latest)
    setStep('review')
  }

  const submit = async () => {
    setSaving(true)
    setError(null)
    try {
      await props.onSubmit(cleaned, note.trim())
      onClose()
    } catch (e: any) {
      setError(e?.message || t('contributions.errors.generic'))
    } finally {
      setSaving(false)
    }
  }

  const removeAll = () => {
    setAfter([])
    setStep('review')
  }

  const footer =
    step === 'edit' ? (
      <div className="flex w-full flex-wrap items-center justify-between gap-2">
        {before.length > 0 ? (
          <Button size="sm" icon={<Trash size={13} />} onClick={removeAll}>
            {blockLabel ? t('contributions.suggest.remove_block', { block: blockLabel }) : t('contributions.suggest.remove_blocks')}
          </Button>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2">
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={goReview}>
            {t('contributions.suggest.review_changes')}
          </Button>
        </div>
      </div>
    ) : (
      <div className="flex w-full flex-wrap items-center justify-end gap-2">
        <Button onClick={() => setStep('edit')} disabled={saving}>
          {t('contributions.suggest.keep_editing')}
        </Button>
        <Button variant="primary" onClick={submit} loading={saving} disabled={unchanged || (before.length === 0 && cleaned.length === 0)}>
          {submitLabel}
        </Button>
      </div>
    )

  return (
    <Modal
      isDialogOpen={open}
      onOpenChange={(o) => !o && onClose()}
      size="lg"
      icon={<PencilSimpleLine size={18} />}
      onBack={step === 'review' ? () => setStep('edit') : undefined}
      dialogTitle={step === 'edit' ? title : t('contributions.suggest.review_title')}
      dialogDescription={
        step === 'edit'
          ? textMode
            ? t('contributions.suggest.text_hint')
            : t('contributions.suggest.block_hint', { block: blockLabel ?? t('contributions.blocks.block') })
          : t('contributions.suggest.review_hint')
      }
      preventClose={saving}
      closeOnOutsideClick={false}
      footer={footer}
      dialogContent={
        <div className="space-y-4">
          {hint && step === 'edit' && (
            <p className="rounded-xl bg-sky-50 px-3 py-2 text-xs text-sky-800 ring-1 ring-inset ring-sky-600/10">{hint}</p>
          )}
          {step === 'edit' ? (
            <div className="rounded-2xl bg-white p-4 ring-1 ring-inset ring-neutral-200 focus-within:ring-2 focus-within:ring-neutral-900/15">
              <LightEditor
                ref={editorRef}
                key={open ? 'open' : 'closed'}
                blocks={after}
                activity={activity}
                courseUuid={courseUuid}
                orgUuid={orgUuid}
                textMode={textMode}
                onChange={setAfter}
                ariaLabel={title}
              />
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-neutral-900">{t('contributions.diff.title')}</span>
                <SegmentedControl<DiffLayout>
                  value={layout}
                  onChange={setLayout}
                  ariaLabel={t('contributions.diff.title')}
                  options={[
                    { key: 'inline', label: <><Rows size={13} />{t('contributions.diff.inline')}</> },
                    { key: 'split', label: <><ArrowsLeftRight size={13} />{t('contributions.diff.split')}</> },
                  ]}
                />
              </div>
              <div className="max-h-[50vh] overflow-y-auto rounded-2xl bg-neutral-50/70 p-4 ring-1 ring-inset ring-neutral-200">
                <ContributionDiff before={before} after={cleaned} activity={activity} layout={layout} />
              </div>
              {unchanged && <p className="text-xs text-amber-700">{t('contributions.suggest.unchanged')}</p>}
              {showNote && (
                <label className="block">
                  <FieldLabel hint={t('contributions.suggest.note_optional')}>{t('contributions.suggest.note_label')}</FieldLabel>
                  <textarea
                    className={TEXTAREA}
                    rows={3}
                    maxLength={NOTE_MAX}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder={t('contributions.suggest.note_placeholder')}
                  />
                </label>
              )}
              {error && <p className="text-sm font-medium text-rose-600" role="alert">{error}</p>}
            </>
          )}
        </div>
      }
    />
  )
}
