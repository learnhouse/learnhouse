'use client'
import React from 'react'
import { motion } from 'motion/react'
import { ArrowDown, Check } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { Panel, Button } from '@/design'
import { useOnboarding } from '@components/Hooks/useOnboarding'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics'
import OnboardingVideo from './OnboardingVideo'
import WelcomeGlobe from './WelcomeGlobe'
import { WELCOME_VIDEO } from './onboardingMedia'
import { INTENTS } from './onboardingCopy'

const ease = [0.16, 1, 0.3, 1] as const

/**
 * The first thing on a new academy's dashboard: a warm hello, the one-minute
 * tour (plays muted straight away, one tap for sound) and, when the goal
 * wasn't picked at signup, that one question. It sits in the page instead of
 * covering it: skip it, and it can be watched again from the launch plan.
 */
export default function WelcomeTourCard() {
  const { t } = useTranslation()
  const { loaded, welcomeSeen, dismissed, markWelcomeSeen, intent, setIntent } = useOnboarding()
  const { track } = useLHAnalytics('dashboard')
  const session = useLHSession() as any
  const firstName = String(session?.data?.user?.first_name || '').trim().split(/\s+/)[0]

  if (!loaded || welcomeSeen || dismissed) return null

  const finish = (startPlan: boolean) => {
    track(AnalyticsEvent.OnboardingWelcomeCompleted, { intent: intent ?? 'none', started: startPlan })
    markWelcomeSeen()
    if (startPlan) document.getElementById('launch-plan')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease }}>
      <Panel className="relative overflow-hidden" data-testid="welcome-tour">
        <div className="grid gap-6 p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] lg:items-center">
          <div className="relative min-w-0">
            <img src="/lrn.svg" alt="" className="relative mb-4 h-9 w-9 lh-dark-invert" />
            <h2 className="relative text-2xl font-bold tracking-tight text-neutral-900">
              {firstName ? t('onboarding.welcome.hello_name', { name: firstName }) : t('onboarding.welcome.title')}
            </h2>
            <p className="mt-1.5 text-sm text-neutral-500">{t('onboarding.welcome.promise')}</p>

            {!intent && (
              <div className="mt-5">
                <p className="text-xs font-semibold text-neutral-700">{t('onboarding.welcome.intent_title')}</p>
                <div className="mt-2 flex flex-wrap gap-1.5" role="radiogroup">
                  {INTENTS.map((it) => (
                    <button
                      key={it.id}
                      type="button"
                      role="radio"
                      aria-checked={false}
                      onClick={() => {
                        setIntent(it.id)
                        track(AnalyticsEvent.OnboardingIntentSelected, { intent: it.id })
                      }}
                      className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 nice-shadow hover:bg-neutral-50"
                    >
                      <it.icon size={14} weight="duotone" />
                      {t(`onboarding.intent.${it.id}.label`)}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {intent && (
              <p className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-neutral-100 px-3 py-1 text-xs font-medium text-neutral-700">
                <Check size={12} weight="bold" />
                {t(`onboarding.intent.${intent}.headline`)}
              </p>
            )}

            <div className="relative z-10 mt-6 flex flex-wrap items-center gap-2">
              <Button variant="primary" icon={<ArrowDown size={14} weight="bold" />} onClick={() => finish(true)}>
                {t('onboarding.welcome.build_plan')}
              </Button>
              <Button variant="ghost" onClick={() => finish(false)}>
                {t('onboarding.welcome.skip')}
              </Button>
            </div>

            {/* The globe rises behind the card's bottom edge, clear of the buttons. */}
            <div className="pointer-events-none absolute -bottom-[210px] end-0 hidden w-[220px] opacity-50 lg:block" aria-hidden>
              <WelcomeGlobe />
            </div>
          </div>
          <div className="min-w-0">
            <OnboardingVideo id={WELCOME_VIDEO} autoPlayMuted />
          </div>
        </div>
      </Panel>
    </motion.div>
  )
}
