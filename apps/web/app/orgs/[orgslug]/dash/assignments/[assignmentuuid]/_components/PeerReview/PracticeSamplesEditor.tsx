'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Target, Trash } from '@phosphor-icons/react'
import { Button, FieldLabel, INPUT, SectionCard, TEXTAREA } from '@/design'
import type { PeerReviewCalibrationSample, PeerReviewCriterion } from '@services/courses/peerReview'
import { newId, type Issue } from '@/lib/assignments/peerReviewRubric'
import { FieldError, issueMessage } from './ui'

// Practice samples for the practice round: a sample answer, the level the
// instructor would give on each criterion, and why. Learners score it, then
// see their levels next to these.

const MAX_SAMPLES = 5

export default function PracticeSamplesEditor({
  samples,
  rubric,
  practiceEnabled,
  onChange,
  issues,
  showErrors,
}: {
  samples: PeerReviewCalibrationSample[]
  rubric: PeerReviewCriterion[]
  practiceEnabled: boolean
  onChange: (_next: PeerReviewCalibrationSample[]) => void
  issues: Issue[]
  showErrors: boolean
}) {
  const { t } = useTranslation()
  const update = (si: number, patch: Partial<PeerReviewCalibrationSample>) => onChange(samples.map((s, i) => (i === si ? { ...s, ...patch } : s)))
  const add = () => onChange([...samples, { id: newId('s'), title: '', content: '', scores: {}, explanation: '' }])

  return (
    <SectionCard
      icon={<Target size={18} />}
      title={t('peer_review.instructor.samples.title')}
      description={t('peer_review.instructor.samples.description')}
      bodyClassName='p-5 flex flex-col gap-4'
    >
      {!practiceEnabled && (
        <p className='rounded-xl bg-neutral-50 px-3 py-2 text-xs text-neutral-500'>{t('peer_review.instructor.samples.practice_off')}</p>
      )}
      {practiceEnabled && samples.length === 0 && (
        <p className='rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800'>{t('peer_review.instructor.samples.none_yet')}</p>
      )}
      {rubric.length === 0 && samples.length > 0 && (
        <p className='rounded-xl bg-neutral-50 px-3 py-2 text-xs text-neutral-500'>{t('peer_review.instructor.samples.needs_rubric')}</p>
      )}

      {samples.map((sample, si) => {
        const errors = showErrors ? issues.filter((i) => i.sample === si) : []
        const err = (code: Issue['code']) => {
          const hit = errors.find((i) => i.code === code)
          return hit ? issueMessage(t, hit) : undefined
        }
        return (
          <article key={sample.id} className='rounded-xl ring-1 ring-inset ring-neutral-200 bg-neutral-50/40 p-4 flex flex-col gap-3'>
            <div className='flex items-start gap-2'>
              <label className='flex-1 min-w-0'>
                <FieldLabel error={err('sample_title')}>{t('peer_review.instructor.samples.sample_title')}</FieldLabel>
                <input
                  value={sample.title}
                  onChange={(e) => update(si, { title: e.target.value })}
                      maxLength={200}
                  placeholder={t('peer_review.instructor.samples.sample_title_placeholder')}
                  className={INPUT}
                />
              </label>
              <button
                type='button'
                onClick={() => onChange(samples.filter((_, i) => i !== si))}
                aria-label={t('peer_review.instructor.samples.remove')}
                title={t('peer_review.instructor.samples.remove')}
                className='mt-7 h-7 w-7 inline-flex items-center justify-center rounded-md text-neutral-400 hover:text-rose-600 hover:bg-rose-50'
              >
                <Trash size={14} />
              </button>
            </div>
            <label className='block'>
              <FieldLabel error={err('sample_content')} hint={t('peer_review.instructor.samples.content_hint')}>
                {t('peer_review.instructor.samples.content')}
              </FieldLabel>
              <textarea
                rows={6}
                value={sample.content}
                onChange={(e) => update(si, { content: e.target.value })}
                placeholder={t('peer_review.instructor.samples.content_placeholder')}
                className={`${TEXTAREA} resize-y font-mono text-[13px]`}
              />
            </label>

            {rubric.length > 0 && (
              <div>
                <FieldLabel error={err('sample_levels')} hint={t('peer_review.instructor.samples.levels_hint')}>
                  {t('peer_review.instructor.samples.levels')}
                </FieldLabel>
                <div className='grid grid-cols-1 sm:grid-cols-2 gap-2'>
                  {rubric.map((criterion) => (
                    <label key={criterion.id} className='flex flex-col gap-1 min-w-0'>
                      <span className='text-xs font-medium text-neutral-600 truncate'>
                        {criterion.title || t('peer_review.instructor.rubric.untitled_criterion')}
                      </span>
                      <select
                        value={criterion.levels.some((l) => l.id === sample.scores?.[criterion.id]) ? sample.scores?.[criterion.id] : ''}
                        onChange={(e) => update(si, { scores: { ...(sample.scores || {}), [criterion.id]: e.target.value } })}
                        className={`${INPUT} cursor-pointer`}
                      >
                        <option value='' disabled>
                          {t('peer_review.instructor.samples.pick_level')}
                        </option>
                        {criterion.levels.map((level) => (
                          <option key={level.id} value={level.id}>
                            {`${level.label || '…'} · ${t('peer_review.common.points_short', { count: Number(level.points) || 0 })}`}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
              </div>
            )}

            <label className='block'>
              <FieldLabel hint={t('peer_review.instructor.samples.explanation_hint')}>{t('peer_review.instructor.samples.explanation')}</FieldLabel>
              <textarea
                rows={3}
                value={sample.explanation || ''}
                onChange={(e) => update(si, { explanation: e.target.value })}
                placeholder={t('peer_review.instructor.samples.explanation_placeholder')}
                className={TEXTAREA}
              />
            </label>
            {errors.length > 0 && !err('sample_title') && !err('sample_content') && !err('sample_levels') && (
              <FieldError>{issueMessage(t, errors[0])}</FieldError>
            )}
          </article>
        )
      })}

      <div className='flex flex-wrap items-center justify-between gap-2'>
        <Button size='sm' icon={<Plus size={14} />} onClick={add} disabled={samples.length >= MAX_SAMPLES}>
          {t('peer_review.instructor.samples.add')}
        </Button>
        <span className='text-xs text-neutral-400'>{t('peer_review.instructor.samples.count_hint')}</span>
      </div>
    </SectionCard>
  )
}
