'use client'
// Plan summary card for the .io create-org onboarding (/new) step 4 right column.
//
// Ports the platform's `app/components/Landing/PlanSummaryCard.tsx` glow-header
// design (radial top glow, badge, big price, "billed annually/monthly" line,
// uppercase "What's included" feature list), driven by the .io canonical catalog
// (`app/(hub)/_billing/plans.ts`). The platform renders a per-feature phosphor
// icon; the .io catalog has no feature icons, so each row uses a single phosphor
// `Check` instead.
//
// Pure presentational client component — pricing/limits arrive as props
// (priceOverrides / planLimits); it never imports @services/billing/*.
import React from 'react'
import { motion } from 'motion/react'
import { Check } from '@phosphor-icons/react'
import {
  ALL_PLANS,
  applyPlanLimits,
  calcPrice,
  getCurrencySymbol,
  isPaidPlan,
  type PlanId,
  type Billing,
  type PriceOverrides,
  type PlanLimits,
} from '../../_billing/plans'

export interface PlanSummaryCardProps {
  planId: PlanId
  billing?: Billing
  /** Optional footer slot (e.g. the submit button). */
  footer?: React.ReactNode
  /** Live prices from GET /api/billing/prices → overrides static catalog prices. */
  priceOverrides?: PriceOverrides
  /** Live limits from GET /api/billing/prices → overrides static feature labels. */
  planLimits?: PlanLimits
  /**
   * Show the secure-checkout note for paid non-enterprise plans (the .io flow
   * redirects to Stripe checkout after the org is created). Defaults to true.
   */
  showCheckoutNote?: boolean
}

export default function PlanSummaryCard({
  planId,
  billing = 'annual',
  footer,
  priceOverrides,
  planLimits,
  showCheckoutNote = true,
}: PlanSummaryCardProps) {
  const rawPlan = ALL_PLANS.find((p) => p.id === planId)
  if (!rawPlan) return null

  const plan = applyPlanLimits(rawPlan, planLimits)

  const price = calcPrice(plan.monthlyPrice, billing, plan.id, priceOverrides)
  const currencySymbol = getCurrencySymbol(plan.id, priceOverrides)
  const annualTotal = priceOverrides?.[plan.id]?.annualTotal || price * 12

  const checkoutNote =
    showCheckoutNote && isPaidPlan(plan.id) && plan.id !== 'enterprise'

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.26, ease: [0.4, 0, 0.2, 1] }}
      className="bg-white nice-shadow rounded-2xl overflow-hidden"
    >
      <div className="relative px-7 pt-7 pb-6 border-b border-black/[0.05] overflow-hidden">
        <div
          className="absolute top-0 left-0 w-[220px] h-[220px] pointer-events-none"
          style={{ background: `radial-gradient(ellipse at top left, ${plan.topGlow} 0%, transparent 70%)` }}
        />
        <div className="relative z-10">
          <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-md border ${plan.badge}`}>
            {plan.name}
          </span>
          <div className="mt-4 flex items-baseline gap-1">
            {plan.monthlyPrice > 0 ? (
              <>
                <span className="text-[40px] font-black leading-none text-black">
                  {currencySymbol}
                  {price}
                </span>
                <span className="text-sm font-medium text-black/35">/mo</span>
              </>
            ) : (
              <span className="text-[40px] font-black leading-none text-black">Free</span>
            )}
          </div>
          {plan.monthlyPrice > 0 && (
            <p className="text-xs text-black/30 font-medium mt-1.5">
              {billing === 'annual'
                ? `${currencySymbol}${annualTotal}/yr · billed annually`
                : 'billed monthly'}
            </p>
          )}
        </div>
      </div>

      <div className={`px-7 py-5 ${footer || checkoutNote ? 'border-b border-black/[0.05]' : ''}`}>
        <p className="text-[11px] font-semibold uppercase tracking-widest text-black/25 mb-3.5">
          What&apos;s included
        </p>
        <ul className="space-y-2.5">
          {plan.features.map((f) => (
            <li key={f.label} className="flex items-center gap-2.5">
              <Check size={14} className={`flex-shrink-0 ${plan.accentColor} opacity-70`} />
              <span className="text-[13.5px] font-medium text-black/60">{f.label}</span>
            </li>
          ))}
        </ul>
      </div>

      {checkoutNote && (
        <div className={`px-7 py-4 ${footer ? 'border-b border-black/[0.05]' : ''}`}>
          <p className="text-[12px] font-medium leading-snug text-black/40">
            After creating your organization you will be taken to secure checkout.
          </p>
        </div>
      )}

      {footer && <div className="px-7 py-6">{footer}</div>}
    </motion.div>
  )
}
