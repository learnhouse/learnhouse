'use client'
import React from 'react'
import { motion } from 'motion/react'
import Link from 'next/link'
import { ListChecks, ArrowRight } from '@phosphor-icons/react'
import { useOnboarding } from '@components/Hooks/useOnboarding'
import { useOrg } from '@components/Contexts/OrgContext'
import { getUriWithOrg } from '@services/config/config'
import { useTranslation } from 'react-i18next'

/**
 * Compact onboarding progress for the dark dashboard sidebar. Borderless and
 * smooth; the thin line across the TOP doubles as the progress bar. Sits in the
 * search slot and replaces it until setup is complete / dismissed, then the
 * search box returns. The next step stays visible inline (no hover needed).
 */
export default function OnboardingSidebarBox() {
  const { steps, currentStep, allCompleted, dismissed, welcomeSeen } = useOnboarding()
  const { t } = useTranslation()
  const org = useOrg() as any
  const orgSlug = org?.slug || ''

  if (dismissed || !welcomeSeen || allCompleted || !currentStep) return null

  const completedCount = steps.filter((s) => s.completed).length
  const href = getUriWithOrg(orgSlug, '/dash/onboarding')

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0.25, 0.1, 0.25, 1] }}
      className="rounded-xl bg-white/[0.04] px-3 py-2.5 ring-1 ring-inset ring-white/[0.06]"
    >
      {/* Neutral like the rest of the sidebar: colored gradients are for AI. */}
      <div className="flex items-center gap-2">
        <ListChecks size={14} weight="bold" className="text-white/50 shrink-0" />
        <span className="text-[11px] font-semibold text-white/70 flex-1 truncate">
          {t('onboarding.box_title', { defaultValue: 'Onboarding' })}
        </span>
        <span className="text-[11px] text-white/40 tabular-nums shrink-0">
          {completedCount}/{steps.length}
        </span>
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full bg-white/60 transition-[width] duration-500" style={{ width: `${Math.max((completedCount / Math.max(steps.length, 1)) * 100, 4)}%` }} />
      </div>
      <p className="mt-2 text-[12px] leading-snug text-white/75 truncate">
        {t(`onboarding.steps.${currentStep.id}.title`, { defaultValue: currentStep.title })}
      </p>
      <Link
        href={href}
        className="group mt-2 flex items-center justify-center gap-1.5 w-full rounded-lg bg-white/[0.08] hover:bg-white/[0.12] text-white/90 text-[12px] font-medium py-1.5 transition-colors"
      >
        {t('onboarding.continue_setup', { defaultValue: 'Continue setup' })}
        <ArrowRight size={12} weight="bold" className="transition-transform group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5" data-dir-flip />
      </Link>
    </motion.div>
  )
}
