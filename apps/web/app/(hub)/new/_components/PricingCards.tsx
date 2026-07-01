'use client'
// Presentational pricing cards for the .io create-org onboarding (/new).
//
// Ports the VISUAL design + motion of the platform's
// `app/components/Landing/PricingCards.tsx`, but is driven entirely by the .io
// canonical catalog (`app/(hub)/_billing/plans.ts`). The platform component
// bakes a phosphor icon + Radix tooltip into every PlanFeature; the .io catalog
// deliberately omits those, so each feature renders a single phosphor `Check` and
// a plain badge span instead (matching the existing billing-hub PricingGrid).
//
// This is a pure presentational client component: it never imports
// @services/billing/* — pricing/limits arrive as props (priceOverrides /
// planLimits) and selection is reported via onSelect.
import React from 'react'
import { motion } from 'motion/react'
import { Check, GraduationCap, Presentation } from '@phosphor-icons/react'
import {
  GENERAL_PLANS,
  PERSONAL_PLANS,
  ENTERPRISE_PLAN,
  ANNUAL_DISCOUNT,
  PERSONAL_ANNUAL_DISCOUNT,
  applyPlanLimits,
  getCurrencySymbol,
  type Plan,
  type PlanId,
  type Billing,
  type PriceOverrides,
  type PlanLimits,
} from '../../_billing/plans'

export interface PricingCardsProps {
  /** Controlled plan tab — pair with onPlanTypeChange, or omit for uncontrolled. */
  planType?: 'general' | 'personal'
  onPlanTypeChange?: (_t: 'general' | 'personal') => void
  /** Controlled billing toggle — pair with onAnnualChange, or omit for uncontrolled. */
  annual?: boolean
  onAnnualChange?: (_v: boolean) => void
  defaultPlanType?: 'general' | 'personal'
  defaultBilling?: Billing
  /** Hide the built-in plan-type / billing toggle row. */
  hideToggles?: boolean
  /** Show the dark Enterprise band under the general grid. */
  showEnterprise?: boolean
  /** Drop the Free plan card (e.g. when the user already has a free org). */
  hideFreePlan?: boolean
  /** Live prices from GET /api/billing/prices → overrides static catalog prices. */
  priceOverrides?: PriceOverrides
  /** Live limits from GET /api/billing/prices → overrides static feature labels. */
  planLimits?: PlanLimits
  /** Whether live prices are still loading (renders a price skeleton). */
  pricesLoading?: boolean
  /** Called when a plan card's default CTA is clicked. */
  onSelect?: (_planId: PlanId, _billing: Billing) => void
  /**
   * Custom per-card CTA renderer. Receives the (limit-applied) plan + computed
   * per-month price. Return null/undefined to fall back to the default CTA.
   */
  renderCta?: (_plan: Plan, _price: number) => React.ReactNode
  /** Custom Enterprise CTA renderer (defaults to a "Talk to us" link). */
  renderEnterpriseCta?: () => React.ReactNode
}

export default function PricingCards({
  planType: planTypeProp,
  onPlanTypeChange,
  annual: annualProp,
  onAnnualChange,
  defaultPlanType = 'general',
  defaultBilling = 'annual',
  hideToggles = false,
  showEnterprise = true,
  hideFreePlan = false,
  priceOverrides,
  planLimits,
  pricesLoading = false,
  onSelect,
  renderCta,
  renderEnterpriseCta,
}: PricingCardsProps) {
  const [_planType, _setPlanType] = React.useState<'general' | 'personal'>(defaultPlanType)
  const [_annual, _setAnnual] = React.useState(defaultBilling === 'annual')

  const planType = planTypeProp ?? _planType
  const annual = annualProp ?? _annual
  const billing: Billing = annual ? 'annual' : 'monthly'

  const setPlanType = (v: 'general' | 'personal') =>
    onPlanTypeChange ? onPlanTypeChange(v) : _setPlanType(v)
  const setAnnual = (v: boolean) => (onAnnualChange ? onAnnualChange(v) : _setAnnual(v))

  const currencySymbol = (planId: string) => getCurrencySymbol(planId, priceOverrides)

  function calcPrice(planId: string, monthlyPrice: number, isPersonal: boolean) {
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
        .map((p) =>
          p.inheritsFrom === 'Free' ? { ...p, inheritsFrom: undefined, inheritsBadge: undefined } : p,
        )
    : generalRaw
  const personalPlans = PERSONAL_PLANS.map((p) => applyPlanLimits(p, planLimits))

  function renderDefaultCta(plan: Plan) {
    const cls = `block w-full text-center px-5 py-2.5 rounded-lg text-[14px] font-bold transition-colors cursor-pointer ${plan.ctaStyle}`
    const label = plan.monthlyPrice === 0 ? 'Get started free' : `Choose ${plan.name}`
    return (
      <motion.button
        type="button"
        whileTap={{ scale: 0.97 }}
        onClick={() => onSelect?.(plan.id, billing)}
        className={cls}
      >
        {label}
      </motion.button>
    )
  }

  function renderPlanCta(plan: Plan, price: number) {
    if (renderCta) {
      const custom = renderCta(plan, price)
      if (custom !== undefined && custom !== null) return custom
    }
    return renderDefaultCta(plan)
  }

  function renderPlanCard(plan: Plan, isPersonal: boolean) {
    const price = calcPrice(plan.id, plan.monthlyPrice, isPersonal)
    const isFree = plan.monthlyPrice === 0
    return (
      <motion.div
        key={plan.id}
        whileHover={{ y: -3 }}
        transition={{ type: 'spring', stiffness: 300, damping: 24 }}
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
                  {currencySymbol(plan.id)}
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

        <div className="mt-8 relative z-10">{renderPlanCta(plan, price)}</div>
      </motion.div>
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
      {!hideToggles && (
        <div className="flex flex-row items-center justify-between gap-4 mb-10 flex-wrap">
          <div className="inline-flex items-center gap-1 bg-neutral-100 rounded-full p-1">
            <motion.button
              type="button"
              whileTap={{ scale: 0.96 }}
              onClick={() => setPlanType('general')}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-semibold transition-colors cursor-pointer ${
                planType === 'general' ? 'bg-white text-black shadow-sm' : 'text-black/40 hover:text-black/60'
              }`}
            >
              <Presentation size={16} weight="duotone" />
              General
            </motion.button>
            <motion.button
              type="button"
              whileTap={{ scale: 0.96 }}
              onClick={() => setPlanType('personal')}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-semibold transition-colors cursor-pointer ${
                planType === 'personal' ? 'bg-white text-black shadow-sm' : 'text-black/40 hover:text-black/60'
              }`}
            >
              <GraduationCap size={16} weight="duotone" />
              Personal
              <span className="px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide rounded-md leading-none border border-black/25 text-black/40">
                New
              </span>
            </motion.button>
          </div>
          <div className="inline-flex items-center gap-1 bg-neutral-100 rounded-full p-1">
            <motion.button
              type="button"
              whileTap={{ scale: 0.96 }}
              onClick={() => setAnnual(false)}
              className={`px-4 py-1.5 rounded-full text-sm font-semibold transition-colors cursor-pointer ${
                !annual ? 'bg-white text-black shadow-sm' : 'text-black/40 hover:text-black/60'
              }`}
            >
              Monthly
            </motion.button>
            <motion.button
              type="button"
              whileTap={{ scale: 0.96 }}
              onClick={() => setAnnual(true)}
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
            </motion.button>
          </div>
        </div>
      )}

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
                      {renderEnterpriseCta ? (
                        renderEnterpriseCta()
                      ) : (
                        <a
                          href="https://learnhouse.app/contact?subject=business"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-block mt-6 px-5 py-2.5 text-[14px] font-bold bg-white text-black rounded-lg hover:bg-white/90 transition-colors"
                        >
                          Talk to us
                        </a>
                      )}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-10 gap-y-5 lg:pt-1">
                      <p className="text-xs font-semibold text-white/20 sm:col-span-2 flex items-center gap-1.5">
                        Everything in{' '}
                        <span className="inline-flex px-1 py-px text-[9px] font-semibold rounded border bg-gradient-to-br from-purple-100 to-purple-200 text-purple-800 border-purple-200">
                          Pro
                        </span>{' '}
                        plus:
                      </p>
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
