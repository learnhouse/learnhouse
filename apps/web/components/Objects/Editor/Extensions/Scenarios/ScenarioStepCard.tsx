'use client'
/*
 One step of a scenario, edited in place: its text, an optional image, and
 its choices with the step each one leads to. Text fields commit on blur /
 Enter (one attr write per edit, never per keystroke); pickers and buttons
 commit on click.
*/
import React from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  CaretDown,
  Check,
  Crosshair,
  DotsThree,
  Flag,
  FlagCheckered,
  Image as ImageIcon,
  Plus,
  Trash,
  Warning,
  X,
} from '@phosphor-icons/react'
import { BlockPopover, CommitInput, FIELD_CLASS, SettingsField } from '../../Blocks/ui/BlockChrome'
import { cn } from '@/lib/utils'
import {
  MAX_CHOICES,
  MAX_STEPS,
  ScenarioData,
  ScenarioIssue,
  ScenarioStep,
  addChoice,
  choiceLetter,
  deleteChoice,
  deleteStep,
  excerpt,
  isEnding,
  linkChoiceToNewStep,
  moveStep,
  stepById,
  stepIndex,
  updateChoice,
  updateStep,
} from './scenarioModel'

export type Commit = (_fn: (_d: ScenarioData) => ScenarioData) => void

/** Auto-growing textarea that writes once, on blur (Escape reverts). */
export function InlineTextArea({
  value,
  onCommit,
  placeholder,
  className,
  ariaLabel,
  autoFocus,
}: {
  value: string
  onCommit: (_v: string) => void
  placeholder?: string
  className?: string
  ariaLabel?: string
  autoFocus?: boolean
}) {
  const [draft, setDraft] = React.useState(value)
  const editing = React.useRef(false)
  const ref = React.useRef<HTMLTextAreaElement>(null)
  React.useEffect(() => {
    if (!editing.current) setDraft(value)
  }, [value])
  React.useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${el.scrollHeight}px`
  }, [draft])
  React.useEffect(() => {
    if (autoFocus) ref.current?.focus()
  }, [autoFocus])
  return (
    <textarea
      ref={ref}
      rows={1}
      value={draft}
      placeholder={placeholder}
      aria-label={ariaLabel}
      className={cn(
        'w-full resize-none overflow-hidden rounded-lg bg-transparent px-2 py-1.5 outline-none transition-shadow placeholder:text-neutral-400 hover:bg-neutral-50 focus:bg-white focus:shadow-[0_0_0_1px_rgba(0,0,0,0.15),0_0_0_3px_rgba(22,163,74,0.08)]',
        className,
      )}
      onFocus={() => (editing.current = true)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        editing.current = false
        if (draft !== value) onCommit(draft)
      }}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Escape') {
          setDraft(value)
          editing.current = false
          ;(e.target as HTMLTextAreaElement).blur()
        }
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) (e.target as HTMLTextAreaElement).blur()
      }}
    />
  )
}

const CHOICE_INPUT =
  'h-8 w-full min-w-0 rounded-lg bg-transparent px-2 text-[13px] text-neutral-800 outline-none transition-shadow placeholder:text-neutral-400 hover:bg-neutral-50 focus:bg-white focus:shadow-[0_0_0_1px_rgba(0,0,0,0.15),0_0_0_3px_rgba(22,163,74,0.08)]'

export function useIssueText() {
  const { t } = useTranslation()
  return (issue: ScenarioIssue, data: ScenarioData) => {
    const step = stepById(data, issue.stepId)
    const letter = step && issue.choiceId ? choiceLetter(step.options.findIndex((o) => o.id === issue.choiceId)) : ''
    switch (issue.code) {
      case 'unreachable':
        return t('editor.blocks_v2.scenarios.issues.unreachable', 'No choice leads here, so learners never see this step.')
      case 'dead_end':
        return t('editor.blocks_v2.scenarios.issues.dead_end', 'Dead end: every choice from here loops back, so learners can’t finish.')
      case 'broken_link':
        return t('editor.blocks_v2.scenarios.issues.broken_link', { letter, defaultValue: 'Choice {{letter}} points to a step that was deleted.' })
      case 'empty_text':
        return t('editor.blocks_v2.scenarios.issues.empty_text', 'This step has no text yet.')
      case 'empty_choice':
        return t('editor.blocks_v2.scenarios.issues.empty_choice', { letter, defaultValue: 'Choice {{letter}} has no text.' })
      case 'no_ending':
        return t('editor.blocks_v2.scenarios.issues.no_ending', 'No path from the start reaches an ending.')
      default:
        return t('editor.blocks_v2.scenarios.issues.no_steps', 'Add a first step.')
    }
  }
}

/** Where a choice goes: another step, the end, or a new step. */
function TargetPicker({
  data,
  stepId,
  choiceId,
  value,
  commit,
  onCreated,
}: {
  data: ScenarioData
  stepId: string
  choiceId: string
  value: string | null
  commit: Commit
  onCreated?: (_id: string) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = React.useState(false)
  const target = stepById(data, value)
  const broken = value !== null && !target
  const set = (next: string | null) => {
    commit((d) => updateChoice(d, stepId, choiceId, { nextScenarioId: next }))
    setOpen(false)
  }
  const label =
    value === null
      ? t('editor.blocks_v2.scenarios.ends', 'Ends the scenario')
      : broken
        ? t('editor.blocks_v2.scenarios.missing_step', 'Missing step')
        : t('editor.blocks_v2.scenarios.go_to_step', { n: stepIndex(data, value) + 1, defaultValue: 'Step {{n}}' })
  return (
    <BlockPopover
      open={open}
      onOpenChange={setOpen}
      width={300}
      align="end"
      title={t('editor.blocks_v2.scenarios.leads_to', 'Leads to')}
      trigger={
        <button
          type="button"
          aria-label={`${t('editor.blocks_v2.scenarios.leads_to', 'Leads to')}: ${label}`}
          className={cn(
            'inline-flex h-7 max-w-[11rem] flex-none items-center gap-1 rounded-lg px-2 text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500/40',
            broken
              ? 'bg-rose-50 text-rose-700 ring-1 ring-rose-600/15'
              : value === null
                ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-600/15 hover:bg-emerald-100/70'
                : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200/70',
          )}
        >
          {value === null ? <FlagCheckered size={12} weight="duotone" /> : broken ? <Warning size={12} weight="fill" /> : <ArrowRight size={12} className="rtl:rotate-180" />}
          <span className="truncate">{label}</span>
          <CaretDown size={10} className="opacity-60" />
        </button>
      }
    >
      <div className="-mx-1 flex max-h-72 flex-col gap-0.5 overflow-y-auto">
        {data.scenarios.map((s, i) => (
          <button
            key={s.id}
            type="button"
            onClick={() => set(s.id)}
            className={cn(
              'flex items-start gap-2 rounded-lg px-2 py-1.5 text-start text-[13px] hover:bg-neutral-100 focus-visible:bg-neutral-100 focus-visible:outline-none',
              s.id === value && 'bg-green-50 hover:bg-green-50',
            )}
          >
            <span className="mt-px flex h-5 min-w-5 flex-none items-center justify-center rounded-md bg-neutral-100 px-1 text-[11px] font-semibold text-neutral-500">
              {i + 1}
            </span>
            <span className="min-w-0 flex-1">
              <span className="line-clamp-2 text-neutral-700">
                {excerpt(s.text, 80) || <em className="text-neutral-400">{t('editor.blocks_v2.scenarios.untitled_step', 'Empty step')}</em>}
              </span>
              {s.id === stepId && <span className="text-[11px] text-neutral-400">{t('editor.blocks_v2.scenarios.this_step', 'This step (repeat it)')}</span>}
            </span>
            {s.id === value && <Check size={14} className="mt-0.5 text-green-600" />}
          </button>
        ))}
      </div>
      <div className="-mx-1 flex flex-col gap-0.5 border-t border-neutral-100 pt-2">
        <button
          type="button"
          onClick={() => set(null)}
          className={cn('flex items-center gap-2 rounded-lg px-2 py-1.5 text-start text-[13px] text-emerald-700 hover:bg-emerald-50', value === null && 'bg-emerald-50')}
        >
          <FlagCheckered size={14} weight="duotone" />
          <span className="flex-1">{t('editor.blocks_v2.scenarios.end_here', 'End the scenario')}</span>
          {value === null && <Check size={14} />}
        </button>
        <button
          type="button"
          disabled={data.scenarios.length >= MAX_STEPS}
          onClick={() => {
            let created = ''
            commit((d) => {
              const r = linkChoiceToNewStep(d, stepId, choiceId)
              created = r.id
              return r.data
            })
            setOpen(false)
            if (created) onCreated?.(created)
          }}
          className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-start text-[13px] text-neutral-700 hover:bg-neutral-100 disabled:opacity-40"
        >
          <Plus size={14} />
          {t('editor.blocks_v2.scenarios.new_step_here', 'A new step')}
        </button>
      </div>
    </BlockPopover>
  )
}

export function ScenarioStepCard({
  data,
  step,
  issues,
  isStart,
  commit,
  onFocusStep,
  highlighted,
  autoFocusText,
  bare,
}: {
  data: ScenarioData
  step: ScenarioStep
  issues: ScenarioIssue[]
  isStart: boolean
  commit: Commit
  onFocusStep?: (_id: string) => void
  highlighted?: boolean
  autoFocusText?: boolean
  /** In the map's side panel: no card chrome. */
  bare?: boolean
}) {
  const { t } = useTranslation()
  const issueText = useIssueText()
  const [menuOpen, setMenuOpen] = React.useState(false)
  const [imageOpen, setImageOpen] = React.useState(false)
  const index = stepIndex(data, step.id)
  const ending = isEnding(step)
  const hasError = issues.some((i) => i.level === 'error')
  const stepIssues = issues.filter((i) => !i.choiceId)
  const choiceIssue = (choiceId: string) => issues.find((i) => i.choiceId === choiceId)

  return (
    <div
      id={`scenario-step-${step.id}`}
      data-step-id={step.id}
      className={cn(
        'group/step relative scroll-mt-24',
        bare ? '' : 'rounded-lg border border-neutral-200 bg-neutral-50 p-2.5 transition-shadow sm:p-3',
        !bare && highlighted && 'shadow-[0_0_0_2px_rgba(16,185,129,0.45)]',
      )}
    >
      <div className="flex items-start gap-2">
        <span
          className={cn(
            'mt-1 flex h-6 min-w-6 flex-none items-center justify-center rounded-full px-1 text-[11px] font-semibold',
            isStart ? 'bg-emerald-500 text-white' : hasError ? 'bg-rose-50 text-rose-600 ring-1 ring-rose-600/15' : 'bg-neutral-100 text-neutral-500',
          )}
          title={t('editor.blocks_v2.scenarios.step_n', { n: index + 1, defaultValue: 'Step {{n}}' })}
        >
          {index + 1}
        </span>
        <div className="min-w-0 flex-1">
          {(isStart || ending) && (
          <div className="flex flex-wrap items-center gap-1.5 px-2 pb-0.5 pt-1">
            {isStart && (
              <span className="inline-flex h-5 items-center gap-1 rounded-full bg-emerald-100 px-1.5 text-[11px] font-semibold text-emerald-700">
                <Flag size={10} weight="fill" />
                {t('editor.blocks_v2.scenarios.start', 'Start')}
              </span>
            )}
            {ending && (
              <span className="inline-flex h-5 items-center gap-1 rounded-full bg-emerald-50 px-1.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-600/15">
                <FlagCheckered size={10} weight="duotone" />
                {t('editor.blocks_v2.scenarios.ending', 'Ending')}
              </span>
            )}
          </div>
          )}
          <InlineTextArea
            value={step.text}
            autoFocus={autoFocusText}
            ariaLabel={t('editor.blocks_v2.scenarios.step_text', 'What happens in this step')}
            placeholder={t('editor.blocks_v2.scenarios.step_text_placeholder', 'Describe the situation the learner is in…')}
            className="text-[14px] leading-relaxed text-neutral-800"
            onCommit={(v) => commit((d) => updateStep(d, step.id, { text: v }))}
          />
        </div>
        <BlockPopover
          open={menuOpen}
          onOpenChange={setMenuOpen}
          width={220}
          trigger={
            <button
              type="button"
              aria-label={t('editor.blocks_v2.scenarios.step_menu', 'Step options')}
              className="mt-0.5 inline-flex h-7 w-7 flex-none items-center justify-center rounded-lg text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500/40"
            >
              <DotsThree size={18} weight="bold" />
            </button>
          }
        >
          <div className="-m-1.5 flex flex-col gap-0.5">
            <MenuItem
              icon={<Flag size={14} />}
              disabled={isStart}
              onClick={() => {
                commit((d) => ({ ...d, currentScenarioId: step.id }))
                setMenuOpen(false)
              }}
            >
              {t('editor.blocks_v2.scenarios.set_start', 'Start here')}
            </MenuItem>
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
            <MenuItem
              icon={<ArrowDown size={14} />}
              disabled={index === data.scenarios.length - 1}
              onClick={() => commit((d) => moveStep(d, step.id, 1))}
            >
              {t('editor.blocks_v2.scenarios.move_down', 'Move down')}
            </MenuItem>
            <div className="my-0.5 h-px bg-neutral-100" />
            <MenuItem
              icon={<Trash size={14} />}
              danger
              disabled={data.scenarios.length <= 1}
              onClick={() => {
                setMenuOpen(false)
                commit((d) => deleteStep(d, step.id))
              }}
            >
              {t('editor.scenarios.delete_scenario')}
            </MenuItem>
          </div>
        </BlockPopover>
      </div>

      {/* Image: shown when set; edited from the step menu. */}
      <BlockPopover
        open={imageOpen}
        onOpenChange={setImageOpen}
        width={300}
        align="start"
        title={t('editor.scenarios.image_url')}
        trigger={<span className="block" />}
      >
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
        <div className="relative ms-8 mt-1.5 inline-block">
          <img
            src={step.imageUrl}
            alt={t('editor.scenarios.preview_alt')}
            className="h-24 max-w-full rounded-lg object-cover ring-1 ring-black/5"
            onError={(e) => {
              e.currentTarget.style.opacity = '0.3'
            }}
          />
          <button
            type="button"
            onClick={() => commit((d) => updateStep(d, step.id, { imageUrl: '' }))}
            aria-label={t('editor.blocks_v2.scenarios.remove_image', 'Remove image')}
            className="absolute end-1 top-1 flex h-6 w-6 items-center justify-center rounded-md bg-black/55 text-white hover:bg-black/75"
          >
            <X size={12} />
          </button>
        </div>
      ) : null}

      {stepIssues.length > 0 && (
        <ul className="mt-1 flex flex-col gap-1 px-2 sm:ms-8">
          {stepIssues.map((issue) => (
            <li
              key={issue.code}
              className={cn('flex items-start gap-1.5 text-[12px]', issue.level === 'error' ? 'text-rose-600' : 'text-amber-700')}
            >
              <Warning size={13} weight="fill" className="mt-0.5 flex-none" />
              {issueText(issue, data)}
            </li>
          ))}
        </ul>
      )}

      {/* Choices */}
      <div className="mt-2 flex flex-col gap-1 sm:ms-8">
        {step.options.map((option, i) => {
          const issue = choiceIssue(option.id)
          return (
            <div key={option.id} className="group/choice flex flex-col">
              <div className={cn('flex flex-wrap items-center gap-1.5 rounded-lg bg-white py-1 pe-1 ps-1.5 ring-1 ring-neutral-200 sm:py-0.5', bare ? 'sm:py-1' : 'sm:flex-nowrap')}>
                <span className="flex h-5 w-5 flex-none items-center justify-center rounded-md bg-white text-[10px] font-bold text-neutral-500 shadow-[0_0_0_1px_var(--lhb-border,rgba(0,0,0,0.08))]">
                  {choiceLetter(i)}
                </span>
                <CommitInput
                  value={option.text}
                  className={cn(CHOICE_INPUT, 'flex-[1_1_calc(100%-2rem)]', !bare && 'sm:flex-1')}
                  placeholder={t('editor.scenarios.option_placeholder')}
                  aria-label={t('editor.blocks_v2.scenarios.choice_n', { letter: choiceLetter(i), defaultValue: 'Choice {{letter}}' })}
                  onCommit={(v) => commit((d) => updateChoice(d, step.id, option.id, { text: v }))}
                />
                <TargetPicker
                  data={data}
                  stepId={step.id}
                  choiceId={option.id}
                  value={option.nextScenarioId}
                  commit={commit}
                  onCreated={onFocusStep}
                />
                {option.nextScenarioId && stepById(data, option.nextScenarioId) && onFocusStep && (
                  <button
                    type="button"
                    onClick={() => onFocusStep(option.nextScenarioId!)}
                    aria-label={t('editor.blocks_v2.scenarios.jump_to', 'Jump to that step')}
                    title={t('editor.blocks_v2.scenarios.jump_to', 'Jump to that step')}
                    className="hidden h-7 w-6 flex-none items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-200/60 hover:text-neutral-700 sm:inline-flex"
                  >
                    <Crosshair size={12} />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => commit((d) => deleteChoice(d, step.id, option.id))}
                  aria-label={t('editor.scenarios.delete_option')}
                  title={t('editor.scenarios.delete_option')}
                  className="inline-flex h-7 w-7 flex-none items-center justify-center rounded-md text-neutral-400 transition-opacity hover:bg-rose-50 hover:text-rose-600 sm:opacity-0 sm:group-hover/choice:opacity-100 sm:focus-visible:opacity-100"
                >
                  <Trash size={13} />
                </button>
              </div>
              {issue && issue.code === 'broken_link' && (
                <span className="ms-7 mt-0.5 text-[11px] text-rose-600">{issueText(issue, data)}</span>
              )}
            </div>
          )
        })}
        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          {step.options.length < MAX_CHOICES && (
            <button
              type="button"
              onClick={() => commit((d) => addChoice(d, step.id, ''))}
              className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[12px] font-medium text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800"
            >
              <Plus size={12} />
              {t('editor.blocks_v2.scenarios.add_choice', 'Add choice')}
            </button>
          )}
          {ending && (
            <span className="text-[11px] text-neutral-400">
              {t('editor.blocks_v2.scenarios.ending_hint', 'No choices: learners finish the scenario on this step.')}
            </span>
          )}
        </div>
      </div>
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
