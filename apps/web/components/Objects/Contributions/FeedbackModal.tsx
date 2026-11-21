'use client'
/*
 "Give feedback" on a passage or block: pick what's wrong (typo, unclear,
 outdated, wrong, suggestion), say why, send. The course team answers in the
 same thread; the learner sees replies under "Your contributions".
*/
import React from 'react'
import { useTranslation } from 'react-i18next'
import { ChatCircleText, Clock, Lightbulb, Question, TextAa, WarningOctagon } from '@phosphor-icons/react'
import { Button, FieldLabel, Modal, TEXTAREA } from '@/design'
import { FEEDBACK_TYPES, type FeedbackType } from '@services/courses/contributions'

const BODY_MAX = 5000

export const FEEDBACK_ICONS: Record<FeedbackType, React.ElementType> = {
  typo: TextAa,
  unclear: Question,
  outdated: Clock,
  wrong: WarningOctagon,
  suggestion: Lightbulb,
}

export const FEEDBACK_TONES: Record<FeedbackType, string> = {
  typo: 'bg-sky-50 text-sky-700 ring-sky-600/15',
  unclear: 'bg-amber-50 text-amber-800 ring-amber-600/15',
  outdated: 'bg-neutral-100 text-neutral-700 ring-neutral-900/10',
  wrong: 'bg-rose-50 text-rose-700 ring-rose-600/15',
  suggestion: 'bg-emerald-50 text-emerald-800 ring-emerald-600/15',
}

export default function FeedbackModal({
  open,
  onClose,
  quote,
  onSubmit,
}: {
  open: boolean
  onClose: () => void
  quote: string
  onSubmit: (type: FeedbackType, body: string) => Promise<void>
}) {
  const { t } = useTranslation()
  const [type, setType] = React.useState<FeedbackType | null>(null)
  const [body, setBody] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const submit = async () => {
    if (!type || !body.trim()) return
    setSaving(true)
    setError(null)
    try {
      await onSubmit(type, body.trim())
      onClose()
    } catch (e: any) {
      setError(e?.message || t('contributions.errors.generic'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      isDialogOpen={open}
      onOpenChange={(o) => !o && onClose()}
      size="md"
      icon={<ChatCircleText size={18} />}
      dialogTitle={t('contributions.feedback.title')}
      dialogDescription={t('contributions.feedback.description')}
      preventClose={saving}
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button onClick={onClose} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" onClick={submit} loading={saving} disabled={!type || !body.trim()}>
            {t('contributions.feedback.send')}
          </Button>
        </div>
      }
      dialogContent={
        <div className="space-y-4">
          {quote && (
            <blockquote className="line-clamp-4 border-s-2 border-neutral-300 ps-3 text-sm italic text-neutral-600">{quote}</blockquote>
          )}
          <div>
            <FieldLabel>{t('contributions.feedback.type_label')}</FieldLabel>
            <div role="radiogroup" aria-label={t('contributions.feedback.type_label')} className="flex flex-wrap gap-2">
              {FEEDBACK_TYPES.map((key) => {
                const Icon = FEEDBACK_ICONS[key]
                const selected = type === key
                return (
                  <button
                    key={key}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setType(key)}
                    className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ring-inset transition-all active:scale-[0.98] ${
                      selected ? `${FEEDBACK_TONES[key]} ring-2` : 'bg-white text-neutral-600 ring-neutral-200 hover:ring-neutral-300'
                    }`}
                  >
                    <Icon size={14} weight={selected ? 'fill' : 'regular'} />
                    {t(`contributions.feedback.types.${key}`)}
                  </button>
                )
              })}
            </div>
          </div>
          <label className="block">
            <FieldLabel>{t('contributions.feedback.body_label')}</FieldLabel>
            <textarea
              className={TEXTAREA}
              rows={4}
              maxLength={BODY_MAX}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={t(`contributions.feedback.placeholders.${type ?? 'suggestion'}`)}
            />
          </label>
          {error && (
            <p className="text-sm font-medium text-rose-600" role="alert">
              {error}
            </p>
          )}
        </div>
      }
    />
  )
}
