'use client'
import React, { useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import Link from 'next/link'
import { useOnboarding } from '@components/Hooks/useOnboarding'
import {
  BookOpen,
  Browsers,
  Palette,
  ShareNetwork,
  UserPlus,
  ChatsCircle,
  Check,
  ArrowRight,
  ArrowUpRight,
  Play,
  CaretDown,
} from '@phosphor-icons/react'
import { useOrg } from '@components/Contexts/OrgContext'
import { getUriWithOrg } from '@services/config/config'
import { useTranslation } from 'react-i18next'
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics'

// Shared easing — the same curve used across all onboarding animations.
export const ease = [0.25, 0.1, 0.25, 1] as const

const STEP_ICON: Record<string, { icon: React.ElementType; color: string }> = {
  create_course: { icon: BookOpen, color: 'text-blue-500' },
  add_content: { icon: Browsers, color: 'text-violet-500' },
  brand_school: { icon: Palette, color: 'text-rose-500' },
  share_grow: { icon: ShareNetwork, color: 'text-emerald-500' },
  invite_learners: { icon: UserPlus, color: 'text-sky-500' },
  build_community: { icon: ChatsCircle, color: 'text-indigo-500' },
}

/**
 * Numbered step-by-step growth guide (full-page). A left timeline (numbered
 * nodes + connecting line) makes the sequence explicit; the cards on the right
 * are an accordion — only one step open at a time (the current step by default)
 * showing its walkthrough video + action. Matches the app's card styling.
 */
export default function OnboardingSteps() {
  const { steps, completeStep, dismiss } = useOnboarding()
  const { t } = useTranslation()
  const { track } = useLHAnalytics('dashboard')
  const org = useOrg() as any
  const orgSlug = org?.slug || ''

  const activeId = steps.find((s) => !s.completed)?.id ?? null
  const [openId, setOpenId] = useState<string | null | undefined>(undefined)
  const expandedId = openId === undefined ? activeId : openId
  const toggle = (id: string) => setOpenId(expandedId === id ? null : id)

  return (
    <div>
      <div>
        {steps.map((step, index) => {
          const meta = STEP_ICON[step.id]
          const Icon = meta?.icon || BookOpen
          const isExpanded = !step.completed && expandedId === step.id
          const isActive = step.id === activeId
          const isLast = index === steps.length - 1
          const target =
            step.hrefType === 'root' ? getUriWithOrg(orgSlug, '/') : getUriWithOrg(orgSlug, step.href)

          return (
            <motion.div
              key={step.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, ease, delay: index * 0.04 }}
              className="relative flex gap-4"
            >
              {/* Numbered timeline gutter */}
              <div className="flex flex-col items-center pt-4">
                <div
                  className={[
                    'flex items-center justify-center w-9 h-9 rounded-full shrink-0 text-[14px] font-bold transition-colors',
                    step.completed
                      ? 'bg-emerald-50 text-emerald-500'
                      : isActive
                        ? 'bg-gray-900 text-white'
                        : 'bg-white border border-gray-200 text-gray-400',
                  ].join(' ')}
                >
                  {step.completed ? <Check size={16} weight="bold" /> : index + 1}
                </div>
                {!isLast && <div className="w-px flex-1 my-2 bg-gray-200" />}
              </div>

              {/* Card */}
              <div className="flex-1 min-w-0 pb-3">
                <div
                  className={[
                    'rounded-xl overflow-hidden transition-shadow',
                    step.completed
                      ? 'bg-gray-50/70'
                      : 'bg-white nice-shadow hover:shadow-lg hover:shadow-gray-200/60',
                  ].join(' ')}
                >
                  {/* Header row */}
                  <button
                    type="button"
                    onClick={() => !step.completed && toggle(step.id)}
                    disabled={step.completed}
                    className="w-full flex items-center gap-3.5 px-5 py-4 text-left"
                  >
                    <Icon
                      size={20}
                      weight="duotone"
                      className={`shrink-0 ${step.completed ? 'text-gray-300' : meta?.color || 'text-gray-400'}`}
                    />
                    <div className="flex-1 min-w-0">
                      <h3
                        className={
                          step.completed
                            ? 'text-[15px] font-semibold text-gray-400 line-through truncate'
                            : 'text-[15px] font-semibold text-gray-900 truncate'
                        }
                      >
                        {t(`onboarding.steps.${step.id}.title`, { defaultValue: step.title })}
                      </h3>
                      {!isExpanded && !step.completed && (
                        <p className="mt-0.5 text-[13px] text-gray-500 truncate">
                          {t(`onboarding.steps.${step.id}.description`, { defaultValue: step.description })}
                        </p>
                      )}
                    </div>
                    {step.completed ? (
                      <span className="shrink-0 inline-flex items-center gap-1 text-[12px] font-semibold text-emerald-500">
                        <Check size={13} weight="bold" />
                        {t('onboarding.done_label', { defaultValue: 'Done' })}
                      </span>
                    ) : (
                      <CaretDown
                        size={15}
                        weight="bold"
                        className={`shrink-0 text-gray-300 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                      />
                    )}
                  </button>

                  {/* Expanded body */}
                  <AnimatePresence initial={false}>
                    {isExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.28, ease }}
                      >
                        <div className="pr-5 pb-4 pl-[54px]">
                          <p className="text-[13px] text-gray-500 leading-relaxed -mt-1.5 mb-3">
                            {step.description}
                          </p>

                          {/* Walkthrough video placeholder */}
                          <div className="relative aspect-video w-full rounded-xl overflow-hidden bg-gradient-to-br from-gray-900 via-gray-900 to-gray-800">
                            <div
                              className="absolute inset-0 opacity-[0.12]"
                              style={{
                                backgroundImage:
                                  'linear-gradient(rgba(255,255,255,0.4) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.4) 1px, transparent 1px)',
                                backgroundSize: '24px 24px',
                              }}
                            />
                            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5">
                              <div className="flex items-center justify-center w-12 h-12 rounded-full bg-white/10 ring-1 ring-white/15 backdrop-blur-sm">
                                <Play size={20} weight="fill" className="text-white/90 translate-x-0.5" />
                              </div>
                              <span className="text-[11px] font-medium text-white/40">
                                {t('onboarding.video_placeholder', { defaultValue: 'Walkthrough video coming soon' })}
                              </span>
                            </div>
                          </div>

                          {/* Action */}
                          <div className="mt-3.5">
                            {step.completeOnClick ? (
                              <a
                                href={target}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={() => {
                                  track(AnalyticsEvent.OnboardingStepActionClicked, { step_id: step.id })
                                  completeStep(step.id)
                                }}
                                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-[13px] font-semibold text-white bg-gray-900 hover:bg-gray-800 transition-colors"
                              >
                                {step.action}
                                <ArrowUpRight size={14} weight="bold" />
                              </a>
                            ) : (
                              <Link
                                href={target}
                                onClick={() => track(AnalyticsEvent.OnboardingStepActionClicked, { step_id: step.id })}
                                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-[13px] font-semibold text-white bg-gray-900 hover:bg-gray-800 transition-colors"
                              >
                                {step.action}
                                <ArrowRight size={14} weight="bold" />
                              </Link>
                            )}
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </motion.div>
          )
        })}
      </div>

      {/* Finish later */}
      <div className="mt-3 pl-12">
        <button
          onClick={dismiss}
          className="text-[13px] font-medium text-gray-400 hover:text-gray-600 transition-colors"
        >
          {t('onboarding.dismiss', { defaultValue: "I'll finish later" })}
        </button>
      </div>
    </div>
  )
}
