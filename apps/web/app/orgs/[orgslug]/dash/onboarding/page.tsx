'use client'
import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RocketLaunch, Play } from '@phosphor-icons/react'
import { useOnboarding } from '@components/Hooks/useOnboarding'
import { Breadcrumbs } from '@components/Objects/Breadcrumbs/Breadcrumbs'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import LaunchPlan from '@components/Dashboard/Onboarding/LaunchPlan'
import OnboardingVideo from '@components/Dashboard/Onboarding/OnboardingVideo'
import { WELCOME_VIDEO } from '@components/Dashboard/Onboarding/onboardingMedia'

export default function OnboardingPage() {
  const { t } = useTranslation()
  const { loaded, steps, progress, allCompleted, minutesLeft, intent, dismissed, resume } = useOnboarding()
  const completedCount = steps.filter((s) => s.completed).length
  const [tour, setTour] = useState(false)

  // Opening the plan (from the sidebar, the home card or a link) brings it back
  // if it was put away.
  useEffect(() => {
    if (loaded && dismissed) resume()
  }, [loaded, dismissed, resume])

  return (
    <div className="h-full w-full bg-[#f8f8f8] ps-4 pe-4 sm:ps-10 sm:pe-10 pb-16">
      <div className="mb-6 pt-6">
        <Breadcrumbs
          items={[{ label: t('onboarding.launch_plan'), href: '/dash/onboarding', icon: <RocketLaunch size={14} /> }]}
        />
        <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-3xl font-bold">{t('onboarding.launch_plan')}</h1>
            {!allCompleted && (
              <p className="mt-1 text-sm text-gray-500">
                {intent ? t(`onboarding.intent.${intent}.headline`) : t('onboarding.subtitle')}
              </p>
            )}
          </div>

          {!allCompleted && (
            <div className="flex shrink-0 items-center gap-4">
              <div className="min-w-44">
                <div className="flex items-center justify-between gap-4 text-xs whitespace-nowrap">
                  <span className="font-medium text-gray-700 tabular-nums">
                    {t('onboarding.progress_count', { done: completedCount, total: steps.length })}
                  </span>
                  <span className="text-gray-400">{t('onboarding.minutes_left', { count: minutesLeft })}</span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-gray-200">
                  <div
                    className="h-full rounded-full bg-black transition-[width] duration-500"
                    style={{ width: `${Math.max(progress * 100, 3)}%` }}
                  />
                </div>
              </div>
              <Modal
                isDialogOpen={tour}
                onOpenChange={setTour}
                minWidth="lg"
                minHeight="no-min"
                dialogTitle={t('onboarding.tour_title')}
                dialogContent={<OnboardingVideo id={WELCOME_VIDEO} />}
                dialogTrigger={
                  <button
                    type="button"
                    className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-xs font-bold text-gray-700 nice-shadow hover:bg-gray-50 transition-colors"
                  >
                    <Play size={12} weight="fill" />
                    {t('onboarding.watch_tour')}
                  </button>
                }
              />
            </div>
          )}
        </div>
      </div>

      <LaunchPlan />
    </div>
  )
}
