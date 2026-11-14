'use client'
// One way to show AI credits everywhere: the same icon and wording before a
// request ("About 12 credits") and after it ("Used 7 credits"), plus the
// low-balance and out-of-credits notices. Numbers come from the API (prices
// table, X-AI-Credits-Used, stream `credits`); this file never invents them.
import React from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowSquareOut, Lightning, Warning } from '@phosphor-icons/react'
import { useOrg } from '@components/Contexts/OrgContext'
import { getDeploymentMode, getMainDomainUri, getUpgradeUrl } from '@services/config/config'
import { useAICredits } from '@components/Hooks/useAICredits'
import type { AIBalanceState } from '@services/ai/credits'

type Tone = 'light' | 'dark'

/** The credits icon. Use this, not another glyph, wherever credits appear. */
export function CreditsIcon({ size = 12, tone = 'light', className = '' }: { size?: number; tone?: Tone; className?: string }) {
  return (
    <Lightning
      size={size}
      weight="fill"
      aria-hidden="true"
      className={`flex-none ${tone === 'dark' ? 'text-violet-300/80' : 'text-violet-500'} ${className}`}
    />
  )
}

export function CreditCost({
  credits,
  kind = 'estimate',
  tone = 'light',
  className = '',
  total = false,
}: {
  credits: number | null | undefined
  kind?: 'estimate' | 'used'
  tone?: Tone
  className?: string
  /** A bulk action's total ("About 24 credits in total"). */
  total?: boolean
}) {
  const { t } = useTranslation()
  if (credits == null || credits < 0) return null
  if (kind === 'estimate' && credits === 0) return null
  const label =
    kind === 'used'
      ? t('ai_credits.used', { count: credits, defaultValue: credits === 1 ? 'Used {{count}} credit' : 'Used {{count}} credits' })
      : total
        ? t('ai_credits.estimate_total', { count: credits, defaultValue: credits === 1 ? 'About {{count}} credit in total' : 'About {{count}} credits in total' })
        : t('ai_credits.estimate', { count: credits, defaultValue: credits === 1 ? 'About {{count}} credit' : 'About {{count}} credits' })
  return (
    <span
      data-testid={`credit-cost-${kind}`}
      className={`inline-flex items-center gap-1 text-[12px] tabular-nums ${tone === 'dark' ? 'text-white/45' : 'text-neutral-500'} ${className}`}
    >
      <CreditsIcon size={11} tone={tone} />
      {label}
    </span>
  )
}

function useCreditLinks() {
  const org = useOrg() as any
  const slug = org?.slug ?? ''
  const saas = getDeploymentMode() === 'saas'
  return {
    buyUrl: saas ? getMainDomainUri(`/billing?org=${slug}`) : null,
    upgradeUrl: saas ? getUpgradeUrl(slug) : null,
  }
}

/** "Out of credits": what happened and where to get more. */
export function OutOfCreditsNotice({ tone = 'light', className = '' }: { tone?: Tone; className?: string }) {
  const { t } = useTranslation()
  const { buyUrl, upgradeUrl } = useCreditLinks()
  const dark = tone === 'dark'
  return (
    <div
      role="alert"
      data-testid="out-of-credits"
      className={`flex items-start gap-2.5 rounded-xl px-3.5 py-3 text-[13px] ${
        dark ? 'bg-rose-500/[0.08] ring-1 ring-inset ring-rose-300/20 text-rose-100/90' : 'bg-rose-50 ring-1 ring-inset ring-rose-200 text-rose-800'
      } ${className}`}
    >
      <CreditsIcon size={14} tone={tone} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{t('ai_credits.out.title', { defaultValue: 'Your organization is out of AI credits' })}</p>
        <p className={dark ? 'text-rose-100/70' : 'text-rose-700/90'}>
          {t('ai_credits.out.body', { defaultValue: 'AI features are paused until you add credits or move to a plan with more.' })}
        </p>
        {(buyUrl || upgradeUrl) && (
          <div className="mt-2 flex flex-wrap gap-3">
            {buyUrl && (
              <a href={buyUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold underline-offset-2 hover:underline">
                {t('ai_credits.buy_more', { defaultValue: 'Buy more credits' })}
                <ArrowSquareOut size={12} />
              </a>
            )}
            {upgradeUrl && (
              <a href={upgradeUrl} className="inline-flex items-center gap-1 font-semibold underline-offset-2 hover:underline">
                {t('ai_credits.upgrade', { defaultValue: 'Upgrade your plan' })}
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Low-balance warning (<= 20% left: low, <= 5%: critical) or the out-of-credits
 * notice. Renders nothing while the balance is fine or unlimited.
 */
export function AICreditsBalanceNotice({
  tone = 'light',
  className = '',
  state: stateOverride,
}: {
  tone?: Tone
  className?: string
  state?: AIBalanceState
}) {
  const { t } = useTranslation()
  const { credits, state: fetched } = useAICredits()
  const { buyUrl } = useCreditLinks()
  const state = stateOverride ?? fetched
  if (state === 'empty') return <OutOfCreditsNotice tone={tone} className={className} />
  if (state !== 'low' && state !== 'critical') return null
  const remaining = typeof credits?.remaining_credits === 'number' ? credits.remaining_credits : null
  const critical = state === 'critical'
  const dark = tone === 'dark'
  const palette = dark
    ? critical
      ? 'bg-rose-500/[0.08] ring-rose-300/20 text-rose-100/90'
      : 'bg-amber-400/[0.08] ring-amber-200/20 text-amber-100/90'
    : critical
      ? 'bg-rose-50 ring-rose-200 text-rose-800'
      : 'bg-amber-50 ring-amber-200 text-amber-900'
  return (
    <div role="status" data-testid={`credits-${state}`} className={`flex items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-[13px] ring-1 ring-inset ${palette} ${className}`}>
      <Warning size={14} weight="fill" className="flex-none" />
      <span className="flex-1 min-w-0">
        {critical
          ? t('ai_credits.low.critical', { count: remaining ?? 0, defaultValue: 'Almost out of AI credits: {{count}} left.' })
          : t('ai_credits.low.warning', { count: remaining ?? 0, defaultValue: 'AI credits are running low: {{count}} left.' })}
      </span>
      {buyUrl && (
        <a href={buyUrl} target="_blank" rel="noopener noreferrer" className="flex-none inline-flex items-center gap-1 font-semibold underline-offset-2 hover:underline">
          {t('ai_credits.buy_more', { defaultValue: 'Buy more credits' })}
          <ArrowSquareOut size={12} />
        </a>
      )}
    </div>
  )
}
