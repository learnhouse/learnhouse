'use client'
import React, { useState } from 'react'
import { ArrowLeft, ArrowRight, Check, Lock, AlertTriangle, Tag } from 'lucide-react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import {
  findPlan,
  isPersonalPlan,
  calcPrice,
  getCurrencySymbol,
  applyPlanLimits,
  type Plan,
  type PlanId,
  type Billing,
  type PriceOverrides,
  type PlanLimits,
} from '../_lib/plans'
import {
  billingCheckout,
  billingSwitch,
  billingCancel,
  validatePromo,
} from '../_lib/billingClient'
import PricingGrid from './PricingGrid'

type SwitchView = 'choose-plan' | 'confirm' | 'success'

interface SwitchWizardProps {
  org: any
  currentPlanId: string
  hasExistingSub: boolean
  priceOverrides?: PriceOverrides
  pricesLoading?: boolean
  planLimits?: PlanLimits
  /** Return to the Plan & Usage view. */
  onBack: () => void
  /** Invalidate cached subscription/org state after a successful change. */
  onChanged: () => void
}

export default function SwitchWizard({
  org,
  currentPlanId,
  hasExistingSub,
  priceOverrides,
  pricesLoading = false,
  planLimits,
  onBack,
  onChanged,
}: SwitchWizardProps) {
  const { t } = useTranslation()
  const currentIsPersonal = isPersonalPlan(currentPlanId)

  const [view, setView] = useState<SwitchView>('choose-plan')
  const [selectedPlan, setSelectedPlan] = useState<PlanId | null>(null)
  const [billing, setBilling] = useState<Billing>('annual')
  const [planType, setPlanType] = useState<'general' | 'personal'>(
    currentIsPersonal ? 'personal' : 'general',
  )
  const [loading, setLoading] = useState(false)
  const [promoCode, setPromoCode] = useState('')
  const [promoStatus, setPromoStatus] = useState<'idle' | 'validating' | 'valid' | 'invalid'>('idle')
  const [promoDetail, setPromoDetail] = useState<{ percentOff?: number; amountOff?: number; currency?: string } | null>(null)

  const selectedPlanData: Plan | null = selectedPlan
    ? (() => {
        const p = findPlan(selectedPlan)
        return p ? applyPlanLimits(p, planLimits) : null
      })()
    : null
  const currentPlanData = (() => {
    const p = findPlan(currentPlanId)
    return p ? applyPlanLimits(p, planLimits) : undefined
  })()
  const newPrice = selectedPlanData ? calcPrice(selectedPlanData.monthlyPrice, billing, selectedPlan!, priceOverrides) : 0
  const currentPrice = currentPlanData ? calcPrice(currentPlanData.monthlyPrice, billing, currentPlanId, priceOverrides) : 0
  const isUpgrade = newPrice > currentPrice

  async function handleApplyPromo() {
    if (!promoCode.trim()) return
    setPromoStatus('validating')
    const result = await validatePromo(promoCode.trim())
    if (result.valid) {
      setPromoStatus('valid')
      setPromoDetail({ percentOff: result.percentOff, amountOff: result.amountOff, currency: result.currency })
    } else {
      setPromoStatus('invalid')
      setPromoDetail(null)
    }
  }

  function handlePlanSelect(planId: string, planBilling: Billing) {
    if (planId === currentPlanId) return
    setSelectedPlan(planId as PlanId)
    setBilling(planBilling)
    setView('confirm')
  }

  async function handleConfirm() {
    if (!selectedPlan || !org?.id) return
    setLoading(true)
    try {
      const validPromo = promoStatus === 'valid' ? promoCode.trim() : undefined

      if (hasExistingSub && selectedPlan === 'free') {
        await billingCancel({ orgId: org.id })
        onChanged()
        setView('success')
      } else if (hasExistingSub) {
        await billingSwitch({
          orgId: org.id,
          newPlan: selectedPlan,
          newBilling: billing,
          downgrade: !isUpgrade,
          promotionCode: validPromo,
        })
        onChanged()
        setView('success')
      } else {
        const stripeSession = await billingCheckout({
          plan: selectedPlan,
          billing,
          orgId: org.id,
          orgSlug: org.slug,
          promotionCode: validPromo,
        })
        window.location.href = stripeSession.url
        return
      }
    } catch (err: any) {
      toast.error(err?.message ?? 'Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const steps = [
    { label: t('billing.step_choose_plan', { defaultValue: 'Choose Plan' }), key: 'choose-plan' },
    { label: t('billing.step_confirm', { defaultValue: 'Confirm' }), key: 'confirm' },
    { label: t('billing.step_done', { defaultValue: 'Done' }), key: 'success' },
  ] as const

  return (
    <div className="pt-2 space-y-6 pb-12">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button
          onClick={onBack}
          className="flex items-center justify-center w-8 h-8 rounded-lg hover:bg-black/[0.04] transition-colors"
          aria-label={t('billing.back', { defaultValue: 'Back' })}
        >
          <ArrowLeft size={16} className="text-black/50" />
        </button>
        <div>
          <h1 className="font-black text-2xl tracking-tight text-black">
            {hasExistingSub
              ? t('billing.switch_plan', { defaultValue: 'Switch Plan' })
              : t('billing.upgrade_plan', { defaultValue: 'Upgrade Plan' })}
          </h1>
          <p className="mt-0.5 text-sm text-black/40">
            {hasExistingSub
              ? t('billing.switch_subtitle', { defaultValue: 'Choose a new plan. Changes are prorated automatically.' })
              : t('billing.upgrade_subtitle', { defaultValue: 'Choose a plan to get started.' })}
          </p>
        </div>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2 justify-center">
        {steps.map((step, i) => {
          const stepKeys = steps.map((s) => s.key)
          const currentIdx = stepKeys.indexOf(view)
          const isActive = i === currentIdx
          const isDone = i < currentIdx
          return (
            <React.Fragment key={step.key}>
              {i > 0 && <div className={`w-8 h-px ${isDone || isActive ? 'bg-black/20' : 'bg-black/[0.08]'}`} />}
              <div
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                  isActive ? 'bg-black text-white' : isDone ? 'bg-black/[0.06] text-black/60' : 'bg-black/[0.04] text-black/25'
                }`}
              >
                {isDone ? <Check size={12} /> : <span>{i + 1}</span>}
                <span>{step.label}</span>
              </div>
            </React.Fragment>
          )
        })}
      </div>

      {/* Choose Plan View */}
      {view === 'choose-plan' && (
        <div className="max-w-5xl mx-auto">
          <PricingGrid
            showEnterprise={false}
            planType={planType}
            onPlanTypeChange={setPlanType}
            annual={billing === 'annual'}
            onAnnualChange={(v) => setBilling(v ? 'annual' : 'monthly')}
            priceOverrides={priceOverrides}
            pricesLoading={pricesLoading}
            planLimits={planLimits}
            renderCta={(plan, _price) => {
              const isCurrent = plan.id === currentPlanId
              const currentMonthly = findPlan(currentPlanId)?.monthlyPrice ?? 0
              const isUpgradeOption = plan.monthlyPrice > currentMonthly
              const cls = 'block w-full text-center px-5 py-2.5 rounded-lg text-[14px] font-bold transition-colors'
              if (isCurrent) {
                return (
                  <span className={`${cls} bg-black/[0.04] text-black/30 cursor-default`}>
                    {t('billing.your_plan', { defaultValue: 'Your plan' })}
                  </span>
                )
              }
              return (
                <button
                  type="button"
                  onClick={() => handlePlanSelect(plan.id, billing)}
                  className={`${cls} cursor-pointer ${isUpgradeOption ? plan.ctaStyle : 'bg-neutral-900 text-white hover:bg-neutral-800'}`}
                >
                  {isUpgradeOption
                    ? t('billing.upgrade', { defaultValue: 'Upgrade' })
                    : t('billing.downgrade', { defaultValue: 'Downgrade' })}
                </button>
              )
            }}
          />
        </div>
      )}

      {/* Confirm View */}
      {view === 'confirm' && selectedPlanData && (
        <div className="max-w-md mx-auto space-y-5">
          <div className="bg-white rounded-2xl nice-shadow overflow-hidden">
            <div className="px-6 py-5 border-b border-black/[0.06]">
              <h2 className="font-bold text-base tracking-tight text-black">
                {isUpgrade
                  ? t('billing.upgrade_summary', { defaultValue: 'Upgrade Summary' })
                  : t('billing.downgrade_summary', { defaultValue: 'Downgrade Summary' })}
              </h2>
            </div>
            <div className="px-6 py-5 space-y-4">
              {/* From → To */}
              <div className="flex items-center gap-3">
                <div className="flex-1 bg-black/[0.03] rounded-xl px-4 py-3">
                  <p className="text-[10px] font-semibold text-black/30 uppercase tracking-wider">
                    {t('billing.current', { defaultValue: 'Current' })}
                  </p>
                  <p className="mt-1 text-sm font-bold text-black/50 capitalize">{currentPlanData?.name ?? currentPlanId}</p>
                  <p className="text-xs text-black/30 font-medium">
                    {getCurrencySymbol(currentPlanId, priceOverrides)}
                    {currentPrice}/mo
                  </p>
                </div>
                <ArrowRight size={16} className="text-black/20 flex-shrink-0" />
                <div className="flex-1 rounded-xl px-4 py-3 border-2 border-black/[0.08]" style={{ background: selectedPlanData.topGlow }}>
                  <p className="text-[10px] font-semibold text-black/30 uppercase tracking-wider">
                    {t('billing.new', { defaultValue: 'New' })}
                  </p>
                  <p className="mt-1 text-sm font-bold text-black">{selectedPlanData.name}</p>
                  <p className="text-xs text-black/50 font-medium">
                    {getCurrencySymbol(selectedPlan!, priceOverrides)}
                    {newPrice}/mo
                  </p>
                </div>
              </div>

              {/* Billing info */}
              <div className="bg-black/[0.02] rounded-xl px-4 py-3 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-black/40">{t('billing.billing', { defaultValue: 'Billing' })}</span>
                  <span className="text-xs font-semibold text-black/70 capitalize">{billing}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-black/40">
                    {billing === 'annual'
                      ? t('billing.annual_total', { defaultValue: 'Annual total' })
                      : t('billing.monthly_total', { defaultValue: 'Monthly total' })}
                  </span>
                  <span className="text-xs font-semibold text-black/70">
                    {getCurrencySymbol(selectedPlan!, priceOverrides)}
                    {billing === 'annual' ? priceOverrides?.[selectedPlan!]?.annualTotal || newPrice * 12 : newPrice}
                    {billing === 'annual' ? '/yr' : '/mo'}
                  </span>
                </div>
              </div>

              {/* Proration / downgrade notice */}
              {hasExistingSub && isUpgrade && (
                <div className="flex items-start gap-2.5 bg-blue-50 border border-blue-100 rounded-xl px-4 py-3">
                  <AlertTriangle size={14} className="text-blue-500 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-xs font-semibold text-blue-700">
                      {t('billing.prorated_billing', { defaultValue: 'Prorated billing' })}
                    </p>
                    <p className="text-[11px] text-blue-600/70 mt-0.5 leading-relaxed">
                      {t('billing.prorated_desc', {
                        defaultValue:
                          "You'll be credited for the unused time on your current plan and charged the difference for the new plan. The change takes effect immediately.",
                      })}
                    </p>
                  </div>
                </div>
              )}
              {hasExistingSub && !isUpgrade && (
                <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">
                  <AlertTriangle size={14} className="text-amber-500 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-xs font-semibold text-amber-700">
                      {selectedPlan === 'free'
                        ? t('billing.subscription_cancellation', { defaultValue: 'Subscription cancellation' })
                        : t('billing.end_of_cycle_switch', { defaultValue: 'End-of-cycle switch' })}
                    </p>
                    <p className="text-[11px] text-amber-600/70 mt-0.5 leading-relaxed">
                      {selectedPlan === 'free'
                        ? t('billing.cancel_desc', {
                            defaultValue:
                              "Your subscription will be canceled at the end of the current billing period. You'll keep full access until then.",
                          })
                        : t('billing.downgrade_desc', {
                            defaultValue:
                              "You'll keep your current plan until the end of the billing period. The new plan will take effect automatically when your current cycle ends.",
                          })}
                    </p>
                  </div>
                </div>
              )}

              {/* Features */}
              {selectedPlanData.features.length > 0 && (
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-widest text-black/25 mb-2.5">
                    {t('billing.whats_included', { defaultValue: "What's included" })}
                  </p>
                  <ul className="space-y-1.5">
                    {selectedPlanData.features.map((f) => (
                      <li key={f.label} className="flex items-center gap-2">
                        <Check size={13} className={`flex-shrink-0 ${selectedPlanData.accentColor} opacity-60`} />
                        <span className="text-xs font-medium text-black/50">{f.label}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* Discount Code */}
            {selectedPlan !== 'free' && (
              <div className="px-6 py-4 border-t border-black/[0.06]">
                <div className="flex items-center gap-2 mb-2">
                  <Tag size={12} className="text-black/30" />
                  <span className="text-xs font-semibold text-black/40">
                    {t('billing.discount_code', { defaultValue: 'Discount code' })}
                  </span>
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={promoCode}
                    onChange={(e) => {
                      setPromoCode(e.target.value)
                      setPromoStatus('idle')
                      setPromoDetail(null)
                    }}
                    placeholder={t('billing.enter_code', { defaultValue: 'Enter code' })}
                    className="flex-1 px-3 py-2 text-sm rounded-lg border border-black/[0.08] bg-black/[0.02] focus:outline-none focus:border-black/20 transition-colors"
                  />
                  <button
                    type="button"
                    onClick={handleApplyPromo}
                    disabled={!promoCode.trim() || promoStatus === 'validating'}
                    className="px-4 py-2 text-xs font-bold rounded-lg bg-black/[0.06] text-black/60 hover:bg-black/[0.1] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {promoStatus === 'validating'
                      ? t('billing.checking', { defaultValue: 'Checking...' })
                      : t('billing.apply', { defaultValue: 'Apply' })}
                  </button>
                </div>
                {promoStatus === 'valid' && promoDetail && (
                  <p className="mt-2 text-xs font-medium text-green-600 flex items-center gap-1.5">
                    <Check size={12} />
                    {t('billing.code_applied', { defaultValue: 'Code applied' })}
                    {promoDetail.percentOff ? ` — ${promoDetail.percentOff}% off` : ''}
                    {promoDetail.amountOff ? ` — ${promoDetail.currency?.toUpperCase() ?? '$'}${promoDetail.amountOff} off` : ''}
                  </p>
                )}
                {promoStatus === 'invalid' && (
                  <p className="mt-2 text-xs font-medium text-red-500">
                    {t('billing.invalid_code', { defaultValue: 'Invalid or expired code' })}
                  </p>
                )}
              </div>
            )}

            {/* CTA */}
            <div className="px-6 py-5 border-t border-black/[0.06]">
              <button
                type="button"
                onClick={handleConfirm}
                disabled={loading}
                className={`w-full flex items-center justify-center gap-2 px-5 py-3 rounded-xl text-[14px] font-bold transition-all duration-200 ${selectedPlanData.ctaStyle} ${loading ? 'opacity-70 cursor-not-allowed' : 'cursor-pointer'}`}
              >
                {loading ? (
                  <>
                    <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                    {hasExistingSub && selectedPlan === 'free'
                      ? t('billing.canceling_subscription', { defaultValue: 'Canceling subscription...' })
                      : hasExistingSub
                        ? t('billing.switching_plan', { defaultValue: 'Switching plan...' })
                        : t('billing.redirecting', { defaultValue: 'Redirecting to Stripe...' })}
                  </>
                ) : (
                  <>
                    {hasExistingSub && selectedPlan === 'free'
                      ? t('billing.confirm_cancellation', { defaultValue: 'Confirm cancellation' })
                      : hasExistingSub
                        ? isUpgrade
                          ? t('billing.confirm_upgrade', { defaultValue: 'Confirm upgrade' })
                          : t('billing.confirm_downgrade', { defaultValue: 'Confirm downgrade' })
                        : t('billing.continue_to_payment', { defaultValue: 'Continue to payment' })}
                    <ArrowRight size={15} />
                  </>
                )}
              </button>
              {!hasExistingSub && (
                <p className="flex items-center justify-center gap-1.5 text-[11px] text-black/25 font-medium mt-3">
                  <Lock size={10} className="text-black/20" />
                  {t('billing.secure_checkout', { defaultValue: 'Secure checkout powered by Stripe' })}
                </p>
              )}
              <button
                type="button"
                onClick={() => {
                  setView('choose-plan')
                  setSelectedPlan(null)
                }}
                className="w-full mt-2 text-center text-xs font-medium text-black/30 hover:text-black/50 transition-colors py-1.5"
              >
                {t('billing.back_to_plans', { defaultValue: 'Back to plans' })}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Success View */}
      {view === 'success' && selectedPlanData && (
        <div className="max-w-md mx-auto">
          <div className="bg-white rounded-2xl nice-shadow overflow-hidden text-center px-8 py-12">
            <div className="mx-auto w-14 h-14 rounded-2xl bg-green-50 border border-green-200 flex items-center justify-center mb-5">
              <Check size={24} className="text-green-600" />
            </div>
            <h2 className="text-xl font-black tracking-tight text-black">
              {isUpgrade
                ? t('billing.plan_updated', { defaultValue: 'Plan updated!' })
                : selectedPlan === 'free'
                  ? t('billing.subscription_canceled', { defaultValue: 'Subscription canceled' })
                  : t('billing.downgrade_scheduled', { defaultValue: 'Downgrade scheduled' })}
            </h2>
            <p className="mt-2 text-sm text-black/40 leading-relaxed">
              {isUpgrade
                ? t('billing.updated_desc', {
                    defaultValue: `You've been switched to the ${selectedPlanData.name} plan. Any billing adjustments will appear on your next invoice.`,
                  })
                : selectedPlan === 'free'
                  ? t('billing.canceled_desc', {
                      defaultValue:
                        "Your subscription will be canceled at the end of your current billing period. You'll keep full access until then.",
                    })
                  : t('billing.scheduled_desc', {
                      defaultValue: `Your plan will switch to ${selectedPlanData.name} at the end of your current billing cycle. You'll keep full access to your current plan until then.`,
                    })}
            </p>
            <button
              onClick={onBack}
              className="inline-flex items-center gap-2 mt-6 px-5 py-2.5 bg-black text-white rounded-xl text-sm font-bold hover:bg-black/80 transition-colors"
            >
              {t('billing.back_to_plan_usage', { defaultValue: 'Back to Plan & Usage' })}
              <ArrowRight size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
