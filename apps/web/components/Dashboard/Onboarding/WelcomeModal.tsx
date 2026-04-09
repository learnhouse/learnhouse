'use client'
import React, { useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { useOnboarding } from '@components/Hooks/useOnboarding'
import {
  ArrowRight,
  BookOpen,
  Lightning,
  Users,
  Microphone,
  ChalkboardSimple,
  ChatsCircle,
  Files,
  Certificate,
  ChartBar,
} from '@phosphor-icons/react'
import WelcomeGlobe from './WelcomeGlobe'
import { useTranslation } from 'react-i18next'

const ease = [0.16, 1, 0.3, 1] as const

const FEATURES = [
  {
    icon: BookOpen,
    labelKey: 'onboarding.welcome.features.teach',
    descKey: 'onboarding.welcome.features.teach_desc',
    gradient: 'from-blue-50/40 to-blue-50/10',
    iconColor: 'text-blue-500',
    pattern: `radial-gradient(circle, rgba(59,130,246,0.08) 1px, transparent 1px)`,
    patternSize: '10px 10px',
  },
  {
    icon: Lightning,
    labelKey: 'onboarding.welcome.features.interactive',
    descKey: 'onboarding.welcome.features.interactive_desc',
    gradient: 'from-amber-50/40 to-amber-50/10',
    iconColor: 'text-amber-500',
    pattern: `repeating-linear-gradient(-45deg, transparent, transparent 6px, rgba(245,158,11,0.06) 6px, rgba(245,158,11,0.06) 7px)`,
  },
  {
    icon: ChatsCircle,
    labelKey: 'onboarding.welcome.features.community',
    descKey: 'onboarding.welcome.features.community_desc',
    gradient: 'from-emerald-50/40 to-emerald-50/10',
    iconColor: 'text-emerald-500',
    pattern: `radial-gradient(circle, rgba(16,185,129,0.08) 1px, transparent 1px)`,
    patternSize: '10px 10px',
  },
  {
    icon: Files,
    labelKey: 'onboarding.welcome.features.assess',
    descKey: 'onboarding.welcome.features.assess_desc',
    gradient: 'from-violet-50/40 to-violet-50/10',
    iconColor: 'text-violet-500',
    pattern: `repeating-linear-gradient(45deg, transparent, transparent 6px, rgba(139,92,246,0.06) 6px, rgba(139,92,246,0.06) 7px)`,
  },
  {
    icon: ChalkboardSimple,
    labelKey: 'onboarding.welcome.features.collaborate',
    descKey: 'onboarding.welcome.features.collaborate_desc',
    gradient: 'from-rose-50/40 to-rose-50/10',
    iconColor: 'text-rose-500',
    pattern: `repeating-linear-gradient(0deg, transparent, transparent 8px, rgba(244,63,94,0.05) 8px, rgba(244,63,94,0.05) 9px), repeating-linear-gradient(90deg, transparent, transparent 8px, rgba(244,63,94,0.05) 8px, rgba(244,63,94,0.05) 9px)`,
  },
  {
    icon: Microphone,
    labelKey: 'onboarding.welcome.features.voice',
    descKey: 'onboarding.welcome.features.voice_desc',
    gradient: 'from-purple-50/40 to-purple-50/10',
    iconColor: 'text-purple-500',
    pattern: `radial-gradient(circle, rgba(168,85,247,0.06) 1.5px, transparent 1.5px)`,
    patternSize: '12px 12px',
  },
  {
    icon: Certificate,
    labelKey: 'onboarding.welcome.features.certify',
    descKey: 'onboarding.welcome.features.certify_desc',
    gradient: 'from-sky-50/40 to-sky-50/10',
    iconColor: 'text-sky-500',
    pattern: `repeating-linear-gradient(135deg, transparent, transparent 6px, rgba(14,165,233,0.06) 6px, rgba(14,165,233,0.06) 7px)`,
  },
  {
    icon: ChartBar,
    labelKey: 'onboarding.welcome.features.impact',
    descKey: 'onboarding.welcome.features.impact_desc',
    gradient: 'from-indigo-50/40 to-indigo-50/10',
    iconColor: 'text-indigo-500',
    pattern: `radial-gradient(circle, rgba(99,102,241,0.06) 1px, transparent 1px), radial-gradient(circle, rgba(99,102,241,0.04) 1.5px, transparent 1.5px)`,
    patternSize: '10px 10px',
  },
  {
    icon: Users,
    labelKey: 'onboarding.welcome.features.team',
    descKey: 'onboarding.welcome.features.team_desc',
    gradient: 'from-teal-50/40 to-teal-50/10',
    iconColor: 'text-teal-500',
    pattern: `repeating-linear-gradient(-45deg, transparent, transparent 8px, rgba(20,184,166,0.05) 8px, rgba(20,184,166,0.05) 9px)`,
  },
]

export default function WelcomeModal() {
  const { welcomeSeen, markWelcomeSeen, dismissed } = useOnboarding()
  const { t } = useTranslation()
  const [step, setStep] = useState<'welcome' | 'features'>('welcome')

  if (welcomeSeen || dismissed) return null

  const showFeatures = step === 'features'

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.4 }}
        className="fixed inset-0 z-[100] flex items-center justify-center"
      >
        {/* Backdrop */}
        <div className="absolute inset-0 bg-black/15 backdrop-blur-[2px]" />

        {/* Modal */}
        <motion.div
          initial={{ y: 30, opacity: 0, scale: 0.97 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, ease }}
          className="relative w-full max-w-3xl mx-4"
        >
          <div className="bg-white rounded-2xl nice-shadow relative overflow-hidden">
            {/* Top content */}
            <AnimatePresence mode="wait">
              {!showFeatures ? (
                <motion.div
                  key="welcome-top"
                  exit={{ opacity: 0, y: -20 }}
                  transition={{ duration: 0.3, ease }}
                >
                  <div className="px-10 pt-10 pb-2 text-center">
                    <motion.img
                      src="/lrn-dash.svg"
                      alt="LearnHouse"
                      className="h-12 w-12 mx-auto mb-5"
                      style={{ filter: 'brightness(0)' }}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.2, duration: 0.5, ease }}
                    />
                    <motion.h1
                      className="text-2xl font-bold text-gray-900 tracking-tight"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.3, duration: 0.5, ease }}
                    >
                      {t('onboarding.welcome.title')}
                    </motion.h1>
                    <motion.p
                      className="text-sm text-gray-400 mt-2"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 0.45, duration: 0.5 }}
                    >
                      {t('onboarding.welcome.subtitle')}
                    </motion.p>
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key="features-top"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, ease }}
                >
                  <div className="px-10 pt-8 pb-4 text-center">
                    <h2 className="text-2xl font-bold text-gray-900 tracking-tight">
                      {t('onboarding.welcome.features_title')}
                    </h2>
                    <p className="text-sm text-gray-400 mt-2">
                      {t('onboarding.welcome.features_subtitle')}
                    </p>
                  </div>

                  {/* Feature grid */}
                  <div className="px-6 pb-4">
                    <div className="grid grid-cols-3 gap-2">
                      {FEATURES.map((f, i) => (
                        <motion.div
                          key={f.labelKey}
                          initial={{ opacity: 0, y: 12 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: 0.1 + i * 0.04, duration: 0.4, ease }}
                          className={`relative flex flex-col items-center gap-2.5 p-5 rounded-xl overflow-hidden nice-shadow bg-gradient-to-br ${f.gradient}`}
                        >
                          {/* Pattern overlay */}
                          <div
                            className="absolute inset-0"
                            style={{
                              backgroundImage: f.pattern,
                              backgroundSize: f.patternSize || 'auto',
                            }}
                          />
                          <div className="relative">
                            <f.icon size={28} weight="duotone" className={f.iconColor} />
                          </div>
                          <div className="relative text-center">
                            <p className="text-sm font-semibold text-gray-700">{t(f.labelKey)}</p>
                            <p className="text-xs text-gray-500 mt-0.5 leading-snug">{t(f.descKey)}</p>
                          </div>
                        </motion.div>
                      ))}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Globe */}
            <motion.div
              className="flex justify-center -mb-[140px]"
              animate={{ marginTop: showFeatures ? -20 : 0 }}
              transition={{ duration: 0.6, ease }}
            >
              <div className="w-[280px]">
                <WelcomeGlobe />
              </div>
            </motion.div>

            {/* Button */}
            <div className="relative z-10 px-6 pb-6">
              {!showFeatures ? (
                <motion.button
                  onClick={() => setStep('features')}
                  className="w-full flex items-center justify-center gap-2 py-3 text-sm font-semibold text-white bg-black rounded-lg hover:bg-gray-800 transition-colors"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.6, duration: 0.4, ease }}
                >
                  {t('onboarding.welcome.get_started')}
                  <ArrowRight size={16} weight="bold" />
                </motion.button>
              ) : (
                <button
                  onClick={() => markWelcomeSeen()}
                  className="w-full flex items-center justify-center gap-2 py-3 text-sm font-semibold text-white bg-black rounded-lg hover:bg-gray-800 transition-colors"
                >
                  {t('onboarding.welcome.lets_go')}
                  <ArrowRight size={16} weight="bold" />
                </button>
              )}
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
