'use client'

import React from 'react'
import { motion, AnimatePresence } from 'motion/react'
import {
  X,
  ArrowRight,
  Notebook,
  UsersThree,
  ChatsCircle,
  CreditCard,
  Microphone,
  ChartBar,
  Robot,
  Certificate,
  ShieldCheck,
  Globe,
  Lightning,
  Code,
  CheckCircle,
} from '@phosphor-icons/react'
import { useOrg } from '@components/Contexts/OrgContext'
import { getUpgradeUrl } from '@services/config/config'
import { usePlan } from '@components/Hooks/usePlan'
import PlanBadge from './PlanBadge'
import { useTranslation } from 'react-i18next'

const ease = [0.16, 1, 0.3, 1] as const

interface UpgradeModalProps {
  open: boolean
  onClose: () => void
}

const STANDARD_HIGHLIGHTS = [
  { icon: Notebook, labelKey: 'upgrade_modal.plans.standard.highlights.courses', descKey: 'upgrade_modal.plans.standard.highlights.courses_desc', iconColor: 'text-blue-500' },
  { icon: UsersThree, labelKey: 'upgrade_modal.plans.standard.highlights.members', descKey: 'upgrade_modal.plans.standard.highlights.members_desc', iconColor: 'text-indigo-500' },
  { icon: CreditCard, labelKey: 'upgrade_modal.plans.standard.highlights.payments', descKey: 'upgrade_modal.plans.standard.highlights.payments_desc', iconColor: 'text-emerald-500' },
  { icon: ChatsCircle, labelKey: 'upgrade_modal.plans.standard.highlights.communities', descKey: 'upgrade_modal.plans.standard.highlights.communities_desc', iconColor: 'text-teal-500' },
  { icon: Microphone, labelKey: 'upgrade_modal.plans.standard.highlights.podcasts', descKey: 'upgrade_modal.plans.standard.highlights.podcasts_desc', iconColor: 'text-purple-500' },
  { icon: Robot, labelKey: 'upgrade_modal.plans.standard.highlights.ai', descKey: 'upgrade_modal.plans.standard.highlights.ai_desc', iconColor: 'text-violet-500' },
  { icon: ChartBar, labelKey: 'upgrade_modal.plans.standard.highlights.analytics', descKey: 'upgrade_modal.plans.standard.highlights.analytics_desc', iconColor: 'text-amber-500' },
]

const PRO_HIGHLIGHTS = [
  { icon: UsersThree, labelKey: 'upgrade_modal.plans.pro.highlights.members', descKey: 'upgrade_modal.plans.pro.highlights.members_desc', iconColor: 'text-indigo-500' },
  { icon: Robot, labelKey: 'upgrade_modal.plans.pro.highlights.ai', descKey: 'upgrade_modal.plans.pro.highlights.ai_desc', iconColor: 'text-violet-500' },
  { icon: Certificate, labelKey: 'upgrade_modal.plans.pro.highlights.certifications', descKey: 'upgrade_modal.plans.pro.highlights.certifications_desc', iconColor: 'text-sky-500' },
  { icon: Globe, labelKey: 'upgrade_modal.plans.pro.highlights.custom_domain', descKey: 'upgrade_modal.plans.pro.highlights.custom_domain_desc', iconColor: 'text-cyan-500' },
  { icon: ShieldCheck, labelKey: 'upgrade_modal.plans.pro.highlights.roles', descKey: 'upgrade_modal.plans.pro.highlights.roles_desc', iconColor: 'text-rose-500' },
  { icon: Lightning, labelKey: 'upgrade_modal.plans.pro.highlights.playgrounds', descKey: 'upgrade_modal.plans.pro.highlights.playgrounds_desc', iconColor: 'text-amber-500' },
  { icon: Code, labelKey: 'upgrade_modal.plans.pro.highlights.api', descKey: 'upgrade_modal.plans.pro.highlights.api_desc', iconColor: 'text-gray-500' },
]

export default function UpgradeModal({ open, onClose }: UpgradeModalProps) {
  const { t } = useTranslation()
  const org = useOrg() as any
  const upgradeUrl = getUpgradeUrl(org?.slug || 'default')
  const currentPlan = usePlan()

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          className="fixed inset-0 z-[100] flex items-center justify-center"
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/15 backdrop-blur-[2px]" onClick={onClose} />

          {/* Modal */}
          <motion.div
            initial={{ y: 20, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 10, opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.35, ease }}
            className="relative w-full max-w-3xl mx-4 max-h-[90vh] overflow-y-auto"
          >
            <div className="bg-white rounded-2xl nice-shadow relative overflow-hidden">
              {/* Close button */}
              <button
                onClick={onClose}
                className="absolute top-4 end-4 z-10 p-1.5 text-gray-400 hover:text-gray-600 rounded-lg transition-colors"
              >
                <X size={18} weight="bold" />
              </button>

              {/* Header */}
              <div className="px-10 pt-10 pb-2 text-center">
                <h1 className="text-2xl font-bold text-gray-900 tracking-tight">
                  {t('upgrade_modal.title')}
                </h1>
                <p className="text-sm text-gray-400 mt-2 max-w-md mx-auto">
                  {t('upgrade_modal.subtitle')}
                </p>
              </div>

              {/* Free plan context */}
              <div className="mx-6 mt-4 mb-2 flex items-center justify-center text-[11px] text-gray-400">
                <span>{t('upgrade_modal.current_free_limits')}</span>
              </div>

              {/* Plans */}
              <div className="px-6 py-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-stretch">
                  {/* Standard */}
                  <div className="relative rounded-xl overflow-hidden border border-gray-100 bg-gray-50/30 flex flex-col">
                    <div
                      className="absolute inset-0 pointer-events-none"
                      style={{
                        backgroundImage: `radial-gradient(circle, rgba(59,130,246,0.05) 1px, transparent 1px)`,
                        backgroundSize: '10px 10px',
                      }}
                    />
                    <div className="relative p-5 flex flex-col flex-1">
                      <div className="mb-3">
                        <PlanBadge currentPlan={currentPlan} requiredPlan="standard" size="md" alwaysShow noMargin />
                      </div>
                      <p className="text-[13px] font-medium text-gray-600 mb-4 leading-snug">
                        {t('upgrade_modal.plans.standard.goal')}
                      </p>

                      <div className="space-y-3 flex-1">
                        {STANDARD_HIGHLIGHTS.map((h) => (
                          <div key={h.labelKey} className="flex items-start gap-2">
                            <h.icon size={15} weight="duotone" className={`flex-shrink-0 mt-0.5 ${h.iconColor}`} />
                            <div>
                              <span className="text-xs font-semibold text-gray-700 block">{t(h.labelKey)}</span>
                              <span className="text-[11px] text-gray-400 leading-snug block">{t(h.descKey)}</span>
                            </div>
                          </div>
                        ))}
                      </div>

                      <a
                        href={upgradeUrl || '#'}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-5 w-full flex items-center justify-center gap-2 py-2.5 text-xs font-semibold rounded-lg transition-colors bg-black hover:bg-gray-800 text-white"
                      >
                        {t('upgrade_modal.choose_plan', { plan: 'Standard' })}
                        <ArrowRight size={14} weight="bold" />
                      </a>
                    </div>
                  </div>

                  {/* Pro */}
                  <div className="relative rounded-xl overflow-hidden border border-gray-100 bg-gray-50/30 flex flex-col">
                    <div
                      className="absolute inset-0 pointer-events-none"
                      style={{
                        backgroundImage: `repeating-linear-gradient(-45deg, transparent, transparent 6px, rgba(139,92,246,0.04) 6px, rgba(139,92,246,0.04) 7px)`,
                      }}
                    />
                    <div className="relative p-5 flex flex-col flex-1">
                      <div className="mb-3">
                        <PlanBadge currentPlan={currentPlan} requiredPlan="pro" size="md" alwaysShow noMargin />
                      </div>
                      <p className="text-[13px] font-medium text-gray-600 mb-4 leading-snug">
                        {t('upgrade_modal.plans.pro.goal')}
                      </p>

                      {/* Standard included */}
                      <div className="flex items-center gap-1.5 mb-3 pb-3 border-b border-gray-100">
                        <CheckCircle size={14} weight="duotone" className="text-emerald-400 flex-shrink-0" />
                        <span className="text-[11px] font-medium text-gray-400">{t('upgrade_modal.plans.pro.includes_standard')}</span>
                      </div>

                      <div className="space-y-3 flex-1">
                        {PRO_HIGHLIGHTS.map((h) => (
                          <div key={h.labelKey} className="flex items-start gap-2">
                            <h.icon size={15} weight="duotone" className={`flex-shrink-0 mt-0.5 ${h.iconColor}`} />
                            <div>
                              <span className="text-xs font-semibold text-gray-700 block">{t(h.labelKey)}</span>
                              <span className="text-[11px] text-gray-400 leading-snug block">{t(h.descKey)}</span>
                            </div>
                          </div>
                        ))}
                      </div>

                      <a
                        href={upgradeUrl || '#'}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-5 w-full flex items-center justify-center gap-2 py-2.5 text-xs font-semibold rounded-lg transition-colors bg-black hover:bg-gray-800 text-white"
                      >
                        {t('upgrade_modal.choose_plan', { plan: 'Pro' })}
                        <ArrowRight size={14} weight="bold" />
                      </a>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
