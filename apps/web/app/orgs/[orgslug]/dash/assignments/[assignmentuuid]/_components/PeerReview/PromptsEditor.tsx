'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowCounterClockwise, ChatText, Plus, Trash } from '@phosphor-icons/react'
import { Button, INPUT, SectionCard } from '@/design'
import type { PeerReviewPrompt } from '@services/courses/peerReview'
import { PEER_REVIEW_LIMITS, newId, type Issue } from '@/lib/assignments/peerReviewRubric'
import { FieldError, issueMessage } from './ui'

// The comment boxes a reviewer fills in, each with a minimum length so a
// review can't be a one-word "nice".

export default function PromptsEditor({
  prompts,
  onChange,
  onReset,
  isDefault,
  issues,
  showErrors,
}: {
  prompts: PeerReviewPrompt[]
  onChange: (_next: PeerReviewPrompt[]) => void
  onReset: () => void
  isDefault: boolean
  issues: Issue[]
  showErrors: boolean
}) {
  const { t } = useTranslation()
  const L = PEER_REVIEW_LIMITS
  const update = (pi: number, patch: Partial<PeerReviewPrompt>) => onChange(prompts.map((p, i) => (i === pi ? { ...p, ...patch } : p)))
  const listErrors = showErrors ? issues.filter((i) => i.prompt === undefined && (i.code === 'prompts_min' || i.code === 'prompts_max')) : []

  return (
    <SectionCard
      icon={<ChatText size={18} />}
      title={t('peer_review.instructor.prompts.title')}
      description={t('peer_review.instructor.prompts.description')}
      actions={
        !isDefault ? (
          <Button variant='ghost' size='sm' icon={<ArrowCounterClockwise size={13} />} onClick={onReset}>
            {t('peer_review.instructor.prompts.reset')}
          </Button>
        ) : undefined
      }
      bodyClassName='p-5 flex flex-col gap-3'
    >
      <div className='hidden sm:grid grid-cols-[minmax(0,1fr)_7rem_1.75rem] gap-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-400'>
        <span>{t('peer_review.instructor.prompts.label')}</span>
        <span>{t('peer_review.instructor.prompts.min_chars')}</span>
        <span />
      </div>
      {prompts.map((prompt, pi) => {
        const errors = showErrors ? issues.filter((i) => i.prompt === pi) : []
        return (
          <div key={prompt.key}>
            <div className='grid grid-cols-[minmax(0,1fr)_7rem_1.75rem] gap-2 items-center'>
              <input
                value={prompt.label}
                onChange={(e) => update(pi, { label: e.target.value })}
                      maxLength={200}
                placeholder={t('peer_review.instructor.prompts.label_placeholder')}
                aria-label={t('peer_review.instructor.prompts.label')}
                className={INPUT}
              />
              <input
                type='number'
                min={0}
                max={L.minCharsMax}
                inputMode='numeric'
                value={Number.isFinite(prompt.min_chars) ? prompt.min_chars : ''}
                onChange={(e) => update(pi, { min_chars: e.target.value === '' ? NaN : Math.round(Number(e.target.value)) })}
                aria-label={t('peer_review.instructor.prompts.min_chars')}
                className={`${INPUT} tabular-nums`}
              />
              <button
                type='button'
                onClick={() => onChange(prompts.filter((_, i) => i !== pi))}
                disabled={prompts.length <= L.promptsMin}
                aria-label={t('peer_review.instructor.prompts.remove')}
                title={t('peer_review.instructor.prompts.remove')}
                className='h-7 w-7 inline-flex items-center justify-center rounded-md text-neutral-400 hover:text-rose-600 hover:bg-rose-50 disabled:opacity-30 disabled:pointer-events-none'
              >
                <Trash size={13} />
              </button>
            </div>
            {errors.slice(0, 1).map((issue) => <FieldError key={issue.code}>{issueMessage(t, issue)}</FieldError>)}
          </div>
        )
      })}
      {listErrors.map((issue) => <FieldError key={issue.code}>{issueMessage(t, issue)}</FieldError>)}
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <Button
          size='sm'
          icon={<Plus size={14} />}
          disabled={prompts.length >= L.promptsMax}
          onClick={() => onChange([...prompts, { key: newId('p'), label: '', min_chars: 0 }])}
        >
          {t('peer_review.instructor.prompts.add')}
        </Button>
        <span className='text-xs text-neutral-400'>{t('peer_review.instructor.prompts.min_chars_hint')}</span>
      </div>
    </SectionCard>
  )
}
