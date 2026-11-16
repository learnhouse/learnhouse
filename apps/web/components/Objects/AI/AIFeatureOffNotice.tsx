'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { Prohibit } from '@phosphor-icons/react'
import type { AIFeatureKey } from '@/lib/ai/aiFeatures'

/**
 * "Turned off by your admin": shown where an AI entry point would otherwise
 * be (a deep link, an empty panel) after an org admin switched it off in
 * Settings > AI. `compact` is a one-line chip-sized hint.
 */
export default function AIFeatureOffNotice({
  feature,
  compact = false,
  className = '',
}: {
  feature?: AIFeatureKey
  compact?: boolean
  className?: string
}) {
  const { t } = useTranslation()
  const name = feature ? t(`dashboard.organization.ai.features.${feature}.title`) : t('dashboard.organization.ai.title')

  if (compact) {
    return (
      <span
        data-testid="ai-off-notice"
        className={`inline-flex items-center gap-1.5 rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-500 ring-1 ring-inset ring-neutral-900/5 ${className}`}
      >
        <Prohibit size={12} weight="bold" />
        {t('dashboard.organization.ai.off_by_admin')}
      </span>
    )
  }

  return (
    <div
      data-testid="ai-off-notice"
      role="status"
      className={`w-full max-w-md rounded-2xl bg-white p-6 text-center nice-shadow ${className}`}
    >
      <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-neutral-100 text-neutral-500">
        <Prohibit size={20} weight="bold" />
      </div>
      <p className="text-sm font-semibold text-neutral-900">{t('dashboard.organization.ai.off_by_admin')}</p>
      <p className="mt-1 text-sm text-neutral-500">
        {t('dashboard.organization.ai.off_by_admin_description', { feature: name })}
      </p>
    </div>
  )
}
