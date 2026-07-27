'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'

/** Horizontal usage meter — ports the platform plan page's UsageBar. */
export default function UsageBar({
  label,
  icon,
  usage,
  limit,
  color,
  soft = false,
  footer,
}: {
  label: string
  icon: React.ReactNode
  usage: number
  limit: number | string
  color: string
  /**
   * Soft limits are billed, not blocked — paid plans allow going past the
   * member limit and charge for it. A soft bar never turns red and never says
   * "limit reached", because nothing is actually stopped.
   */
  soft?: boolean
  /** Replaces the default remaining/limit text under the bar. */
  footer?: React.ReactNode
}) {
  const { t } = useTranslation()
  const isUnlimited = limit === 'unlimited' || limit === 0
  const numericLimit = typeof limit === 'number' ? limit : 0
  const pct = isUnlimited ? 0 : Math.min(100, Math.round((usage / numericLimit) * 100))
  const isHigh = !soft && pct >= 80
  const isFull = !soft && pct >= 100

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className={`p-1.5 rounded-lg shrink-0 ${color}`}>{icon}</div>
          <span className="text-[13px] font-semibold text-black truncate">{label}</span>
        </div>
        <span className="text-[13px] font-medium text-black/50 whitespace-nowrap">
          {usage.toLocaleString()}
          {isUnlimited ? (
            <span className="text-black/25"> / {t('billing.unlimited_lower', { defaultValue: 'unlimited' })}</span>
          ) : (
            <span className="text-black/25"> / {numericLimit.toLocaleString()}</span>
          )}
        </span>
      </div>
      <div className="h-2 rounded-full bg-black/[0.04] overflow-hidden">
        {!isUnlimited ? (
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              isFull ? 'bg-red-500' : isHigh ? 'bg-amber-500' : 'bg-black'
            }`}
            style={{ width: `${Math.max(pct, 2)}%` }}
          />
        ) : (
          <div className="h-full rounded-full bg-black/[0.06]" style={{ width: '100%' }} />
        )}
      </div>
      {footer !== undefined ? (
        footer
      ) : !isUnlimited ? (
        <p
          className={`text-[11px] font-medium ${
            isFull ? 'text-red-500' : isHigh ? 'text-amber-600' : 'text-black/30'
          }`}
        >
          {isFull
            ? t('billing.limit_reached_upgrade', { defaultValue: 'Limit reached — upgrade to continue' })
            : isHigh
              ? t('billing.remaining_nearing', {
                  defaultValue: `${numericLimit - usage} remaining — nearing limit`,
                  n: numericLimit - usage,
                })
              : t('billing.remaining', {
                  defaultValue: `${numericLimit - usage} remaining`,
                  n: numericLimit - usage,
                })}
        </p>
      ) : null}
    </div>
  )
}
