'use client'
import React from 'react'
import { Check, GraduationCap, Presentation } from 'lucide-react'
import {
  GENERAL_PLANS,
  PERSONAL_PLANS,
  ENTERPRISE_PLAN,
  ANNUAL_DISCOUNT,
  PERSONAL_ANNUAL_DISCOUNT,
  applyPlanLimits,
  type Plan,
  type PriceOverrides,
  type PlanLimits,
} from '../_lib/plans'

interface PricingGridProps {
  planType: 'general' | 'personal'
  onPlanTypeChange: (_t: 'general' | 'personal') => void
  annual: boolean
  onAnnualChange: (_v: boolean) => void
  priceOverrides?: PriceOverrides
  pricesLoading?: boolean
  planLimits?: PlanLimits
  showEnterprise?: boolean
  hideFreePlan?: boolean
  /** Per-card CTA renderer. Receives the (limit-applied) plan + computed price. */
  renderCta: (_plan: Plan, _price: number) => React.ReactNode
}

export default function PricingGrid({
  planType,
  onPlanTypeChange,
  annual,
  onAnnualChange,
  priceOverrides,
  pricesLoading = false,
  planLimits,
  showEnterprise = false,
  hideFreePlan = false,
  renderCta,
}: PricingGridProps) {
  const detectedCurrency = Object.values(priceOverrides ?? {})[0]?.currency

  function getCurrencySymbol(planId: string) {
    const c = priceOverrides?.[planId]?.currency ?? detectedCurrency
    return c === 'eur' ? '€' : '$'
  }

  function calcPrice(planId: string, monthlyPrice: number, isPersonal = false) {
    if (monthlyPrice === 0) return 0
    const override = priceOverrides?.[planId]
    if (override) {
      if (annual && override.annualPerMonth > 0) return Math.round(override.annualPerMonth)
      if (!annual && override.monthly > 0) return Math.round(override.monthly)
    }
    const discount = isPersonal ? PERSONAL_ANNUAL_DISCOUNT : ANNUAL_DISCOUNT
    return annual ? Math.round(monthlyPrice * (1 - discount)) : monthlyPrice
  }

  const generalRaw = GENERAL_PLANS.map((p) => applyPlanLimits(p, planLimits))
  const generalPlans = hideFreePlan
    ? generalRaw
        .filter((p) => p.id !== 'free')
        .map((p) => (p.inheritsFrom === 'Free' ? { ...p, inheritsFrom: undefined, inheritsBadge: undefined } : p))
    : generalRaw
  const personalPlans = PERSONAL_PLANS.map((p) => applyPlanLimits(p, planLimits))

  function renderPlanCard(plan: Plan, isPersonal: boolean) {
    const price = calcPrice(plan.id, plan.monthlyPrice, isPersonal)
    const isFree = plan.monthlyPrice === 0
    return (
      <div
        key={plan.id}
        className="relative flex flex-col rounded-2xl p-7 bg-white nice-shadow overflow-hidden"
      >
        <div
          className="absolute top-0 left-0 w-[200px] h-[200px] pointer-events-none"
          style={{ background: `radial-gradient(ellipse at top left, ${plan.topGlow} 0%, transparent 70%)` }}
        />
        <div
          className="absolute top-0 left-0 bottom-0 w-[140px] pointer-events-none"
          style={{
            backgroundImage: `radial-gradient(circle, ${plan.patternColor} 1px, transparent 1px)`,
            backgroundSize: '16px 16px',
            maskImage: 'linear-gradient(to right, black, transparent)',
            WebkitMaskImage: 'linear-gradient(to right, black, transparent)',
          }}
        />

        {plan.popular && (
          <span
            className={`absolute top-4 right-4 text-[10px] font-bold px-2 py-0.5 rounded-md text-white ${
              isPersonal ? 'bg-amber-500' : plan.id === 'pro' ? 'bg-purple-600' : 'bg-blue-600'
            }`}
          >
            {isPersonal ? 'Best value' : 'Popular'}
          </span>
        )}

        <span
          className={`inline-flex w-fit px-2 py-1 text-xs font-semibold rounded-md border ${plan.badge} relative z-10`}
        >
          {plan.name}
        </span>

        <div className="mt-4 relative z-10">
          <div className="flex items-baseline gap-1">
            {pricesLoading && !isFree ? (
              <span className="inline-block h-[42px] w-[100px] rounded-lg bg-black/[0.06] animate-pulse" />
            ) : (
              <>
                <span className="text-[42px] font-black leading-none text-black">
                  {getCurrencySymbol(plan.id)}
                  {price}
                </span>
                {!isFree && <span className="text-sm font-medium text-black/35">/mo</span>}
              </>
            )}
          </div>
        </div>

        <p className="mt-2 text-sm font-medium leading-snug text-black/45 relative z-10">{plan.tagline}</p>

        <div className="my-6 h-px bg-black/[0.06] relative z-10" />

        <div className="flex-1 relative z-10">
          {plan.inheritsFrom && (
            <p className="text-xs font-semibold mb-3 text-black/25 flex items-center gap-1.5">
              Everything in{' '}
              <span className={`inline-flex px-1 py-px text-[9px] font-semibold rounded border ${plan.inheritsBadge}`}>
                {plan.inheritsFrom}
              </span>{' '}
              plus:
            </p>
          )}
          <ul className="space-y-2.5">
            {plan.features.map((f) => (
              <li key={f.label} className="flex items-start gap-2.5">
                <Check size={15} className={`mt-0.5 flex-shrink-0 ${plan.accentColor} opacity-60`} />
                <span className="text-[13.5px] font-medium leading-snug text-black/60">
                  {f.label}
                  {f.badge && (
                    <span className="ml-1.5 inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium text-black/35 border border-black/[0.06] rounded-md">
                      {f.badge}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-8 relative z-10">{renderCta(plan, price)}</div>
      </div>
    )
  }

  const annualSavePct = (() => {
    const refPlan = planType === 'personal' ? 'personal' : 'standard'
    const override = priceOverrides?.[refPlan]
    if (override && override.monthly > 0 && override.annualPerMonth > 0) {
      return Math.round((1 - override.annualPerMonth / override.monthly) * 100)
    }
    return Math.round((planType === 'personal' ? PERSONAL_ANNUAL_DISCOUNT : ANNUAL_DISCOUNT) * 100)
  })()

  return (
    <div>
      {/* Toggles */}
      <div className="flex flex-row items-center justify-between gap-4 mb-10 flex-wrap">
        <div className="inline-flex items-center gap-1 bg-neutral-100 rounded-full p-1">
          <button
            onClick={() => onPlanTypeChange('general')}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-semibold transition-colors cursor-pointer ${
              planType === 'general' ? 'bg-white text-black shadow-sm' : 'text-black/40 hover:text-black/60'
            }`}
          >
            <Presentation size={16} />
            General
          </button>
          <button
            onClick={() => onPlanTypeChange('personal')}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-semibold transition-colors cursor-pointer ${
              planType === 'personal' ? 'bg-white text-black shadow-sm' : 'text-black/40 hover:text-black/60'
            }`}
          >
            <GraduationCap size={16} />
            Personal
          </button>
        </div>
        <div className="inline-flex items-center gap-1 bg-neutral-100 rounded-full p-1">
          <button
            onClick={() => onAnnualChange(false)}
            className={`px-4 py-1.5 rounded-full text-sm font-semibold transition-colors cursor-pointer ${
              !annual ? 'bg-white text-black shadow-sm' : 'text-black/40 hover:text-black/60'
            }`}
          >
            Monthly
          </button>
          <button
            onClick={() => onAnnualChange(true)}
            className={`px-4 py-1.5 rounded-full text-sm font-semibold transition-colors cursor-pointer ${
              annual ? 'bg-white text-black shadow-sm' : 'text-black/40 hover:text-black/60'
            }`}
          >
            Annual
            {annualSavePct > 0 && (
              <span className="ml-1.5 text-[10px] font-bold text-white bg-emerald-500 px-1.5 py-0.5 rounded-full">
                Save {annualSavePct}%
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Personal cards */}
      {planType === 'personal' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {personalPlans.map((p) => renderPlanCard(p, true))}
        </div>
      )}

      {/* General cards */}
      {planType === 'general' && (
        <>
          <div
            className={`grid grid-cols-1 gap-5 ${
              generalPlans.length <= 2 ? 'md:grid-cols-2' : 'md:grid-cols-3'
            }`}
          >
            {generalPlans.map((p) => renderPlanCard(p, false))}
          </div>

          {showEnterprise && (
            <div className="mt-5">
              <div className="rounded-2xl overflow-hidden bg-neutral-950 relative">
                <div
                  className="absolute inset-0 opacity-[0.06] pointer-events-none"
                  style={{
                    backgroundImage: `linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)`,
                    backgroundSize: '40px 40px',
                  }}
                />
                <div className="relative z-10 p-10 md:p-14">
                  <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-10 lg:gap-16">
                    <div className="lg:max-w-sm">
                      <span className="inline-flex w-fit px-2 py-1 text-xs font-semibold rounded-md border bg-gradient-to-br from-amber-900/40 to-amber-800/30 text-amber-300 border-amber-700/30">
                        Enterprise
                      </span>
                      <h2 className="mt-3 text-white font-black text-[28px] md:text-[36px] leading-[1.08] tracking-tight">
                        Built for scale.
                      </h2>
                      <p className="mt-3 text-white/40 text-base leading-relaxed font-medium">
                        {ENTERPRISE_PLAN.tagline}
                      </p>
                      <a
                        href="https://learnhouse.app/contact?subject=business"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-block mt-6 px-5 py-2.5 text-[14px] font-bold bg-white text-black rounded-lg hover:bg-white/90 transition-colors"
                      >
                        Talk to us
                      </a>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-10 gap-y-5 lg:pt-1">
                      {ENTERPRISE_PLAN.features.map((f) => (
                        <div key={f.label} className="flex items-center gap-3">
                          <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-white/[0.07] flex items-center justify-center">
                            <Check size={16} className="text-white/60" />
                          </div>
                          <span className="text-white/70 text-[14px] font-medium">{f.label}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
