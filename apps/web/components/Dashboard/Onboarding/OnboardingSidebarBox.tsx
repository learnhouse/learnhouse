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
      className="relative"
    >
      {/* Blueprint grid — purple, edge-to-edge, fading down from the top border
          (same motif as the upgrade box, in the onboarding's violet tone). */}
      <div
        className="absolute -left-3 -right-3 -top-2 bottom-0 pointer-events-none"
        style={{
          backgroundImage: `
            linear-gradient(rgba(139,92,246,0.10) 1px, transparent 1px),
            linear-gradient(90deg, rgba(139,92,246,0.10) 1px, transparent 1px),
            linear-gradient(rgba(139,92,246,0.05) 1px, transparent 1px),
            linear-gradient(90deg, rgba(139,92,246,0.05) 1px, transparent 1px)`,
          backgroundSize: '40px 40px, 40px 40px, 10px 10px, 10px 10px',
          maskImage: 'linear-gradient(to bottom, black 0%, transparent 82%)',
          WebkitMaskImage: 'linear-gradient(to bottom, black 0%, transparent 82%)',
        }}
      />
      {/* Purple glow blooming down from the progress border. */}
      <div
        className="absolute -left-3 -right-3 -top-2 h-16 pointer-events-none"
        style={{
          background:
            'radial-gradient(110% 90% at 50% 0%, rgba(139,92,246,0.20), rgba(99,102,241,0.05) 45%, transparent 78%)',
        }}
      />

      <div className="relative">
        {/* Header — uppercase label, count right on the same line */}
        <div className="flex items-center gap-2">
          <ListChecks size={14} weight="bold" className="text-violet-300 shrink-0" />
          <span className="text-[11px] font-bold uppercase tracking-wider text-violet-300 flex-1 truncate">
            {t('onboarding.box_title', { defaultValue: 'Onboarding' })}
          </span>
          <span className="text-[11px] text-white/35 tabular-nums shrink-0">
            {completedCount}/{steps.length}
          </span>
        </div>

        {/* Up-next step — eyebrow + title */}
        <div className="mt-2.5">
          <p className="text-[9px] font-bold uppercase tracking-wider text-white/30">
            {t('onboarding.up_next', { defaultValue: 'Up next' })}
          </p>
          <p className="mt-0.5 text-[12px] font-medium leading-snug text-white/80 truncate">
            {currentStep.title}
          </p>
        </div>

        {/* CTA button */}
        <Link
          href={href}
          className="group mt-3 flex items-center justify-center gap-1.5 w-full rounded-lg bg-indigo-500 hover:bg-indigo-400 text-white text-[12px] font-semibold py-2 transition-colors"
        >
          {t('onboarding.continue_setup', { defaultValue: 'Continue setup' })}
          <ArrowRight size={12} weight="bold" className="transition-transform group-hover:translate-x-0.5" />
        </Link>
      </div>
    </motion.div>
  )
}
