'use client'
import React, { useEffect, useMemo, useState } from 'react'
import { motion } from 'motion/react'
import Link from 'next/link'
import {
  BookOpen,
  Browsers,
  Palette,
  ShareNetwork,
  UserPlus,
  Check,
  ArrowRight,
  ArrowUpRight,
  Clock,
  Garage,
  RocketLaunch,
  UsersThree,
  CurrencyCircleDollar,
} from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { useOnboarding, OnboardingStep } from '@components/Hooks/useOnboarding'
import { useOnboardingSignals } from '@components/Hooks/useOnboardingSignals'
import { useOrg } from '@components/Contexts/OrgContext'
import { getUriWithOrg } from '@services/config/config'
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics'
import OnboardingVideo from './OnboardingVideo'
import LaunchFinale from './LaunchFinale'
import { whyKey } from './onboardingCopy'
import { openInviteDialog } from '@components/Onboarding/onboardingEvents'

export const STEP_ICON: Record<string, React.ElementType> = {
  create_course: BookOpen,
  add_content: Browsers,
  brand_school: Palette,
  share_grow: ShareNetwork,
  invite_learners: UserPlus,
  build_community: Garage,
  publish_course: RocketLaunch,
  create_group: UsersThree,
  setup_payments: CurrencyCircleDollar,
}

/**
 * The launch plan: the steps in a card on the left, the selected step on the
 * right with its walkthrough video and one action. Steps tick off from real
 * data; each one finished gets a toast, the last one opens the finale.
 */
export default function LaunchPlan() {
  const { steps, currentStep, allCompleted, intent, uncelebrated } = useOnboarding()
  const { latestCourseUuid } = useOnboardingSignals(!allCompleted)
  const { t, i18n } = useTranslation()
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const selected = steps.find((s) => s.id === selectedId) ?? currentStep ?? steps[steps.length - 1]

  // A step just finished (the tracker celebrates it): move the panel on to
  // what's next.
  const pending = uncelebrated.join(',')
  useEffect(() => {
    if (pending) setSelectedId(null)
  }, [pending])

  if (allCompleted) return <LaunchFinale />

  return (
    <div className="grid gap-6 lg:grid-cols-[320px_1fr] items-start">
      <StepList steps={steps} selectedId={selected?.id} currentId={currentStep?.id} onSelect={setSelectedId} />
      {selected && (
        <StepPanel
          key={selected.id}
          step={selected}
          index={steps.findIndex((s) => s.id === selected.id)}
          total={steps.length}
          why={intent && i18n.exists(whyKey(intent, selected.id)) ? t(whyKey(intent, selected.id)) : undefined}
          latestCourseUuid={latestCourseUuid}
          onNext={() => {
            const i = steps.findIndex((s) => s.id === selected.id)
            const next = steps.slice(i + 1).find((s) => !s.completed) ?? steps.find((s) => !s.completed)
            setSelectedId(next?.id ?? null)
          }}
        />
      )}
    </div>
  )
}

function StepList({
  steps,
  selectedId,
  currentId,
  onSelect,
}: {
  steps: OnboardingStep[]
  selectedId?: string
  currentId?: string
  onSelect: (_id: string) => void
}) {
  const { t } = useTranslation()
  const done = steps.filter((s) => s.completed).length
  return (
    <div className="order-2 lg:order-1 bg-white rounded-xl nice-shadow overflow-hidden lg:sticky lg:top-6">
      <div className="flex items-center justify-between px-5 pt-4 pb-3">
        <h3 className="text-sm font-semibold text-gray-700">{t('onboarding.steps_title')}</h3>
        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 tabular-nums">
          {done}/{steps.length}
        </span>
      </div>
      <ol className="px-2 pb-2">
        {steps.map((step, i) => {
          const Icon = STEP_ICON[step.id] ?? BookOpen
          const active = step.id === selectedId
          const finished = step.completed && !step.skipped
          return (
            <li key={step.id}>
              <button
                type="button"
                onClick={() => onSelect(step.id)}
                aria-current={active ? 'step' : undefined}
                className={[
                  'w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-start transition-colors',
                  active ? 'bg-gray-100' : 'hover:bg-gray-50',
                ].join(' ')}
              >
                <span
                  className={[
                    'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
                    finished ? 'bg-green-50 text-green-600' : 'bg-gray-100 text-gray-500',
                  ].join(' ')}
                >
                  {finished ? (
                    <motion.span initial={{ scale: 0.5 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 500, damping: 20 }}>
                      <Check size={15} weight="bold" />
                    </motion.span>
                  ) : (
                    <Icon size={16} weight="duotone" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={[
                      'block truncate text-sm font-medium',
                      step.completed ? 'text-gray-400' : 'text-gray-900',
                    ].join(' ')}
                  >
                    {t(`onboarding.steps.${step.id}.title`)}
                  </span>
                  <span className="block text-xs text-gray-400">
                    {step.skipped
                      ? t('onboarding.skipped')
                      : finished
                        ? t('onboarding.done_label')
                        : step.id === currentId
                          ? t('onboarding.up_next')
                          : t('onboarding.step_number', { n: i + 1 })}
                  </span>
                </span>
                {!step.completed && (
                  <span className="shrink-0 text-xs text-gray-400 tabular-nums">
                    {t('onboarding.minutes', { count: step.minutes })}
                  </span>
                )}
              </button>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function StepPanel({
  step,
  index,
  total,
  why,
  latestCourseUuid,
  onNext,
}: {
  step: OnboardingStep
  index: number
  total: number
  why?: string
  latestCourseUuid: string | null
  onNext: () => void
}) {
  const { t } = useTranslation()
  const { track } = useLHAnalytics('dashboard')
  const { completeStep, skipStep, unskipStep } = useOnboarding()
  const org = useOrg() as any
  const orgSlug = org?.slug || ''

  // The add-content step goes straight into the course the admin just made.
  const href = useMemo(() => {
    if (step.id === 'add_content' && latestCourseUuid) {
      return `/dash/courses/course/${latestCourseUuid.replace(/^course_/, '')}/content`
    }
    return step.href
  }, [step, latestCourseUuid])
  const target = step.hrefType === 'root' ? getUriWithOrg(orgSlug, '/') : getUriWithOrg(orgSlug, href)
  const title = t(`onboarding.steps.${step.id}.title`)
  const action = t(`onboarding.steps.${step.id}.action`)

  const onAction = (e: React.MouseEvent) => {
    track(AnalyticsEvent.OnboardingStepActionClicked, { step_id: step.id })
    if (step.id === 'invite_learners') {
      e.preventDefault()
      openInviteDialog('link')
      return
    }
    if (step.completeOnClick) completeStep(step.id)
  }

  const btn =
    'inline-flex items-center gap-2 rounded-lg bg-black px-4 py-2 text-xs font-bold text-white nice-shadow transition-colors hover:bg-gray-800'
  const cta = step.completeOnClick ? (
    <a href={target} target="_blank" rel="noopener noreferrer" onClick={onAction} className={btn}>
      {action}
      <ArrowUpRight size={13} weight="bold" data-dir-flip />
    </a>
  ) : (
    <Link href={target} onClick={onAction} className={btn}>
      {action}
      <ArrowRight size={13} weight="bold" data-dir-flip />
    </Link>
  )

  return (
    <section className="order-1 lg:order-2 bg-white rounded-xl nice-shadow overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-3">
        <span className="text-xs font-medium text-gray-400">
          {t('onboarding.step_of', { current: index + 1, total })}
        </span>
        <span className="inline-flex items-center gap-1 text-xs text-gray-400">
          <Clock size={12} />
          {t('onboarding.about_minutes', { count: step.minutes })}
        </span>
      </div>

      <div className="px-5">
        <OnboardingVideo id={step.video} endSlot={!step.completed ? cta : undefined} />
      </div>

      <div className="px-5 pt-5 pb-5">
        <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-gray-500">
          {why ?? t(`onboarding.steps.${step.id}.description`)}
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          {step.completed && !step.skipped ? (
            <>
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-green-600">
                <Check size={14} weight="bold" />
                {t('onboarding.step_done')}
              </span>
              <button
                type="button"
                onClick={onNext}
                className="inline-flex items-center gap-1 text-xs font-semibold text-gray-900 hover:text-gray-600"
              >
                {t('onboarding.next_step')}
                <ArrowRight size={12} weight="bold" data-dir-flip />
              </button>
            </>
          ) : step.skipped ? (
            <button
              type="button"
              onClick={() => unskipStep(step.id)}
              className="rounded-lg bg-gray-100 px-4 py-2 text-xs font-bold text-gray-700 hover:bg-gray-200 transition-colors"
            >
              {t('onboarding.undo_skip')}
            </button>
          ) : (
            <>
              {cta}
              <button
                type="button"
                onClick={() => {
                  track(AnalyticsEvent.OnboardingStepSkipped, { step_id: step.id })
                  skipStep(step.id)
                  onNext()
                }}
                className="text-xs font-medium text-gray-400 hover:text-gray-600"
              >
                {t('onboarding.skip_for_now')}
              </button>
            </>
          )}
        </div>
      </div>

      {!step.completed && !step.completeOnClick && (
        <div className="border-t border-gray-100 px-5 py-3 text-xs text-gray-400">{t('onboarding.auto_check')}</div>
      )}
    </section>
  )
}
