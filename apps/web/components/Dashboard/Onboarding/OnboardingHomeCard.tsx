'use client'
import React from 'react'
import Link from 'next/link'
import { ArrowRight, Play, X } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { useOnboarding } from '@components/Hooks/useOnboarding'
import { useOrg } from '@components/Contexts/OrgContext'
import { getUriWithOrg } from '@services/config/config'
import { onboardingVideo } from './onboardingMedia'

/**
 * The launch plan on the dashboard home, until setup is done: progress, the
 * next step with its walkthrough, and the way back in.
 */
export default function OnboardingHomeCard() {
  const { t } = useTranslation()
  const { steps, currentStep, progress, minutesLeft, dismissed, welcomeSeen, allCompleted, dismiss } = useOnboarding()
  const org = useOrg() as any
  if (dismissed || !welcomeSeen || allCompleted || !currentStep) return null

  const href = getUriWithOrg(org?.slug || '', '/dash/onboarding')
  const done = steps.filter((s) => s.completed).length

  return (
    <div className="bg-white rounded-xl nice-shadow overflow-hidden">
      <div className="flex items-center justify-between px-5 pt-4 pb-3">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold text-gray-700">{t('onboarding.launch_plan')}</h3>
          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 tabular-nums">
            {done}/{steps.length}
          </span>
          <span className="hidden sm:inline text-[11px] text-gray-400">{t('onboarding.minutes_left', { count: minutesLeft })}</span>
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="text-gray-300 hover:text-gray-500 transition-colors"
          aria-label={t('onboarding.dismiss')}
          title={t('onboarding.dismiss')}
        >
          <X size={14} weight="bold" />
        </button>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center gap-4 px-5 pb-5">
        <Link href={href} className="group relative aspect-video w-full sm:w-40 shrink-0 overflow-hidden rounded-lg bg-gray-100">
          <img
            src={onboardingVideo(currentStep.video).poster}
            alt=""
            onError={(e) => (e.currentTarget.style.visibility = 'hidden')}
            className="h-full w-full object-cover"
          />
          <span className="absolute inset-0 flex items-center justify-center bg-black/10 group-hover:bg-black/20 transition-colors">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white nice-shadow">
              <Play size={12} weight="fill" className="text-gray-900" />
            </span>
          </span>
        </Link>

        <div className="min-w-0 flex-1">
          <p className="text-xs text-gray-400">{t('onboarding.up_next')}</p>
          <p className="mt-0.5 truncate text-sm font-semibold text-gray-900">{t(`onboarding.steps.${currentStep.id}.title`)}</p>
          <div className="mt-3 h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-gray-100">
            <div
              className="h-full rounded-full bg-black transition-[width] duration-500"
              style={{ width: `${Math.max(progress * 100, 3)}%` }}
            />
          </div>
        </div>

        <Link
          href={href}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-black px-4 py-2 text-xs font-bold text-white nice-shadow hover:bg-gray-800 transition-colors"
        >
          {t('onboarding.continue_setup')}
          <ArrowRight size={13} weight="bold" data-dir-flip />
        </Link>
      </div>
    </div>
  )
}
