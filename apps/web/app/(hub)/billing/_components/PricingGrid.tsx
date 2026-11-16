'use client'
// The plan cards of the upgrade flow, laid out like the marketing pricing page:
// Standard, Pro, Business and a dark Enterprise card across the full width,
// with Free in a slim strip underneath (where marketing puts self-hosting).
// Each card: name badge, price, how it's billed, a one-line pitch, a short
// highlight list and one action (rendered by the caller).
import React, { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Cube } from '@phosphor-icons/react'
import { Skeleton } from '@/design'
import { findPlan, calcPrice, applyPlanLimits, type Plan, type PriceOverrides, type PlanLimits } from '../_lib/plans'
import { planName, featureLabel } from '../../_billing/planText'
import {
  ACCENT,
  CARD_PLANS,
  PlanBadge,
  annualTotal,
  formatPlanMoney,
  patternStyle,
  planHighlights,
  planTaglineV2,
  type AccentKey,
  type CardPlanId,
} from './planDisplay'

interface PricingGridProps {
  annual: boolean
  priceOverrides?: PriceOverrides
  pricesLoading?: boolean
  planLimits?: PlanLimits
  currentPlanId: string
  /** Outline and scroll to this card (an Enterprise deep link). */
  highlightPlanId?: string | null
  /** Label for the current plan's flag ("Current plan", or the trial). */
  currentLabel?: string
  /** The one action on each card (and on the Free strip). */
  renderCta: (_plan: Plan, _price: number) => React.ReactNode
}

export default function PricingGrid({
  annual,
  priceOverrides,
  pricesLoading = false,
  planLimits,
  currentPlanId,
  highlightPlanId,
  currentLabel,
  renderCta,
}: PricingGridProps) {
  const { t, i18n } = useTranslation()
  const lng = i18n.language
  const billing = annual ? 'annual' : 'monthly'
  const highlightRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (highlightPlanId) highlightRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [highlightPlanId])

  const flagCurrent = currentLabel ?? t('billing.flow.current_plan', { defaultValue: 'Current plan' })

  function card(id: CardPlanId) {
    const raw = findPlan(id)
    if (!raw) return null
    const plan = applyPlanLimits(raw, planLimits)
    const dark = id === 'enterprise'
    const accent: AccentKey = id
    const a = ACCENT[accent]
    const isCurrent = id === currentPlanId
    const isHighlighted = id === highlightPlanId
    const price = dark ? 0 : calcPrice(plan.monthlyPrice, billing, id, priceOverrides)
    const muted = dark ? 'text-white/40' : 'text-black/40'
    const inherits: Record<string, CardPlanId> = { pro: 'standard', business: 'pro', enterprise: 'business' }
    const parent = inherits[id]
    const flag = isCurrent
      ? { label: flagCurrent, className: dark ? 'bg-white text-black' : 'bg-neutral-900 text-white' }
      : id === 'pro'
        ? { label: t('billing.pricing.popular', { defaultValue: 'Popular' }), className: 'bg-purple-600 text-white' }
        : null

    return (
      <div
        key={id}
        ref={isHighlighted ? highlightRef : undefined}
        data-testid={`plan-card-${id}`}
        className={`relative flex flex-col rounded-2xl p-6 xl:p-7 overflow-hidden min-w-0 ${
          dark ? 'bg-neutral-950' : 'bg-white nice-shadow'
        } ${isCurrent || isHighlighted ? `ring-2 ${a.ring}` : ''}`}
      >
        <div aria-hidden="true" className="absolute inset-x-0 top-0 h-[150px] pointer-events-none" style={patternStyle(a.pat)} />
        {flag && (
          <span className={`absolute top-6 end-6 xl:top-7 xl:end-7 z-10 text-[10px] font-bold px-2.5 py-1 rounded-full leading-none ${flag.className}`}>
            {flag.label}
          </span>
        )}

        <div className="relative z-10 flex flex-col flex-1">
          <PlanBadge accent={accent}>{planName(t, plan)}</PlanBadge>

          <div className="mt-6 flex items-baseline gap-1.5 min-h-[44px]">
            {dark ? (
              <span className="text-[40px] xl:text-[44px] font-black leading-none tracking-tight text-white">
                {t('billing.flow.custom_price', { defaultValue: 'Custom' })}
              </span>
            ) : pricesLoading ? (
              <Skeleton className="h-[44px] w-[120px]" />
            ) : (
              <>
                <span className="text-[40px] xl:text-[44px] font-black leading-none tracking-tight tabular-nums text-black">
                  {formatPlanMoney(price, id, priceOverrides, lng)}
                </span>
                <span className={`text-sm font-medium ${muted}`}>{t('billing.pricing.per_month', { defaultValue: '/mo' })}</span>
              </>
            )}
          </div>
          <p className={`mt-2 text-[13px] font-medium ${muted}`}>
            {dark
              ? t('billing.flow.annual_contract', { defaultValue: 'Annual contract' })
              : pricesLoading
                ? ' '
                : annual
                  ? t('billing.flow.billed_yearly', { amount: formatPlanMoney(annualTotal(id, price, priceOverrides), id, priceOverrides, lng) })
                  : t('billing.flow.billed_monthly', { defaultValue: 'Billed monthly' })}
          </p>
          <p className={`mt-4 text-[14px] font-medium leading-snug min-h-[2.75em] ${dark ? 'text-white/60' : 'text-black/55'}`}>
            {planTaglineV2(t, id, plan.tagline)}
          </p>

          <div className={`mt-5 mb-6 h-px ${dark ? 'bg-white/10' : 'bg-black/[0.06]'}`} />

          <div className="flex-1">
            {parent && (
              <p className={`mb-4 text-[12px] font-semibold flex items-center gap-1.5 flex-wrap ${dark ? 'text-white/30' : 'text-black/30'}`}>
                {t('billing.pricing.everything_in', { defaultValue: 'Everything in' })}{' '}
                <PlanBadge accent={parent} mini>
                  {planName(t, findPlan(parent)!)}
                </PlanBadge>{' '}
                {t('billing.pricing.plus', { defaultValue: 'plus:' })}
              </p>
            )}
            <ul className="space-y-3">
              {planHighlights(t, id, planLimits).map((h) => {
                const I = h.icon
                return (
                  <li key={h.label} className="flex items-start gap-2.5">
                    <I size={17} weight="duotone" className={`mt-[2px] flex-shrink-0 ${a.icon}`} />
                    <span className={`text-[13.5px] font-medium leading-[1.45] ${dark ? 'text-white/75' : 'text-black/65'}`}>
                      {h.label}
                      {h.chip && (
                        <span
                          className={`ms-1.5 inline-flex px-1.5 py-px text-[10px] font-medium rounded-md border whitespace-nowrap align-[1px] ${
                            dark ? 'text-white/40 border-white/10' : 'text-black/40 border-black/[0.07]'
                          }`}
                        >
                          {h.chip}
                        </span>
                      )}
                    </span>
                  </li>
                )
              })}
            </ul>
          </div>

          <div className="mt-8">{renderCta(plan, price)}</div>
        </div>
      </div>
    )
  }

  const free = findPlan('free')
  const freePlan = free ? applyPlanLimits(free, planLimits) : null
  const freeIsCurrent = currentPlanId === 'free'

  return (
    <div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">{CARD_PLANS.map(card)}</div>

      {freePlan && (
        <div
          data-testid="plan-card-free"
          className={`mt-4 rounded-2xl bg-white nice-shadow px-6 xl:px-7 py-5 flex flex-col lg:flex-row lg:items-center gap-4 lg:gap-10 ${
            freeIsCurrent ? `ring-2 ${ACCENT.free.ring}` : ''
          }`}
        >
          <div className="flex items-start gap-4 min-w-0 flex-1">
            <div className="flex-shrink-0 w-11 h-11 rounded-xl bg-neutral-50 ring-1 ring-black/[0.06] grid place-items-center">
              <Cube size={22} weight="duotone" className="text-black/60" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <PlanBadge accent="free">{planName(t, freePlan)}</PlanBadge>
                <span className="text-[15px] font-black text-black tabular-nums">
                  {formatPlanMoney(0, 'free', priceOverrides, lng)}
                </span>
                {freeIsCurrent && (
                  <span className="text-[10px] font-bold px-2.5 py-1 rounded-full leading-none bg-neutral-900 text-white">{flagCurrent}</span>
                )}
              </div>
              <p className="mt-1.5 text-[14px] font-medium text-black/50 leading-relaxed">{planTaglineV2(t, 'free', freePlan.tagline)}</p>
              <div className="mt-2.5 flex flex-wrap gap-2">
                {freePlan.features.map((f) => (
                  <span
                    key={f.label}
                    className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md bg-neutral-50 ring-1 ring-black/[0.06] text-[12.5px] font-semibold text-black/60"
                  >
                    <Check size={12} weight="bold" className="text-black/40" />
                    {featureLabel(t, f)}
                  </span>
                ))}
              </div>
            </div>
          </div>
          <div className="flex-shrink-0 lg:w-56">{renderCta(freePlan, 0)}</div>
        </div>
      )}
    </div>
  )
}
