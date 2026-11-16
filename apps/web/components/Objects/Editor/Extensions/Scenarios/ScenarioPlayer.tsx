'use client'
/*
 The learner's scenario player, also used as the editor's Preview tab.
 Everything here is local state (where the learner is, the path so far);
 nothing is written to the document.
*/
import React from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowCounterClockwise, ArrowLeft, ArrowRight, CheckCircle, GitBranch } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import { ScenarioData, choiceLetter, isEnding, startIdOf, stepById } from './scenarioModel'

interface Visit {
  stepId: string
  choiceId: string
  choiceText: string
}

export function ScenarioPlayer({ data }: { data: ScenarioData }) {
  const { t } = useTranslation()
  const start = startIdOf(data)
  const [stepId, setStepId] = React.useState<string | null>(start)
  const [path, setPath] = React.useState<Visit[]>([])
  const [finished, setFinished] = React.useState(false)
  const bodyRef = React.useRef<HTMLDivElement>(null)

  // If the start changes under us (author edits, collaborator), begin again.
  const [lastStart, setLastStart] = React.useState(start)
  if (lastStart !== start) {
    setLastStart(start)
    setStepId(start)
    setPath([])
    setFinished(false)
  }

  const step = stepById(data, stepId)
  const restart = () => {
    setStepId(start)
    setPath([])
    setFinished(false)
  }
  const back = () => {
    const last = path[path.length - 1]
    if (!last) return
    setPath(path.slice(0, -1))
    setStepId(last.stepId)
    setFinished(false)
  }
  const choose = (choiceId: string) => {
    if (!step) return
    const choice = step.options.find((o) => o.id === choiceId)
    if (!choice) return
    const nextPath = [...path, { stepId: step.id, choiceId, choiceText: choice.text }]
    setPath(nextPath)
    const next = stepById(data, choice.nextScenarioId)
    // A choice that ends the scenario, or points at a step that no longer
    // exists, finishes it rather than showing an error to learners.
    if (!next) setFinished(true)
    else setStepId(next.id)
    // Keep the new step in view on long pages / phones.
    requestAnimationFrame(() => bodyRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }))
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (finished || !step || e.metaKey || e.ctrlKey || e.altKey) return
    const target = e.target as HTMLElement
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return
    const n = /^[1-9]$/.test(e.key) ? Number(e.key) - 1 : /^[a-z]$/i.test(e.key) ? e.key.toUpperCase().charCodeAt(0) - 65 : -1
    const choice = step.options[n]
    if (choice) {
      e.preventDefault()
      choose(choice.id)
    }
  }

  const ended = finished || (step ? isEnding(step) : false)

  return (
    <div
      data-lhb-panel=""
      className="block-scenarios-player rounded-xl bg-neutral-50 px-5 py-4 nice-shadow transition-all ease-linear"
      onKeyDown={onKeyDown}
      data-testid="scenario-player"
    >
      {/* Header (as before): label, completion chip, back + reset */}
      <div className="mb-3 flex items-center gap-2 text-sm">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <GitBranch weight="duotone" className="flex-none text-neutral-400" size={16} />
          <span className="flex-none text-[12px] font-semibold text-neutral-500">{t('editor.scenarios.interactive_scenario')}</span>
          {data.title && data.title !== 'Interactive Scenario' && (
            <span className="min-w-0 truncate text-xs font-semibold text-neutral-600">· {data.title}</span>
          )}
        </div>
        {finished && (
          <div className="flex-none rounded-md bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-700">{t('editor.scenarios.complete')}</div>
        )}
        {path.length > 0 && (
          <button
            type="button"
            onClick={back}
            className="inline-flex flex-none items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-neutral-500 transition-colors hover:bg-neutral-200"
          >
            <ArrowLeft weight="duotone" size={14} className="rtl:rotate-180" />
            {t('editor.blocks_v2.scenarios.back', 'Back')}
          </button>
        )}
        <button
          type="button"
          onClick={restart}
          className="flex-none rounded-md p-1.5 transition-colors hover:bg-neutral-200"
          title={t('editor.scenarios.reset')}
          aria-label={t('editor.scenarios.reset')}
        >
          <ArrowCounterClockwise weight="duotone" className="text-neutral-500" size={15} />
        </button>
      </div>

      <div ref={bodyRef}>
        {!step && !finished ? (
          <div className="rounded-lg bg-white p-6 text-center nice-shadow">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-neutral-100">
              <GitBranch weight="duotone" size={20} className="text-neutral-400" />
            </div>
            <h3 className="mb-2 text-base font-medium text-neutral-900">{t('editor.scenarios.not_found')}</h3>
            <p className="text-sm text-neutral-500">{t('editor.blocks_v2.scenarios.empty_player', 'This scenario has no steps yet.')}</p>
          </div>
        ) : finished || (step && ended) ? (
          <div key="done" className="space-y-4 animate-in fade-in-0 duration-200">
            {step && !finished && (
              <div className="rounded-lg bg-white p-5 nice-shadow">
                <StepBody step={step} />
              </div>
            )}
            <div className="rounded-lg bg-white p-6 text-center nice-shadow">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
                <CheckCircle weight="duotone" size={28} className="text-emerald-600" />
              </div>
              <h4 className="mb-2 text-xl font-bold text-neutral-900">{t('editor.scenarios.complete')}</h4>
              <p className="mx-auto mb-4 max-w-md leading-relaxed text-neutral-600">{t('editor.scenarios.complete_message')}</p>
              <PathRecap path={path} />
              <button
                type="button"
                onClick={restart}
                className="mt-5 inline-flex items-center gap-2 rounded-lg bg-neutral-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-neutral-800"
              >
                <ArrowCounterClockwise weight="duotone" size={16} />
                {t('editor.scenarios.start_over')}
              </button>
            </div>
          </div>
        ) : step ? (
          <div key={step.id + ':' + path.length} className="space-y-4 animate-in fade-in-0 duration-200">
            <div className="rounded-lg bg-white p-5 nice-shadow">
              <StepBody step={step} />
            </div>
            <div className="space-y-2" role="group" aria-label={t('editor.blocks_v2.scenarios.choose', 'Choose a response')}>
              {step.options.map((option, i) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => choose(option.id)}
                  className="group w-full rounded-lg border border-neutral-200 bg-white p-3 text-start transition-all nice-shadow hover:border-[var(--lhb-accent-line,var(--color-blue-300))] hover:bg-[var(--lhb-accent-soft,var(--color-blue-50))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--lhb-accent-line,rgb(96_165_250/0.5))]"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md bg-neutral-100 transition-colors group-hover:bg-[var(--lhb-accent-soft,var(--color-blue-100))]">
                      <span className="text-sm font-bold text-neutral-600 group-hover:text-[var(--lhb-accent,var(--color-blue-600))]">{choiceLetter(i)}</span>
                    </div>
                    <div className="min-w-0 flex-1 break-words font-medium text-neutral-700 transition-colors group-hover:text-[var(--lhb-text,var(--color-blue-900))]">{option.text}</div>
                    <ArrowRight weight="duotone" size={16} className="flex-none text-neutral-400 transition-all group-hover:translate-x-1 group-hover:text-[var(--lhb-accent,var(--color-blue-500))] rtl:rotate-180 rtl:group-hover:-translate-x-1" />
                  </div>
                </button>
              ))}
            </div>
            {path.length > 0 && <PathRecap path={path} inline />}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function StepBody({ step }: { step: { imageUrl?: string; text: string } }) {
  const { t } = useTranslation()
  return (
    <>
      {step.imageUrl ? (
        <div className="mb-4">
          <img
            src={step.imageUrl}
            alt={t('editor.scenarios.illustration_alt')}
            className="h-48 w-full rounded-lg border border-neutral-200 object-cover"
            onError={(e) => {
              e.currentTarget.style.display = 'none'
            }}
          />
        </div>
      ) : null}
      <p className="whitespace-pre-wrap text-base font-medium leading-relaxed text-neutral-800">{step.text}</p>
    </>
  )
}

function PathRecap({ path, inline = false }: { path: Visit[]; inline?: boolean }) {
  const { t } = useTranslation()
  if (path.length === 0) return null
  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', inline ? '' : 'justify-center')}>
      <span className="text-[11px] font-medium text-neutral-400">{t('editor.blocks_v2.scenarios.your_path', 'Your path')}</span>
      {path.map((v, i) => (
        <React.Fragment key={i}>
          {i > 0 && <ArrowRight size={10} className="text-neutral-300 rtl:rotate-180" />}
          <span className="max-w-[16rem] truncate rounded-md bg-white px-1.5 py-0.5 text-[11px] text-neutral-600 shadow-[0_0_0_1px_var(--lhb-border,rgba(0,0,0,0.06))]">
            {v.choiceText || '…'}
          </span>
        </React.Fragment>
      ))}
    </div>
  )
}

export default ScenarioPlayer
