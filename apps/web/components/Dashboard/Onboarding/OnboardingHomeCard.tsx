'use client'
import React, { useState } from 'react'
import Link from 'next/link'
import { motion } from 'motion/react'
import { ArrowRight, Check, Play, X, UserPlus, FileCsv } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { Panel, buttonClass } from '@/design'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import { useOnboarding, type OnboardingStep } from '@components/Hooks/useOnboarding'
import { useOrg } from '@components/Contexts/OrgContext'
import { getUriWithOrg } from '@services/config/config'
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics'
import { openInviteDialog } from '@components/Onboarding/onboardingEvents'
import { STEP_ICON } from './LaunchPlan'
import LaunchFinale from './LaunchFinale'
import OnboardingVideo from './OnboardingVideo'
import { onboardingVideo, WELCOME_VIDEO } from './onboardingMedia'

/**
 * The launch plan on the dashboard home: progress, the next step with its
 * guide video ("Watch") and its action ("Do it"), and every other step with
 * its own video one tap away. Steps tick off from the org's real data; when
 * the last one is done, the finale takes the card's place.
 */
export default function OnboardingHomeCard() {
  const { t } = useTranslation()
  const org = useOrg() as any
  const { track } = useLHAnalytics('dashboard')
  const { loaded, steps, currentStep, progress, minutesLeft, dismissed, allCompleted, dismiss, completeStep } = useOnboarding()
  const [watching, setWatching] = useState<{ video: string; title: string } | null>(null)
  // Shown under the welcome tour on the first visit too: the tour points at it.
  if (!loaded || dismissed) return null
  if (allCompleted) return <LaunchFinale />
  if (!currentStep) return null

  const slug = org?.slug || ''
  const done = steps.filter((s) => s.completed).length
  const hrefOf = (step: OnboardingStep) => (step.hrefType === 'root' ? getUriWithOrg(slug, '/') : getUriWithOrg(slug, step.href))

  const doIt = (step: OnboardingStep, e?: React.MouseEvent) => {
    track(AnalyticsEvent.OnboardingStepActionClicked, { step_id: step.id, surface: 'home' })
    if (step.id === 'invite_learners') {
      e?.preventDefault()
      openInviteDialog('link')
      return
    }
    if (step.completeOnClick) completeStep(step.id)
  }

  const watch = (step: { video: string; id: string }) => {
    track(AnalyticsEvent.OnboardingVideoPlayed, { step_id: step.id, surface: 'home' })
    setWatching({ video: step.video, title: t(`onboarding.steps.${step.id}.title`) })
  }

  const next = currentStep
  const NextIcon = STEP_ICON[next.id] ?? Check

  return (
    <Panel className="overflow-hidden" id="launch-plan" data-testid="setup-checklist">
      <div className="flex items-start justify-between gap-3 px-5 pt-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-neutral-900">{t('onboarding.launch_plan')}</h3>
          <p className="mt-0.5 text-xs text-neutral-500">
            {t('onboarding.progress_count', { done, total: steps.length })}
            <span className="mx-1.5 text-neutral-300">·</span>
            {t('onboarding.minutes_left', { count: minutesLeft })}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => setWatching({ video: WELCOME_VIDEO, title: t('onboarding.tour_title') })}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800"
          >
            <Play size={11} weight="fill" />
            {t('onboarding.watch_tour')}
          </button>
          <Link href={getUriWithOrg(slug, '/dash/onboarding')} className="rounded-lg px-2 py-1 text-xs font-medium text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800">
            {t('onb2.checklist.full_guide')}
          </Link>
          <button
            type="button"
            onClick={() => {
              track(AnalyticsEvent.OnboardingChecklistDismissed, { done })
              dismiss()
            }}
            className="rounded-lg p-1.5 text-neutral-300 hover:bg-neutral-100 hover:text-neutral-600 transition-colors"
            aria-label={t('onboarding.dismiss')}
            title={t('onboarding.dismiss')}
          >
            <X size={14} weight="bold" />
          </button>
        </div>
      </div>

      <div className="mx-5 mt-3 h-1.5 overflow-hidden rounded-full bg-neutral-100">
        <motion.div
          className="h-full rounded-full bg-neutral-900"
          initial={false}
          animate={{ width: `${Math.max(progress * 100, 4)}%` }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        />
      </div>

      {/* Up next: the guide video and the action, side by side. */}
      <div className="mx-5 mt-4 flex flex-col gap-4 rounded-2xl bg-neutral-50 p-3 sm:flex-row sm:items-center" data-step={next.id} data-state="next">
        <button
          type="button"
          onClick={() => watch(next)}
          className="group relative aspect-video w-full shrink-0 overflow-hidden rounded-xl bg-neutral-200 sm:w-52"
          aria-label={t('onb2.checklist.watch', { count: next.minutes })}
          data-testid="step-video"
        >
          <img
            src={onboardingVideo(next.video).poster}
            alt=""
            onError={(e) => (e.currentTarget.style.visibility = 'hidden')}
            className="h-full w-full object-cover"
          />
          <span className="absolute inset-0 flex items-center justify-center bg-black/10 transition-colors group-hover:bg-black/20">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white nice-shadow">
              <Play size={13} weight="fill" className="text-neutral-900" />
            </span>
          </span>
        </button>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-xs text-neutral-400">
            <NextIcon size={13} weight="duotone" />
            {t('onboarding.up_next')}
          </p>
          <p className="mt-0.5 text-base font-semibold text-neutral-900">{t(`onboarding.steps.${next.id}.title`)}</p>
          <p className="mt-0.5 text-sm text-neutral-500">{t(`onboarding.steps.${next.id}.description`)}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Link
              href={hrefOf(next)}
              target={next.hrefType === 'root' ? '_blank' : undefined}
              onClick={(e) => doIt(next, e)}
              className={buttonClass('primary', 'sm')}
            >
              {t('onb2.checklist.do_it')}
              <ArrowRight size={12} weight="bold" data-dir-flip />
            </Link>
            <button type="button" onClick={() => watch(next)} className={buttonClass('secondary', 'sm')}>
              <Play size={11} weight="fill" />
              {t('onb2.checklist.watch', { count: next.minutes })}
            </button>
          </div>
        </div>
      </div>

      <ol className="mt-2 px-2 pb-2">
        {steps
          .filter((s) => s.id !== next.id)
          .map((step) => {
            const Icon = STEP_ICON[step.id] ?? Check
            const finished = step.completed && !step.skipped
            return (
              <li key={step.id} data-step={step.id} data-state={finished ? 'done' : step.skipped ? 'skipped' : 'open'}>
                <div className="flex items-center gap-3 rounded-xl px-3 py-2">
                  <span
                    className={[
                      'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
                      finished ? 'bg-emerald-50 text-emerald-600' : 'bg-neutral-100 text-neutral-500',
                    ].join(' ')}
                  >
                    {finished ? <Check size={15} weight="bold" /> : <Icon size={16} weight="duotone" />}
                  </span>
                  <Link
                    href={hrefOf(step)}
                    target={step.hrefType === 'root' ? '_blank' : undefined}
                    onClick={(e) => doIt(step, e)}
                    className={[
                      'min-w-0 flex-1 truncate text-sm font-medium hover:underline underline-offset-2',
                      step.completed ? 'text-neutral-400' : 'text-neutral-900',
                    ].join(' ')}
                  >
                    {t(`onboarding.steps.${step.id}.title`)}
                  </Link>
                  {step.completed ? (
                    <span className="shrink-0 text-[11px] text-neutral-400">{step.skipped ? t('onboarding.skipped') : t('onboarding.done_label')}</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => watch(step)}
                      className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800"
                    >
                      <Play size={10} weight="fill" />
                      {t('onboarding.minutes', { count: step.minutes })}
                    </button>
                  )}
                </div>
              </li>
            )
          })}
      </ol>

      <div className="flex flex-wrap items-center gap-2 border-t border-neutral-100 px-5 py-3">
        <button type="button" onClick={() => openInviteDialog('link')} className={buttonClass('ghost', 'sm')}>
          <UserPlus size={13} />
          {t('onb2.checklist.invite')}
        </button>
        <button type="button" onClick={() => openInviteDialog('csv')} className={buttonClass('ghost', 'sm')}>
          <FileCsv size={13} />
          {t('onb2.checklist.import')}
        </button>
      </div>

      <Modal
        isDialogOpen={!!watching}
        onOpenChange={(open) => !open && setWatching(null)}
        size="lg"
        dialogTitle={watching?.title}
        dialogContent={watching ? <OnboardingVideo id={watching.video} autoPlayMuted /> : null}
      />
    </Panel>
  )
}
