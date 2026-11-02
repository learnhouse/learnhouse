'use client'
import React, { useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { useRouter } from 'next/navigation'
import { ArrowRight, Check } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { useOnboarding, OnboardingIntent } from '@components/Hooks/useOnboarding'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics'
import OnboardingVideo from './OnboardingVideo'
import WelcomeGlobe from './WelcomeGlobe'
import { WELCOME_VIDEO } from './onboardingMedia'
import { INTENTS } from './onboardingCopy'

const ease = [0.16, 1, 0.3, 1] as const

/**
 * First visit to the dashboard: a one-minute tour (plays muted straight away,
 * one tap for sound), then one question, what are you building, which shapes
 * the launch plan it hands over to.
 */
export default function WelcomeModal() {
  const { welcomeSeen, markWelcomeSeen, dismissed, setIntent, intent } = useOnboarding()
  const { t } = useTranslation()
  const { track } = useLHAnalytics('dashboard')
  const router = useRouter()
  const session = useLHSession() as any
  const firstName = session?.data?.user?.first_name || ''
  const [screen, setScreen] = useState<'tour' | 'intent'>('tour')
  const [choice, setChoice] = useState<OnboardingIntent | null>(intent)

  if (welcomeSeen || dismissed) return null

  const finish = (goToPlan: boolean) => {
    if (choice) {
      setIntent(choice)
      track(AnalyticsEvent.OnboardingIntentSelected, { intent: choice })
    }
    track(AnalyticsEvent.OnboardingWelcomeCompleted, { intent: choice ?? 'none' })
    markWelcomeSeen()
    // Relative on purpose: the dashboard is already on the org's host.
    if (goToPlan) router.push('/dash/onboarding')
  }

  const primary =
    'w-full flex items-center justify-center gap-2 py-3 text-sm font-semibold text-white bg-black rounded-lg hover:bg-gray-800 disabled:bg-gray-200 disabled:text-gray-400 transition-colors'

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4 }}
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center"
    >
      <div className="absolute inset-0 bg-black/15 backdrop-blur-[2px]" />

      <motion.div
        initial={{ y: 30, opacity: 0, scale: 0.97 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        transition={{ duration: 0.5, ease }}
        className="relative w-full sm:max-w-2xl sm:mx-4 max-h-[100dvh] overflow-y-auto"
      >
        <div className="bg-white rounded-t-2xl sm:rounded-2xl nice-shadow relative overflow-hidden">
          {/* Secondary action, kept clear of the globe */}
          <button
            type="button"
            onClick={() => (screen === 'tour' ? finish(false) : setScreen('tour'))}
            className={`absolute top-4 z-10 text-xs font-medium text-gray-400 hover:text-gray-600 transition-colors ${screen === 'tour' ? 'end-5' : 'start-5'}`}
          >
            {screen === 'tour' ? t('onboarding.welcome.skip') : t('onboarding.welcome.back')}
          </button>
          <AnimatePresence mode="wait" initial={false}>
            {screen === 'tour' ? (
              <motion.div
                key="tour"
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.25, ease }}
                className="px-6 sm:px-10 pt-8 sm:pt-10"
              >
                <div className="text-center">
                  <img src="/lrn-dash.svg" alt="LearnHouse" className="h-10 w-10 mx-auto mb-4" style={{ filter: 'brightness(0)' }} />
                  <h1 className="text-2xl font-bold text-gray-900 tracking-tight">
                    {firstName ? t('onboarding.welcome.hello_name', { name: firstName }) : t('onboarding.welcome.title')}
                  </h1>
                  <p className="text-sm text-gray-400 mt-2">{t('onboarding.welcome.promise')}</p>
                </div>
                <div className="mt-6">
                  <OnboardingVideo id={WELCOME_VIDEO} autoPlayMuted />
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="intent"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, ease }}
                className="px-6 sm:px-10 pt-8 sm:pt-10"
              >
                <div className="text-center">
                  <h2 className="text-2xl font-bold text-gray-900 tracking-tight">{t('onboarding.welcome.intent_title')}</h2>
                  <p className="text-sm text-gray-400 mt-2">{t('onboarding.welcome.intent_subtitle')}</p>
                </div>
                <div className="mt-6 grid gap-2 sm:grid-cols-2" role="radiogroup">
                  {INTENTS.map((it) => {
                    const on = choice === it.id
                    return (
                      <button
                        key={it.id}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        onClick={() => setChoice(it.id)}
                        className={[
                          'relative flex items-start gap-3 rounded-xl p-4 text-start transition-all',
                          on ? 'bg-white ring-2 ring-black' : 'bg-white nice-shadow hover:bg-gray-50',
                        ].join(' ')}
                      >
                        <it.icon size={22} weight="duotone" className="shrink-0 text-gray-700" />
                        <span className="min-w-0 pe-5">
                          <span className="block text-sm font-semibold text-gray-900">{t(`onboarding.intent.${it.id}.label`)}</span>
                          <span className="mt-0.5 block text-xs leading-snug text-gray-500">{t(`onboarding.intent.${it.id}.hint`)}</span>
                        </span>
                        {on && (
                          <span className="absolute top-3 end-3 flex h-4 w-4 items-center justify-center rounded-full bg-black text-white">
                            <Check size={10} weight="bold" />
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Globe, rising behind the button */}
          <div className="pointer-events-none flex justify-center -mb-[140px] mt-2" aria-hidden>
            <div className="w-[280px]">
              <WelcomeGlobe />
            </div>
          </div>

          <div className="relative z-10 px-6 pb-6">
            {screen === 'tour' ? (
              <button type="button" onClick={() => setScreen('intent')} className={primary}>
                {t('onboarding.welcome.get_started')}
                <ArrowRight size={16} weight="bold" data-dir-flip />
              </button>
            ) : (
              <button type="button" disabled={!choice} onClick={() => finish(true)} className={primary}>
                {t('onboarding.welcome.build_plan')}
                <ArrowRight size={16} weight="bold" data-dir-flip />
              </button>
            )}
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}
