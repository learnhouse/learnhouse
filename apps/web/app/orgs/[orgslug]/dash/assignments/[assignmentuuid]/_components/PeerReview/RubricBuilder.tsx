'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowDown, ArrowUp, CaretDown, ListChecks, Plus, Sparkle, Trash } from '@phosphor-icons/react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@components/ui/dropdown-menu'
import { Button, ConfirmDialog, EmptyState, INPUT, SectionCard, TEXTAREA } from '@/design'
import type { PeerReviewCriterion, PeerReviewLevel } from '@services/courses/peerReview'
import {
  PEER_REVIEW_LIMITS,
  TEMPLATE_KEYS,
  buildTemplate,
  maxRubricPoints,
  newId,
  type Issue,
  type TemplateKey,
} from '@/lib/assignments/peerReviewRubric'
import { FieldError, issueMessage } from './ui'

// Rubric builder: criteria cards, each with 2–6 levels (label, points,
// description). "Start from a template" fills a ready rubric in one click.

const ICON_BTN =
  'h-7 w-7 inline-flex items-center justify-center rounded-md text-neutral-400 hover:text-neutral-800 hover:bg-neutral-100 disabled:opacity-30 disabled:pointer-events-none transition-colors'

function newLevel(points: number): PeerReviewLevel {
  return { id: newId('l'), points, label: '', description: '' }
}

export function newCriterion(): PeerReviewCriterion {
  return { id: newId('c'), title: '', description: '', levels: [newLevel(2), newLevel(1), newLevel(0)] }
}

export function TemplateMenu({ onPick, disabled }: { onPick: (_key: TemplateKey) => void; disabled?: boolean }) {
  const { t } = useTranslation()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <Button size='sm' icon={<Sparkle size={14} />}>
          {t('peer_review.instructor.rubric.template')}
          <CaretDown size={12} className='text-neutral-400' />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end' className='w-72 rounded-xl'>
        {TEMPLATE_KEYS.map((key) => (
          <DropdownMenuItem key={key} onSelect={() => onPick(key)} className='flex flex-col items-start gap-0.5 cursor-pointer py-2'>
            <span className='text-sm font-semibold text-neutral-900'>{t(`peer_review.instructor.templates.${key}.name`)}</span>
            <span className='text-xs text-neutral-500'>{t(`peer_review.instructor.templates.${key}.blurb`)}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default function RubricBuilder({
  rubric,
  onChange,
  issues,
  showErrors,
}: {
  rubric: PeerReviewCriterion[]
  onChange: (_next: PeerReviewCriterion[]) => void
  issues: Issue[]
  showErrors: boolean
}) {
  const { t } = useTranslation()
  const [pendingTemplate, setPendingTemplate] = React.useState<TemplateKey | null>(null)
  const L = PEER_REVIEW_LIMITS

  const applyTemplate = (key: TemplateKey) => onChange(buildTemplate(key, (k) => t(k)))
  const pickTemplate = (key: TemplateKey) => {
    // Replacing a rubric someone already wrote asks first.
    if (rubric.length > 0) setPendingTemplate(key)
    else applyTemplate(key)
  }

  const updateCriterion = (ci: number, patch: Partial<PeerReviewCriterion>) =>
    onChange(rubric.map((c, i) => (i === ci ? { ...c, ...patch } : c)))
  const updateLevel = (ci: number, li: number, patch: Partial<PeerReviewLevel>) =>
    updateCriterion(ci, { levels: rubric[ci].levels.map((l, i) => (i === li ? { ...l, ...patch } : l)) })
  const move = (ci: number, delta: number) => {
    const next = [...rubric]
    const target = ci + delta
    if (target < 0 || target >= next.length) return
    ;[next[ci], next[target]] = [next[target], next[ci]]
    onChange(next)
  }

  const errorsFor = (pred: (_issue: Issue) => boolean) => (showErrors ? issues.filter(pred).map((i) => issueMessage(t, i)) : [])
  const rubricErrors = errorsFor((i) => i.criterion === undefined && (i.code === 'criteria_min' || i.code === 'criteria_max'))
  const total = maxRubricPoints(rubric)

  return (
    <SectionCard
      icon={<ListChecks size={18} />}
      title={t('peer_review.instructor.rubric.title')}
      description={t('peer_review.instructor.rubric.description')}
      actions={<TemplateMenu onPick={pickTemplate} />}
      bodyClassName='p-5 flex flex-col gap-4'
    >
      {rubric.length === 0 ? (
        <div className='rounded-xl border border-dashed border-neutral-200'>
          <EmptyState
            icon={<ListChecks size={22} />}
            title={t('peer_review.instructor.rubric.empty_title')}
            description={t('peer_review.instructor.rubric.empty_description')}
            action={
              <div className='flex flex-wrap justify-center gap-2'>
                <TemplateMenu onPick={pickTemplate} />
                <Button size='sm' icon={<Plus size={14} />} onClick={() => onChange([newCriterion()])}>
                  {t('peer_review.instructor.rubric.add_criterion')}
                </Button>
              </div>
            }
          />
          {rubricErrors.length > 0 && <div className='px-5 pb-4 text-center'><FieldError>{rubricErrors[0]}</FieldError></div>}
        </div>
      ) : (
        <>
          {rubric.map((criterion, ci) => {
            const cErrors = errorsFor((i) => i.criterion === ci && i.level === undefined)
            const levelErrors = (li: number) => errorsFor((i) => i.criterion === ci && i.level === li)
            const best = Math.max(0, ...criterion.levels.map((l) => Number(l.points) || 0))
            return (
              <article key={criterion.id} className='rounded-xl ring-1 ring-inset ring-neutral-200 bg-neutral-50/40 p-4 flex flex-col gap-3'>
                <div className='flex items-start gap-2'>
                  <span className='mt-1.5 w-6 h-6 rounded-lg bg-white ring-1 ring-inset ring-neutral-200 text-xs font-bold text-neutral-500 flex items-center justify-center shrink-0 tabular-nums'>
                    {ci + 1}
                  </span>
                  <div className='flex-1 min-w-0 flex flex-col gap-2'>
                    <input
                      value={criterion.title}
                      onChange={(e) => updateCriterion(ci, { title: e.target.value })}
                      maxLength={200}
                      placeholder={t('peer_review.instructor.rubric.criterion_title_placeholder')}
                      aria-label={t('peer_review.instructor.rubric.criterion_title')}
                      className={`${INPUT} font-semibold`}
                    />
                    <textarea
                      rows={2}
                      value={criterion.description || ''}
                      onChange={(e) => updateCriterion(ci, { description: e.target.value })}
                      placeholder={t('peer_review.instructor.rubric.criterion_description_placeholder')}
                      aria-label={t('peer_review.instructor.rubric.criterion_description')}
                      className={TEXTAREA}
                    />
                  </div>
                  <div className='flex items-center gap-0.5 shrink-0'>
                    <button type='button' className={ICON_BTN} onClick={() => move(ci, -1)} disabled={ci === 0} aria-label={t('peer_review.instructor.rubric.move_up')} title={t('peer_review.instructor.rubric.move_up')}>
                      <ArrowUp size={14} />
                    </button>
                    <button type='button' className={ICON_BTN} onClick={() => move(ci, 1)} disabled={ci === rubric.length - 1} aria-label={t('peer_review.instructor.rubric.move_down')} title={t('peer_review.instructor.rubric.move_down')}>
                      <ArrowDown size={14} />
                    </button>
                    <button
                      type='button'
                      className={`${ICON_BTN} hover:text-rose-600 hover:bg-rose-50`}
                      onClick={() => onChange(rubric.filter((_, i) => i !== ci))}
                      aria-label={t('peer_review.instructor.rubric.remove_criterion')}
                      title={t('peer_review.instructor.rubric.remove_criterion')}
                    >
                      <Trash size={14} />
                    </button>
                  </div>
                </div>
                {cErrors.map((msg) => <FieldError key={msg}>{msg}</FieldError>)}

                <div className='flex flex-col gap-2'>
                  <div className='hidden sm:grid grid-cols-[minmax(0,10rem)_5rem_minmax(0,1fr)_1.75rem] gap-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-400'>
                    <span>{t('peer_review.instructor.rubric.level_label')}</span>
                    <span>{t('peer_review.instructor.rubric.points')}</span>
                    <span>{t('peer_review.instructor.rubric.level_description')}</span>
                    <span />
                  </div>
                  {criterion.levels.map((level, li) => (
                    <div key={level.id}>
                      <div className='grid grid-cols-[minmax(0,1fr)_5rem_1.75rem] sm:grid-cols-[minmax(0,10rem)_5rem_minmax(0,1fr)_1.75rem] gap-2 items-start'>
                        <input
                          value={level.label}
                          onChange={(e) => updateLevel(ci, li, { label: e.target.value })}
                      maxLength={200}
                          placeholder={t('peer_review.instructor.rubric.level_label_placeholder')}
                          aria-label={t('peer_review.instructor.rubric.level_label')}
                          className={INPUT}
                        />
                        <input
                          type='number'
                          min={0}
                          max={1000}
                          step={1}
                          inputMode='numeric'
                          value={Number.isFinite(level.points) ? level.points : ''}
                          onChange={(e) => updateLevel(ci, li, { points: e.target.value === '' ? NaN : Number(e.target.value) })}
                          aria-label={t('peer_review.instructor.rubric.points')}
                          className={`${INPUT} tabular-nums ${Number(level.points) === best && best > 0 ? 'font-semibold' : ''}`}
                        />
                        <input
                          value={level.description || ''}
                          onChange={(e) => updateLevel(ci, li, { description: e.target.value })}
                          placeholder={t('peer_review.instructor.rubric.level_description_placeholder')}
                          aria-label={t('peer_review.instructor.rubric.level_description')}
                          className={`${INPUT} col-span-2 sm:col-span-1 order-last sm:order-none`}
                        />
                        <button
                          type='button'
                          className={`${ICON_BTN} mt-1 hover:text-rose-600 hover:bg-rose-50`}
                          onClick={() => updateCriterion(ci, { levels: criterion.levels.filter((_, i) => i !== li) })}
                          disabled={criterion.levels.length <= L.levelsMin}
                          aria-label={t('peer_review.instructor.rubric.remove_level')}
                          title={t('peer_review.instructor.rubric.remove_level')}
                        >
                          <Trash size={13} />
                        </button>
                      </div>
                      {levelErrors(li).slice(0, 1).map((msg) => <FieldError key={msg}>{msg}</FieldError>)}
                    </div>
                  ))}
                  <div className='flex flex-wrap items-center justify-between gap-2'>
                    <Button
                      variant='ghost'
                      size='sm'
                      icon={<Plus size={13} />}
                      disabled={criterion.levels.length >= L.levelsMax}
                      onClick={() => updateCriterion(ci, { levels: [...criterion.levels, newLevel(0)] })}
                    >
                      {t('peer_review.instructor.rubric.add_level')}
                    </Button>
                    <span className='text-xs text-neutral-400 tabular-nums'>{t('peer_review.instructor.rubric.max_points', { points: best })}</span>
                  </div>
                </div>
              </article>
            )
          })}
          {rubricErrors.map((msg) => <FieldError key={msg}>{msg}</FieldError>)}
          <div className='flex flex-wrap items-center justify-between gap-2'>
            <Button size='sm' icon={<Plus size={14} />} disabled={rubric.length >= L.criteriaMax} onClick={() => onChange([...rubric, newCriterion()])}>
              {t('peer_review.instructor.rubric.add_criterion')}
            </Button>
            <span className='text-xs text-neutral-500 tabular-nums'>
              {t('peer_review.instructor.rubric.summary', { criteria: rubric.length, points: total })}
            </span>
          </div>
        </>
      )}

      <ConfirmDialog
        open={pendingTemplate !== null}
        onOpenChange={(open) => !open && setPendingTemplate(null)}
        title={t('peer_review.instructor.rubric.replace_title')}
        message={t('peer_review.instructor.rubric.replace_message')}
        confirmLabel={t('peer_review.instructor.rubric.replace_confirm')}
        tone='info'
        onConfirm={() => {
          if (pendingTemplate) applyTemplate(pendingTemplate)
        }}
      />
    </SectionCard>
  )
}
