'use client'
/*
 One step, edited in place on the learner's story card: the step counter,
 an optional image, the text, and the choice buttons, all editable where
 they sit. Under each choice a small "Then…" pill: Next step, Go to <step>,
 New step, End the story ✓ / ~ / ✗ (and Remove). A step with no choices
 ends the story; its tone is picked the same way.

 Feedback (per choice) and the ending title only show while that row has
 focus, or once they hold text. Text commits after a pause / on blur
 (InlineText / DraftText); selects and menu items commit at once.
*/
import React from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowDown, ArrowRight, ArrowUp, ChatCircleText, DotsThree, Flag, Image as ImageIcon, Trash, Warning, X } from '@phosphor-icons/react'
import DraftText from '../../Blocks/ui/DraftText'
import { BlockPopover, CommitInput, FIELD_CLASS, SettingsField } from '../../Blocks/ui/BlockChrome'
import { cn } from '@/lib/utils'
import { AddGhost, EDIT_OBJECT, InlineText, RemoveX } from '../Experiences/shared'
import {
  MAX_CHOICES,
  MAX_STEPS,
  OUTCOMES,
  type Outcome,
  type ScenarioData,
  type ScenarioIssue,
  type ScenarioStep,
  type ThenValue,
  addChoice,
  applyThen,
  choiceLetter,
  deleteChoice,
  deleteStep,
  followingStep,
  isEnding,
  moveStep,
  setChoiceFeedback,
  setStepEnding,
  stepById,
  stepIndex,
  stepTitle,
  thenOf,
  updateChoice,
  updateStep,
} from './scenarioModel'

export type Commit = (_fn: (_d: ScenarioData) => ScenarioData) => void

export const TONE_MARK: Record<Outcome, string> = { success: '✓', neutral: '~', fail: '✗' }

/** Short labels for inline chips (and the map's tooltips). */
export function useIssueText() {
  const { t } = useTranslation()
  return (issue: ScenarioIssue, data: ScenarioData) => {
    const step = stepById(data, issue.stepId)
    const letter = step && issue.choiceId ? choiceLetter(step.options.findIndex((o) => o.id === issue.choiceId)) : ''
    switch (issue.code) {
      case 'unreachable':
        return t('editor.experiences.scenarios.chip_unreachable', 'Nobody reaches this step')
      case 'dead_end':
        return t('editor.experiences.scenarios.chip_no_way_out', 'No way out')
      case 'broken_link':
        return t('editor.blocks_v2.scenarios.issues.broken_link', { letter, defaultValue: 'Choice {{letter}} points to a step that was deleted.' })
      case 'empty_text':
        return t('editor.experiences.scenarios.chip_empty_text', 'No text yet')
      case 'empty_choice':
        return t('editor.blocks_v2.scenarios.issues.empty_choice', { letter, defaultValue: 'Choice {{letter}} has no text.' })
      case 'no_ending':
        return t('editor.experiences.scenarios.chip_no_ending', 'No path reaches an ending')
      default:
        return t('editor.blocks_v2.scenarios.issues.no_steps', 'Add a first step.')
    }
  }
}

export function IssueChip({ level, children }: { level: 'error' | 'warning'; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex h-6 max-w-full items-center gap-1 rounded-full px-2 text-[11.5px] font-medium ring-1',
        level === 'error' ? 'bg-rose-50 text-rose-700 ring-rose-600/15' : 'bg-amber-50 text-amber-800 ring-amber-600/15',
      )}
    >
      <Warning size={12} weight="fill" className="flex-none" aria-hidden />
      <span className="truncate">{children}</span>
    </span>
  )
}

const SELECT_CLASS =
  'h-7 min-w-0 max-w-full flex-none cursor-pointer rounded-full border-0 bg-neutral-100 py-0 ps-2.5 pe-7 text-[12.5px] font-medium text-neutral-700 outline-none transition-colors hover:bg-neutral-200/70 focus-visible:ring-2 focus-visible:ring-green-500/40'

const TEXT_INPUT_CLASS =
  'min-h-8 w-full min-w-0 rounded-lg bg-transparent px-2 py-1.5 text-[13px] text-neutral-800 outline-none transition-shadow placeholder:text-neutral-400 hover:bg-neutral-50 focus:bg-white focus:shadow-[0_0_0_1px_rgba(0,0,0,0.15),0_0_0_3px_rgba(22,163,74,0.08)]'

const REMOVE = '__remove'
const NEW = '__new'

/** The one select per choice. */
function ThenSelect({
  data,
  stepId,
  value,
  onPick,
  ariaLabel,
}: {
  data: ScenarioData
  stepId: string
  value: ThenValue
  onPick: (_v: ThenValue | 'new' | 'remove') => void
  ariaLabel: string
}) {
  const { t } = useTranslation()
  const next = followingStep(data, stepId)
  const titleOf = (s: ScenarioStep) =>
    stepTitle(s) || t('editor.blocks_v2.scenarios.step_n', { n: stepIndex(data, s.id) + 1, defaultValue: 'Step {{n}}' })
  const tone = value.startsWith('end:') ? (value.slice(4) as Outcome) : null
  return (
    <select
      value={value}
      aria-label={ariaLabel}
      onChange={(e) => {
        const v = e.target.value
        onPick(v === REMOVE ? 'remove' : v === NEW ? 'new' : (v as ThenValue))
      }}
      className={cn(
        SELECT_CLASS,
        'max-w-[min(100%,18rem)]',
        tone === 'success' && 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100/70',
        tone === 'neutral' && 'bg-sky-50 text-sky-800 hover:bg-sky-100/70',
        tone === 'fail' && 'bg-rose-50 text-rose-700 hover:bg-rose-100/70',
        value === 'missing' && 'bg-rose-50 text-rose-700',
      )}
    >
      {value === 'missing' && (
        <option value="missing" disabled>
          {t('editor.blocks_v2.scenarios.missing_step', 'Missing step')}
        </option>
      )}
      <option value="next">
        {next ? `${t('editor.experiences.scenarios.then_next', 'Next step')} (${titleOf(next)})` : t('editor.experiences.scenarios.then_next', 'Next step')}
      </option>
      <optgroup label={t('editor.experiences.scenarios.then_go_group', 'Go to')}>
        {data.scenarios
          .filter((s) => s.id !== next?.id)
          .map((s) => (
            <option key={s.id} value={`go:${s.id}`}>
              {t('editor.experiences.scenarios.then_go', { title: titleOf(s), defaultValue: 'Go to: {{title}}' })}
              {s.id === stepId ? ` (${t('editor.experiences.scenarios.then_repeat', 'repeat')})` : ''}
            </option>
          ))}
      </optgroup>
      {data.scenarios.length < MAX_STEPS && <option value={NEW}>{t('editor.experiences.scenarios.then_new', '+ New step')}</option>}
      <optgroup label={t('editor.experiences.scenarios.then_end_group', 'End the story')}>
        {OUTCOMES.map((o) => (
          <option key={o} value={`end:${o}`}>
            {`${t('editor.experiences.scenarios.then_end', 'End the story')} ${TONE_MARK[o]} · ${t(`editor.experiences.scenarios.tone_${o}`)}`}
          </option>
        ))}
      </optgroup>
      <option disabled>──────</option>
      <option value={REMOVE}>{t('editor.experiences.scenarios.then_remove', 'Remove this choice')}</option>
    </select>
  )
}

export function ScenarioStepCard({
  data,
  step,
  issues,
  isStart,
  commit,
  onFocusStep,
  autoFocusText,
  chat = false,
}: {
  data: ScenarioData
  step: ScenarioStep
  issues: ScenarioIssue[]
  isStart: boolean
  commit: Commit
  onFocusStep?: (_id: string) => void
  autoFocusText?: boolean
  /** Chat layout: the step as a message bubble, choices as reply pills. */
  chat?: boolean
}) {
  const { t } = useTranslation()
  const issueText = useIssueText()
  const [menuOpen, setMenuOpen] = React.useState(false)
  const [imageOpen, setImageOpen] = React.useState(false)
  const rootRef = React.useRef<HTMLElement>(null)
  const index = stepIndex(data, step.id)
  const ending = isEnding(step)
  const title = stepTitle(step)
  const stepLabel = t('editor.blocks_v2.scenarios.step_n', { n: index + 1, defaultValue: 'Step {{n}}' })
  // One chip per kind (several empty choices read as one hint).
  const chips = issues.filter((i, n) => issues.findIndex((j) => j.code === i.code) === n)
  const focusLater = (sel: string) => requestAnimationFrame(() => requestAnimationFrame(() => rootRef.current?.querySelector<HTMLElement>(sel)?.focus()))

  const pickThen = (choiceId: string, v: ThenValue | 'new' | 'remove') => {
    if (v === 'remove') {
      commit((d) => deleteChoice(d, step.id, choiceId))
      return
    }
    let created: string | undefined
    commit((d) => {
      const r = applyThen(d, step.id, choiceId, v)
      created = r.createdId
      return r.data
    })
    if (created) onFocusStep?.(created)
  }
  /** Where a choice leads, when that is another step (to jump there). */
  const targetOf = (option: ScenarioStep['options'][number]): string | null => {
    const then = thenOf(data, step.id, option)
    if (then === 'next') return followingStep(data, step.id)?.id ?? null
    if (then.startsWith('go:')) return then.slice(3)
    return null
  }

  return (
    <section
      ref={rootRef}
      id={`scenario-step-${step.id}`}
      data-step-id={step.id}
      aria-label={title ? `${stepLabel}: ${title}` : stepLabel}
      className="flex flex-col gap-3"
    >
      {/* The learner's step: counter, image, text. */}
      <div>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="inline-flex h-6 items-center rounded-full bg-neutral-100 px-2 text-[12px] font-semibold tabular-nums text-neutral-600">
            {t('activities.experiences.scenarios.step_counter', { n: index + 1, defaultValue: 'Step {{n}}' })}
          </span>
          {isStart && (
            <span className="inline-flex h-5 items-center gap-1 rounded-full bg-emerald-100 px-1.5 text-[11px] font-semibold text-emerald-700">
              <Flag size={10} weight="fill" aria-hidden />
              {t('editor.blocks_v2.scenarios.start', 'Start')}
            </span>
          )}
          {chips.map((issue) => (
            <IssueChip key={issue.code} level={issue.level}>
              {issueText(issue, data)}
            </IssueChip>
          ))}
          <span className="flex-1" />
          <BlockPopover
            open={menuOpen}
            onOpenChange={setMenuOpen}
            width={210}
            trigger={
              <button
                type="button"
                aria-label={t('editor.blocks_v2.scenarios.step_menu', 'Step options')}
                className="inline-flex h-7 w-7 flex-none items-center justify-center rounded-lg text-neutral-400 hover:bg-neutral-200/60 hover:text-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40"
              >
                <DotsThree size={18} weight="bold" />
              </button>
            }
          >
            <div className="-m-1.5 flex flex-col gap-0.5">
              {/* Legacy content can start somewhere other than the first step; only then is the start movable. */}
              {!isStart && data.scenarios[0]?.id !== data.currentScenarioId && (
                <MenuItem
                  icon={<Flag size={14} />}
                  onClick={() => {
                    commit((d) => ({ ...d, currentScenarioId: step.id }))
                    setMenuOpen(false)
                  }}
                >
                  {t('editor.blocks_v2.scenarios.set_start', 'Start here')}
                </MenuItem>
              )}
              <MenuItem
                icon={<ImageIcon size={14} />}
                onClick={() => {
                  setMenuOpen(false)
                  setImageOpen(true)
                }}
              >
                {step.imageUrl ? t('editor.scenarios.edit_image') : t('editor.scenarios.add_image')}
              </MenuItem>
              <MenuItem icon={<ArrowUp size={14} />} disabled={index === 0} onClick={() => commit((d) => moveStep(d, step.id, -1))}>
                {t('editor.blocks_v2.scenarios.move_up', 'Move up')}
              </MenuItem>
              <MenuItem icon={<ArrowDown size={14} />} disabled={index === data.scenarios.length - 1} onClick={() => commit((d) => moveStep(d, step.id, 1))}>
                {t('editor.blocks_v2.scenarios.move_down', 'Move down')}
              </MenuItem>
              <div className="my-0.5 h-px bg-neutral-100" />
              <MenuItem
                icon={<Trash size={14} />}
                danger
                disabled={data.scenarios.length <= 1}
                onClick={() => {
                  setMenuOpen(false)
                  const neighbour = data.scenarios[index + 1] ?? data.scenarios[index - 1]
                  commit((d) => deleteStep(d, step.id))
                  if (neighbour) onFocusStep?.(neighbour.id)
                }}
              >
                {t('editor.experiences.scenarios.delete_step', 'Delete step')}
              </MenuItem>
            </div>
          </BlockPopover>
        </div>

        {/* Image: set from the step menu, shown as learners see it. */}
        <BlockPopover open={imageOpen} onOpenChange={setImageOpen} width={300} align="end" title={t('editor.scenarios.image_url')} trigger={<span className="block" />}>
          <SettingsField label={t('editor.scenarios.image_url')} hint={t('editor.blocks_v2.scenarios.image_hint', 'Shown above the text. Paste a link to an image.')}>
            <CommitInput
              value={step.imageUrl || ''}
              type="url"
              placeholder="https://"
              className={FIELD_CLASS}
              aria-label={t('editor.scenarios.image_url')}
              onCommit={(v) => commit((d) => updateStep(d, step.id, { imageUrl: v.trim() }))}
            />
          </SettingsField>
        </BlockPopover>
        {step.imageUrl ? (
          <div className="relative mb-4">
            <img
              src={step.imageUrl}
              alt={t('editor.scenarios.preview_alt')}
              className="h-48 w-full rounded-xl object-cover shadow-[0_0_0_1px_var(--exp-edge,rgba(0,0,0,0.06))] max-sm:h-40"
              onError={(e) => {
                e.currentTarget.style.opacity = '0.3'
              }}
            />
            <button
              type="button"
              onClick={() => commit((d) => updateStep(d, step.id, { imageUrl: '' }))}
              aria-label={t('editor.blocks_v2.scenarios.remove_image', 'Remove image')}
              className="absolute end-2 top-2 flex h-7 w-7 items-center justify-center rounded-lg bg-black/55 text-white outline-none hover:bg-black/75 focus-visible:ring-2 focus-visible:ring-white"
            >
              <X size={13} />
            </button>
          </div>
        ) : null}

        {(() => {
          const text = (
            <InlineText
              multiline
              fit={chat}
              value={step.text}
              autoFocus={autoFocusText}
              ariaLabel={t('editor.blocks_v2.scenarios.step_text', 'What happens in this step')}
              placeholder={t('editor.blocks_v2.scenarios.step_text_placeholder', 'Describe the situation the learner is in…')}
              maxLength={2000}
              className={chat ? 'text-[14px] leading-relaxed text-neutral-800' : 'text-[16px] leading-relaxed font-medium text-neutral-800 max-sm:text-[15px]'}
              onCommit={(v) => commit((d) => updateStep(d, step.id, { text: v }))}
            />
          )
          if (!chat) return text
          return (
            <div className="flex items-end gap-2">
              <span aria-hidden className="lh-exp-raised mb-0.5 flex h-7 w-7 flex-none items-center justify-center rounded-full text-neutral-500">
                <ChatCircleText size={14} weight="duotone" />
              </span>
              <div className="lh-exp-bubble max-w-[82%] rounded-2xl rounded-es-md border border-[var(--exp-edge,rgba(0,0,0,0.08))] bg-white px-3.5 py-2">{text}</div>
            </div>
          )
        })()}
      </div>

      {/* The learner's choice buttons, each with its "Then…" pill. */}
      <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label={t('editor.experiences.scenarios.choices', 'Choices')}>
        {step.options.map((option, i) => {
          const letter = choiceLetter(i)
          const hasFeedback = !!option.feedback?.trim()
          const target = targetOf(option)
          return (
            <li key={option.id} data-choice={i} className={cn('group/choice flex flex-col gap-1.5', chat && 'items-end')}>
              <div
                className={cn(
                  'lh-exp-raised relative flex text-neutral-700',
                  chat ? 'min-h-10 max-w-full items-center rounded-2xl rounded-ee-md px-3.5 py-2' : 'min-h-12 w-full items-center gap-3 rounded-xl p-3',
                  EDIT_OBJECT,
                )}
              >
                {!chat && (
                  <span aria-hidden className="lh-exp-well flex h-7 w-7 flex-none items-center justify-center rounded-lg text-[13px] font-bold text-neutral-500">
                    {letter}
                  </span>
                )}
                <InlineText
                  fit={chat}
                  value={option.text}
                  maxLength={500}
                  placeholder={t('editor.experiences.scenarios.choice_placeholder', 'What can the learner do?')}
                  ariaLabel={t('editor.blocks_v2.scenarios.choice_n', { letter, defaultValue: 'Choice {{letter}}' })}
                  className={chat ? 'text-[14px] font-medium break-words' : 'min-w-0 flex-1 text-[15px] font-medium break-words'}
                  onCommit={(v) => commit((d) => updateChoice(d, step.id, option.id, { text: v }))}
                  onEmptyBackspace={() => commit((d) => deleteChoice(d, step.id, option.id))}
                />
                <RemoveX floating onClick={() => commit((d) => deleteChoice(d, step.id, option.id))} label={t('editor.experiences.scenarios.then_remove', 'Remove this choice')} />
              </div>
              <div className={cn('flex flex-wrap items-center gap-1.5', chat ? 'justify-end pe-1' : 'ps-3')}>
                <span aria-hidden className="text-[12px] font-medium text-neutral-400">
                  {t('editor.experiences.scenarios.then_short', 'Then')}
                </span>
                <ThenSelect
                  data={data}
                  stepId={step.id}
                  value={thenOf(data, step.id, option)}
                  ariaLabel={t('editor.experiences.scenarios.then_label', { letter, defaultValue: 'Then, after choice {{letter}}' })}
                  onPick={(v) => pickThen(option.id, v)}
                />
                {target && onFocusStep && (
                  <button
                    type="button"
                    onClick={() => onFocusStep(target)}
                    aria-label={t('editor.experiences.scenarios.open_target', 'Open that step')}
                    title={t('editor.experiences.scenarios.open_target', 'Open that step')}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-full text-neutral-400 outline-none hover:bg-neutral-200/60 hover:text-neutral-700 focus-visible:ring-2 focus-visible:ring-sky-500/40"
                  >
                    <ArrowRight size={13} weight="bold" aria-hidden className="rtl:rotate-180" />
                  </button>
                )}
              </div>
              {/* Feedback: only while the choice has focus, or once written. */}
              <div className={cn('rounded-xl bg-amber-50/80 px-3 py-2 text-[13px]', chat ? 'w-[min(100%,28rem)]' : 'ms-3', hasFeedback ? 'block' : 'hidden group-focus-within/choice:block')}>
                <InlineText
                  value={option.feedback ?? ''}
                  maxLength={500}
                  placeholder={t('editor.experiences.scenarios.feedback_placeholder', 'Feedback after this choice (optional)')}
                  ariaLabel={t('editor.experiences.scenarios.feedback_label', { letter, defaultValue: 'Feedback for choice {{letter}}' })}
                  className="leading-relaxed text-neutral-800"
                  onCommit={(v) => commit((d) => setChoiceFeedback(d, step.id, option.id, v))}
                />
              </div>
            </li>
          )
        })}
        {step.options.length < MAX_CHOICES && (
          <li>
            <AddGhost
              onClick={() => {
                commit((d) => addChoice(d, step.id, ''))
                focusLater(`[data-choice="${step.options.length}"] textarea`)
              }}
              className="min-h-12 w-full rounded-xl px-3 text-[14px]"
            >
              {t('editor.blocks_v2.scenarios.add_choice', 'Add choice')}
            </AddGhost>
          </li>
        )}
      </ul>

      {ending && <EndingRow step={step} commit={commit} />}
    </section>
  )
}

/** A step with no choices ends the story: pick its tone, optionally title it. */
function EndingRow({ step, commit }: { step: ScenarioStep; commit: Commit }) {
  const { t } = useTranslation()
  const tone = step.ending?.tone
  const hasTitle = !!step.ending?.title?.trim()
  return (
    <div className="group/ending mt-2 rounded-lg bg-neutral-50 p-1.5 ring-1 ring-neutral-200/70 focus-within:bg-white">
      <div className="flex flex-wrap items-center gap-2">
        <span className="ps-1 text-[12px] font-medium text-neutral-500">{t('editor.experiences.scenarios.ending_label', 'This step ends the story')}</span>
        <select
          value={tone ?? ''}
          aria-label={t('editor.experiences.scenarios.ending_tone', 'Ending tone')}
          onChange={(e) => {
            const v = e.target.value as Outcome | ''
            commit((d) => setStepEnding(d, step.id, v ? { tone: v, title: step.ending?.title } : null))
          }}
          className={cn(
            SELECT_CLASS,
            'ms-auto',
            tone === 'success' && 'bg-emerald-50 text-emerald-800',
            tone === 'neutral' && 'bg-sky-50 text-sky-800',
            tone === 'fail' && 'bg-rose-50 text-rose-700',
          )}
        >
          <option value="">{t('editor.experiences.scenarios.tone_default', 'Complete (default)')}</option>
          {OUTCOMES.map((o) => (
            <option key={o} value={o}>
              {`${TONE_MARK[o]} ${t(`editor.experiences.scenarios.tone_${o}`)}`}
            </option>
          ))}
        </select>
      </div>
      {tone && (
        <div className={cn('mt-1', hasTitle ? 'block' : 'hidden group-focus-within/ending:block')}>
          <DraftText
            value={step.ending?.title ?? ''}
            multiline={false}
            maxLength={120}
            placeholder={t('editor.experiences.scenarios.ending_title_placeholder', 'Ending title (optional)')}
            ariaLabel={t('editor.experiences.scenarios.ending_title', 'Ending title')}
            className={cn(TEXT_INPUT_CLASS, 'min-h-7 py-1 text-[12.5px]')}
            onCommit={(v) => commit((d) => setStepEnding(d, step.id, { tone, title: v }))}
          />
        </div>
      )}
    </div>
  )
}

function MenuItem({
  icon,
  children,
  onClick,
  disabled,
  danger,
}: {
  icon: React.ReactNode
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex h-8 items-center gap-2 rounded-lg px-2 text-start text-[13px] disabled:opacity-40',
        danger ? 'text-rose-600 hover:bg-rose-50' : 'text-neutral-700 hover:bg-neutral-100',
      )}
    >
      {icon}
      {children}
    </button>
  )
}

export default ScenarioStepCard
