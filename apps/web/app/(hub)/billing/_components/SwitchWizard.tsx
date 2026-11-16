'use client'
// The upgrade / plan-switch flow: choose a plan (cards + Free strip + compare
// table, styled like the marketing pricing page), review the change (current vs
// new plan, price change, when it takes effect, what you gain or lose), done.
import React, { useEffect, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  ArrowsLeftRight,
  CalendarBlank,
  Check,
  CheckCircle,
  LockSimple,
  Minus,
  Tag,
} from '@phosphor-icons/react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { Button, Eyebrow, INPUT, Panel, SegmentedControl, buttonClass } from '@/design'
import { formatDate } from '@/lib/format'
import DowngradePreview from '@components/Billing/DowngradePreview'
import type { DowngradePreview as DowngradePreviewData } from '@services/orgs/planOverview'
import {
  findPlan,
  calcPrice,
  applyPlanLimits,
  ANNUAL_DISCOUNT,
  type Plan,
  type PlanId,
  type Billing,
  type PriceOverrides,
  type PlanLimits,
} from '../_lib/plans'
import { billingCheckout, billingSwitch, billingCancel, validatePromo } from '../_lib/billingClient'
import PricingGrid from './PricingGrid'
import PlanComparison from './PlanComparison'
import { planName } from '../../_billing/planText'
import {
  ACCENT,
  CARD_PLANS,
  PlanBadge,
  accentFor,
  annualTotal,
  featureDiff,
  formatPlanMoney,
  patternStyle,
  planHighlights,
  rowLabel,
  type CardPlanId,
} from './planDisplay'

type SwitchView = 'choose-plan' | 'confirm' | 'success'

/** Enterprise is sold by talking to us: it has no self-serve price, so it can
 *  never be checked out from the Confirm step. */
const isSelfServe = (planId: string | null | undefined) => !!planId && planId !== 'enterprise'

const ENTERPRISE_CONTACT = 'https://learnhouse.app/contact?subject=enterprise'
const CTA = 'flex w-full items-center justify-center gap-2 px-5 py-3 rounded-lg text-[14px] font-bold transition-colors'
const GAIN_PREVIEW = 8

interface SwitchWizardProps {
  org: any
  currentPlanId: string
  hasExistingSub: boolean
  /** How the current subscription is billed (for the price-change line). */
  currentBilling?: Billing | null
  /** End of the paid period (unix seconds): when a downgrade or cancel lands. */
  currentPeriodEnd?: number | null
  priceOverrides?: PriceOverrides
  pricesLoading?: boolean
  planLimits?: PlanLimits
  /** Deep-link: pre-select this plan and open straight at the Confirm step
   *  (from an "Upgrade to X" CTA). Ignored if unknown or already the current plan. */
  initialPlanId?: string | null
  /** The plan a running free trial unlocks: offered as "Keep <plan>". */
  trialPlanId?: string | null
  /** What a move to Free would change, shown when confirming a cancellation. */
  downgradePreview?: DowngradePreviewData | null
  /** Return to the Plan & Usage view. */
  onBack: () => void
  /** Invalidate cached subscription/org state after a successful change. */
  onChanged: () => void
}

export default function SwitchWizard({
  org,
  currentPlanId,
  hasExistingSub,
  currentBilling = null,
  currentPeriodEnd = null,
  priceOverrides,
  pricesLoading = false,
  planLimits,
  initialPlanId,
  trialPlanId = null,
  downgradePreview = null,
  onBack,
  onChanged,
}: SwitchWizardProps) {
  const { t, i18n } = useTranslation()
  const lng = i18n.language

  const [view, setView] = useState<SwitchView>('choose-plan')
  const [selectedPlan, setSelectedPlan] = useState<PlanId | null>(null)
  const [billing, setBilling] = useState<Billing>(currentBilling ?? 'annual')
  const [loading, setLoading] = useState(false)
  const [highlightPlan, setHighlightPlan] = useState<string | null>(null)
  const [promoCode, setPromoCode] = useState('')
  const [promoStatus, setPromoStatus] = useState<'idle' | 'validating' | 'valid' | 'invalid'>('idle')
  const [promoDetail, setPromoDetail] = useState<{ percentOff?: number; amountOff?: number; currency?: string } | null>(null)
  const [showAllGains, setShowAllGains] = useState(false)

  // Deep-link: if an "Upgrade to X" CTA passed a target plan, jump straight to the
  // Confirm step for it (skip the plan grid). Only when it's a real plan the org
  // isn't already on. Runs once on mount.
  useEffect(() => {
    if (!initialPlanId || initialPlanId === currentPlanId) return
    if (!findPlan(initialPlanId)) return
    if (!isSelfServe(initialPlanId)) {
      // Stay on the plan grid and point at the Enterprise "talk to us" card.
      setHighlightPlan(initialPlanId)
      return
    }
    setSelectedPlan(initialPlanId as PlanId)
    setView('confirm')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Each step starts at the top of the page.
  useEffect(() => {
    if (typeof window !== 'undefined') document.querySelector('[data-billing-scroll]')?.scrollTo({ top: 0 })
  }, [view])

  const withLimits = (id: string): Plan | undefined => {
    const p = findPlan(id)
    return p ? applyPlanLimits(p, planLimits) : undefined
  }
  const selectedPlanData = selectedPlan ? withLimits(selectedPlan) ?? null : null
  const currentPlanData = withLimits(currentPlanId)
  const newPrice = selectedPlanData ? calcPrice(selectedPlanData.monthlyPrice, billing, selectedPlan!, priceOverrides) : 0
  const currentPrice = currentPlanData
    ? calcPrice(currentPlanData.monthlyPrice, currentBilling ?? billing, currentPlanId, priceOverrides)
    : 0
  // Upgrade vs downgrade follows the plan ladder (catalog price), the same rule
  // the cards use, so the wording never flips between the two steps.
  const isUpgrade = (selectedPlanData?.monthlyPrice ?? 0) > (currentPlanData?.monthlyPrice ?? 0)
  const toFree = selectedPlan === 'free'
  const isCancel = hasExistingSub && toFree
  const periodEndLabel = currentPeriodEnd ? formatDate(currentPeriodEnd * 1000, lng) : null
  const money = (n: number, planId: string) => formatPlanMoney(n, planId, priceOverrides, lng)
  const name = (p: { id: string; name: string } | undefined, fallback: string) => (p ? planName(t, p) : fallback)

  const annualSavePct = (() => {
    const o = priceOverrides?.standard
    if (o && o.monthly > 0 && o.annualPerMonth > 0) return Math.round((1 - o.annualPerMonth / o.monthly) * 100)
    return Math.round(ANNUAL_DISCOUNT * 100)
  })()

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

  function handlePlanSelect(planId: string) {
    if (planId === currentPlanId || !isSelfServe(planId)) return
    setSelectedPlan(planId as PlanId)
    setShowAllGains(false)
    setView('confirm')
  }

  async function handleConfirm() {
    if (!selectedPlan || !org?.id || !isSelfServe(selectedPlan)) return
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
      toast.error(err?.message ?? t('billing.flow.generic_error', { defaultValue: 'Something went wrong. Please try again.' }))
    } finally {
      setLoading(false)
    }
  }

  const billingToggle = (
    <SegmentedControl<Billing>
      ariaLabel={t('billing.flow.billing_period', { defaultValue: 'Billing period' })}
      value={billing}
      onChange={setBilling}
      options={[
        { key: 'monthly', label: t('billing.pricing.monthly', { defaultValue: 'Monthly' }) },
        {
          key: 'annual',
          label: (
            <>
              {t('billing.pricing.annual', { defaultValue: 'Annual' })}
              {annualSavePct > 0 && (
                <span className="text-[10px] font-bold text-white bg-emerald-500 px-1.5 py-0.5 rounded-full leading-none">
                  {t('billing.pricing.save_pct', { pct: annualSavePct })}
                </span>
              )}
            </>
          ),
        },
      ]}
    />
  )

  // ── Choose ────────────────────────────────────────────────────────────────

  if (view === 'choose-plan') {
    const currentLabel = trialPlanId
      ? t('billing.flow.after_trial', { defaultValue: 'After your trial' })
      : t('billing.flow.current_plan', { defaultValue: 'Current plan' })

    return (
      <div className="pt-2 pb-16" data-testid="switch-choose">
        <Button variant="ghost" size="md" onClick={onBack} icon={<ArrowLeft size={14} className="rtl:rotate-180" />}>
          {t('billing.back_to_plan_usage', { defaultValue: 'Back to Plan & Usage' })}
        </Button>

        <div className="mt-6 text-center">
          <h1 className="text-black font-black text-[30px] md:text-[44px] leading-[1.08] tracking-tight text-balance">
            {hasExistingSub
              ? t('billing.flow.title_switch', { defaultValue: 'Change your plan' })
              : t('billing.flow.title_upgrade', { defaultValue: 'Pick the plan that fits' })}
          </h1>
          <p className="mt-3 text-black/50 text-[15px] md:text-base font-medium max-w-2xl mx-auto text-balance">
            {hasExistingSub
              ? t('billing.flow.subtitle_switch', {
                  defaultValue: 'Upgrades start today and are prorated. Downgrades start when your current period ends.',
                })
              : t('billing.flow.subtitle_upgrade', {
                  defaultValue: 'Courses, live classes, Atlas AI, payments and analytics in one place. Cancel anytime.',
                })}
          </p>

          <div className="mt-6 flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-5">
            <p className="inline-flex items-center gap-2 text-[13px] font-medium text-black/50">
              {trialPlanId ? (
                <>
                  {t('billing.flow.on_trial_of', { defaultValue: 'Free trial of' })}
                  <PlanBadge accent={accentFor(trialPlanId)}>{name(findPlan(trialPlanId), trialPlanId)}</PlanBadge>
                </>
              ) : (
                <>
                  {t('billing.flow.you_are_on', { defaultValue: "You're on" })}
                  <PlanBadge accent={accentFor(currentPlanId)}>{name(currentPlanData, currentPlanId)}</PlanBadge>
                </>
              )}
            </p>
            <span aria-hidden="true" className="hidden sm:block h-4 w-px bg-black/10" />
            {billingToggle}
          </div>
        </div>

        <div className="mt-10">
          <PricingGrid
            annual={billing === 'annual'}
            priceOverrides={priceOverrides}
            pricesLoading={pricesLoading}
            planLimits={planLimits}
            currentPlanId={currentPlanId}
            highlightPlanId={highlightPlan}
            currentLabel={currentLabel}
            renderCta={(plan) => {
              const dark = plan.id === 'enterprise'
              if (plan.id === currentPlanId) {
                return (
                  <span
                    className={`${CTA} cursor-default ${dark ? 'bg-white/10 text-white/50' : 'bg-black/[0.04] text-black/35'}`}
                    aria-disabled="true"
                  >
                    <Check size={14} weight="bold" />
                    {currentLabel}
                  </span>
                )
              }
              if (dark) {
                return (
                  <a href={ENTERPRISE_CONTACT} target="_blank" rel="noopener noreferrer" className={`${CTA} ${ACCENT.enterprise.cta}`}>
                    {t('billing.pricing.talk_to_us', { defaultValue: 'Talk to us' })}
                  </a>
                )
              }
              if (plan.id === 'free') {
                // Free is only reachable by cancelling a subscription.
                if (!hasExistingSub) return null
                return (
                  <button type="button" onClick={() => handlePlanSelect('free')} className={buttonClass('secondary', 'lg', 'w-full')}>
                    {t('billing.flow.downgrade_to', { plan: planName(t, plan) })}
                  </button>
                )
              }
              const up = plan.monthlyPrice > (currentPlanData?.monthlyPrice ?? 0)
              return (
                <button
                  type="button"
                  onClick={() => handlePlanSelect(plan.id)}
                  className={up ? `${CTA} ${ACCENT[accentFor(plan.id)].cta}` : buttonClass('secondary', 'lg', 'w-full !h-11')}
                >
                  {plan.id === trialPlanId
                    ? t('billing.trial.keep', { plan: planName(t, plan) })
                    : up
                      ? t('billing.flow.upgrade_to', { plan: planName(t, plan) })
                      : t('billing.flow.downgrade_to', { plan: planName(t, plan) })}
                </button>
              )
            }}
          />
        </div>

        <div className="mt-16 md:mt-20">
          <PlanComparison planLimits={planLimits} currentPlanId={currentPlanId} />
        </div>
      </div>
    )
  }

  // ── Confirm ───────────────────────────────────────────────────────────────

  if (view === 'confirm' && selectedPlanData && isSelfServe(selectedPlan)) {
    const newAccent = accentFor(selectedPlan!)
    const currentAccent = accentFor(currentPlanId)
    const fromPaid = currentPrice > 0
    const delta = newPrice - currentPrice
    const total = billing === 'annual' ? annualTotal(selectedPlan!, newPrice, priceOverrides) : newPrice
    const diff = featureDiff(t, currentPlanId, selectedPlan!)
    const gains =
      diff?.gained.map((r) => rowLabel(t, r.key)) ??
      ((CARD_PLANS as readonly string[]).includes(selectedPlan!)
        ? planHighlights(t, selectedPlan as CardPlanId, planLimits).map((h) => h.label)
        : selectedPlanData.features.map((f) => f.label))
    const losses =
      diff?.lost.map((r) => rowLabel(t, r.key)) ??
      ((CARD_PLANS as readonly string[]).includes(currentPlanId)
        ? planHighlights(t, currentPlanId as CardPlanId, planLimits).map((h) => h.label)
        : [])
    const shownGains = showAllGains ? gains : gains.slice(0, GAIN_PREVIEW)

    const when = !hasExistingSub
      ? {
          title: t('billing.flow.when_checkout_title', { defaultValue: 'Starts right after checkout' }),
          desc: t('billing.flow.when_checkout_desc', {
            defaultValue: 'You will enter your payment details on Stripe. Your new plan is active as soon as payment goes through.',
          }),
        }
      : isUpgrade
        ? {
            title: t('billing.flow.when_today_title', { defaultValue: 'Starts today' }),
            desc: t('billing.prorated_desc', {
              defaultValue:
                "You'll be credited for the unused time on your current plan and charged the difference for the new plan. The change takes effect immediately.",
            }),
          }
        : {
            title: periodEndLabel
              ? t('billing.flow.when_period_end_title', { date: periodEndLabel })
              : t('billing.flow.when_period_end_title_unknown', { defaultValue: 'Starts when your current period ends' }),
            desc: isCancel
              ? t('billing.cancel_desc', {
                  defaultValue:
                    "Your subscription will be canceled at the end of the current billing period. You'll keep full access until then.",
                })
              : t('billing.downgrade_desc', {
                  defaultValue:
                    "You'll keep your current plan until the end of the billing period. The new plan will take effect automatically when your current cycle ends.",
                }),
          }

    const tile = (kind: 'current' | 'new') => {
      const isNew = kind === 'new'
      const accent = isNew ? newAccent : currentAccent
      const plan = isNew ? selectedPlanData : currentPlanData
      const id = isNew ? selectedPlan! : currentPlanId
      const price = isNew ? newPrice : currentPrice
      const per = isNew ? billing : (currentBilling ?? billing)
      return (
        <div
          className={`relative overflow-hidden rounded-xl p-5 min-w-0 ${
            isNew ? `bg-white ring-2 ${ACCENT[accent].ring}` : 'bg-neutral-50 ring-1 ring-inset ring-black/[0.06]'
          }`}
        >
          {isNew && <div aria-hidden="true" className="absolute inset-x-0 top-0 h-[90px] pointer-events-none" style={patternStyle(ACCENT[accent].pat)} />}
          <div className="relative">
            <Eyebrow>
              {isNew
                ? t('billing.flow.new_plan', { defaultValue: 'New plan' })
                : trialPlanId
                  ? t('billing.flow.after_trial', { defaultValue: 'After your trial' })
                  : t('billing.flow.current_plan', { defaultValue: 'Current plan' })}
            </Eyebrow>
            <div className="mt-2.5">
              <PlanBadge accent={accent}>{name(plan, id)}</PlanBadge>
            </div>
            <div className="mt-4 flex items-baseline gap-1">
              <span className={`text-[28px] font-black leading-none tracking-tight tabular-nums ${isNew ? 'text-black' : 'text-black/50'}`}>
                {pricesLoading && price > 0 ? '…' : money(price, id)}
              </span>
              {price > 0 && <span className="text-sm font-medium text-black/35">{t('billing.pricing.per_month', { defaultValue: '/mo' })}</span>}
            </div>
            <p className="mt-1.5 text-[12.5px] font-medium text-black/40">
              {price === 0
                ? t('billing.flow.no_charge', { defaultValue: 'No charge' })
                : per === 'annual'
                  ? t('billing.flow.billed_yearly', { amount: money(annualTotal(id, price, priceOverrides), id) })
                  : t('billing.flow.billed_monthly', { defaultValue: 'Billed monthly' })}
            </p>
          </div>
        </div>
      )
    }

    return (
      <div className="pt-2 pb-16 max-w-6xl mx-auto" data-testid="switch-confirm">
        <Button
          variant="ghost"
          size="md"
          onClick={() => {
            setView('choose-plan')
            setSelectedPlan(null)
          }}
          icon={<ArrowLeft size={14} className="rtl:rotate-180" />}
        >
          {t('billing.back_to_plans', { defaultValue: 'Back to plans' })}
        </Button>

        <div className="mt-5">
          <h1 className="text-black font-black text-[28px] md:text-[36px] leading-[1.1] tracking-tight">
            {isCancel
              ? t('billing.flow.confirm_title_cancel', { defaultValue: 'Move to Free' })
              : isUpgrade
                ? t('billing.flow.confirm_title_upgrade', { plan: planName(t, selectedPlanData) })
                : t('billing.flow.confirm_title_downgrade', { plan: planName(t, selectedPlanData) })}
          </h1>
          <p className="mt-2 text-[15px] font-medium text-black/50">
            {t('billing.flow.confirm_subtitle', { defaultValue: 'Check what changes, then confirm.' })}
          </p>
        </div>

        <div className="mt-8 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_380px] gap-5 items-start">
          {/* What changes */}
          <div className="flex flex-col gap-5 min-w-0">
            <Panel padded className="!p-6">
              <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3">
                {tile('current')}
                <div className="flex justify-center">
                  <span className="w-9 h-9 rounded-full bg-white nice-shadow grid place-items-center text-black/40">
                    <ArrowRight size={16} weight="bold" className="rotate-90 sm:rotate-0 rtl:sm:rotate-180" />
                  </span>
                </div>
                {tile('new')}
              </div>

              <div className="mt-5 flex items-start gap-3 rounded-xl bg-neutral-50 ring-1 ring-inset ring-black/[0.05] px-4 py-3.5">
                <CalendarBlank size={18} weight="duotone" className="mt-0.5 shrink-0 text-black/45" />
                <div className="min-w-0">
                  <p className="text-[13.5px] font-semibold text-black/80">{when.title}</p>
                  <p className="mt-0.5 text-[12.5px] leading-relaxed text-black/50">{when.desc}</p>
                </div>
              </div>
            </Panel>

            {isUpgrade || !hasExistingSub ? (
              gains.length > 0 && (
                <Panel padded className="!p-6">
                  <h2 className="text-[15px] font-bold text-black">
                    {t('billing.flow.you_gain', { plan: planName(t, selectedPlanData) })}
                  </h2>
                  <ul className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2.5">
                    {shownGains.map((g) => (
                      <li key={g} className="flex items-start gap-2.5 text-[13.5px] font-medium text-black/65">
                        <CheckCircle size={17} weight="duotone" className={`mt-[1px] shrink-0 ${ACCENT[newAccent].icon}`} />
                        {g}
                      </li>
                    ))}
                  </ul>
                  {gains.length > GAIN_PREVIEW && (
                    <button
                      type="button"
                      onClick={() => setShowAllGains((v) => !v)}
                      className="mt-4 text-[13px] font-semibold text-black/50 hover:text-black transition-colors"
                    >
                      {showAllGains
                        ? t('billing.flow.show_less', { defaultValue: 'Show less' })
                        : t('billing.flow.and_more', { count: gains.length - GAIN_PREVIEW })}
                    </button>
                  )}
                </Panel>
              )
            ) : isCancel && downgradePreview ? (
              <Panel padded className="!p-6">
                <h2 className="text-[15px] font-bold text-black">{t('billing.flow.what_changes_free', { defaultValue: 'What changes on Free' })}</h2>
                <DowngradePreview preview={downgradePreview} className="mt-3" />
              </Panel>
            ) : (
              losses.length > 0 && (
                <Panel padded className="!p-6">
                  <h2 className="text-[15px] font-bold text-black">
                    {t('billing.flow.you_lose', { plan: name(currentPlanData, currentPlanId) })}
                  </h2>
                  <ul className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2.5">
                    {losses.map((g) => (
                      <li key={g} className="flex items-start gap-2.5 text-[13.5px] font-medium text-black/55">
                        <span className="mt-[2px] shrink-0 w-[17px] h-[17px] rounded-full bg-rose-50 text-rose-500 grid place-items-center">
                          <Minus size={10} weight="bold" />
                        </span>
                        {g}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-4 text-[12.5px] text-black/40">
                    {t('billing.flow.nothing_deleted', {
                      defaultValue: 'Nothing is deleted. Upgrade again any time and everything comes back.',
                    })}
                  </p>
                </Panel>
              )
            )}
          </div>

          {/* Summary + action */}
          <Panel className="overflow-hidden lg:sticky lg:top-6">
            <div className="px-6 pt-6 pb-5">
              <h2 className="text-[15px] font-bold text-black">{t('billing.flow.summary', { defaultValue: 'Summary' })}</h2>
              {!toFree && <div className="mt-4">{billingToggle}</div>}

              <dl className="mt-5 space-y-3 text-[13.5px]">
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-black/50">{t('billing.flow.plan_line', { plan: planName(t, selectedPlanData) })}</dt>
                  <dd className="font-semibold text-black tabular-nums">
                    {money(newPrice, selectedPlan!)}
                    {newPrice > 0 && <span className="text-black/40 font-medium">{t('billing.pricing.per_month', { defaultValue: '/mo' })}</span>}
                  </dd>
                </div>
                {hasExistingSub && fromPaid && (
                  <div className="flex items-center justify-between gap-4">
                    <dt className="flex items-center gap-1.5 text-black/50">
                      <ArrowsLeftRight size={14} className="text-black/30" />
                      {t('billing.flow.change_vs_now', { defaultValue: 'Change from today' })}
                    </dt>
                    <dd className={`font-semibold tabular-nums ${delta > 0 ? 'text-black' : 'text-emerald-700'}`}>
                      {delta > 0 ? '+' : delta < 0 ? '−' : ''}
                      {money(Math.abs(delta), selectedPlan!)}
                      <span className="text-black/40 font-medium">{t('billing.pricing.per_month', { defaultValue: '/mo' })}</span>
                    </dd>
                  </div>
                )}
                {promoStatus === 'valid' && promoDetail && (
                  <div className="flex items-center justify-between gap-4">
                    <dt className="flex items-center gap-1.5 text-emerald-700">
                      <Tag size={14} />
                      {t('billing.code_applied', { defaultValue: 'Code applied' })}
                    </dt>
                    <dd className="font-semibold text-emerald-700 tabular-nums">
                      {promoDetail.percentOff
                        ? t('billing.flow.percent_off', { pct: promoDetail.percentOff })
                        : promoDetail.amountOff
                          ? t('billing.flow.amount_off', {
                              amount: formatPlanMoney(promoDetail.amountOff, selectedPlan!, priceOverrides, lng),
                            })
                          : ''}
                    </dd>
                  </div>
                )}
              </dl>

              <div className="mt-4 pt-4 border-t border-black/[0.06] flex items-end justify-between gap-4">
                <span className="text-[13.5px] font-semibold text-black/70">
                  {toFree
                    ? t('billing.flow.after_change', { defaultValue: 'After the change' })
                    : billing === 'annual'
                      ? t('billing.annual_total', { defaultValue: 'Annual total' })
                      : t('billing.monthly_total', { defaultValue: 'Monthly total' })}
                </span>
                <span className="text-end">
                  <span className="block text-[24px] font-black leading-none tracking-tight text-black tabular-nums">
                    {pricesLoading && !toFree ? '…' : money(total, selectedPlan!)}
                  </span>
                  {!toFree && (
                    <span className="block mt-1 text-[11.5px] font-medium text-black/40">
                      {billing === 'annual'
                        ? t('billing.flow.per_year', { defaultValue: 'per year' })
                        : t('billing.flow.per_month_long', { defaultValue: 'per month' })}
                      {promoStatus === 'valid' ? ` · ${t('billing.flow.before_discount', { defaultValue: 'before discount' })}` : ''}
                    </span>
                  )}
                </span>
              </div>
            </div>

            {!toFree && (
              <div className="px-6 py-4 border-t border-black/[0.06] bg-neutral-50/60">
                <label htmlFor="promo-code" className="flex items-center gap-1.5 text-[12px] font-semibold text-black/45 mb-2">
                  <Tag size={12} />
                  {t('billing.discount_code', { defaultValue: 'Discount code' })}
                </label>
                <div className="flex gap-2">
                  <input
                    id="promo-code"
                    type="text"
                    value={promoCode}
                    onChange={(e) => {
                      setPromoCode(e.target.value)
                      setPromoStatus('idle')
                      setPromoDetail(null)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleApplyPromo()
                    }}
                    placeholder={t('billing.enter_code', { defaultValue: 'Enter code' })}
                    className={INPUT}
                  />
                  <Button
                    variant="secondary"
                    size="lg"
                    onClick={handleApplyPromo}
                    disabled={!promoCode.trim()}
                    loading={promoStatus === 'validating'}
                  >
                    {t('billing.apply', { defaultValue: 'Apply' })}
                  </Button>
                </div>
                {promoStatus === 'invalid' && (
                  <p className="mt-2 text-xs font-medium text-rose-600">{t('billing.invalid_code', { defaultValue: 'Invalid or expired code' })}</p>
                )}
              </div>
            )}

            <div className="px-6 py-5 border-t border-black/[0.06]">
              <button
                type="button"
                onClick={handleConfirm}
                disabled={loading}
                data-testid="switch-confirm-cta"
                className={`${CTA} ${ACCENT[newAccent].cta} ${loading ? 'opacity-70 cursor-not-allowed' : 'cursor-pointer'}`}
              >
                {loading ? (
                  <>
                    <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                    {isCancel
                      ? t('billing.canceling_subscription', { defaultValue: 'Canceling subscription...' })
                      : hasExistingSub
                        ? t('billing.switching_plan', { defaultValue: 'Switching plan...' })
                        : t('billing.redirecting', { defaultValue: 'Redirecting to Stripe...' })}
                  </>
                ) : (
                  <>
                    {isCancel
                      ? t('billing.confirm_cancellation', { defaultValue: 'Confirm cancellation' })
                      : hasExistingSub
                        ? isUpgrade
                          ? t('billing.confirm_upgrade', { defaultValue: 'Confirm upgrade' })
                          : t('billing.confirm_downgrade', { defaultValue: 'Confirm downgrade' })
                        : t('billing.continue_to_payment', { defaultValue: 'Continue to payment' })}
                    <ArrowRight size={15} weight="bold" className="rtl:rotate-180" />
                  </>
                )}
              </button>
              {!hasExistingSub && (
                <p className="flex items-center justify-center gap-1.5 text-[11.5px] text-black/35 font-medium mt-3">
                  <LockSimple size={11} />
                  {t('billing.secure_checkout', { defaultValue: 'Secure checkout powered by Stripe' })}
                </p>
              )}
            </div>
          </Panel>
        </div>
      </div>
    )
  }

  // ── Done ──────────────────────────────────────────────────────────────────

  if (view === 'success' && selectedPlanData) {
    return (
      <div className="pt-10 pb-16 max-w-lg mx-auto" data-testid="switch-success">
        <Panel className="text-center px-8 py-12">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-emerald-50 ring-1 ring-inset ring-emerald-600/10 flex items-center justify-center mb-5">
            <Check size={24} weight="bold" className="text-emerald-600" />
          </div>
          <h2 className="text-[22px] font-black tracking-tight text-black">
            {isUpgrade
              ? t('billing.plan_updated', { defaultValue: 'Plan updated!' })
              : selectedPlan === 'free'
                ? t('billing.subscription_canceled', { defaultValue: 'Subscription canceled' })
                : t('billing.downgrade_scheduled', { defaultValue: 'Downgrade scheduled' })}
          </h2>
          <p className="mt-2 text-sm text-black/45 leading-relaxed">
            {isUpgrade
              ? t('billing.updated_desc', {
                  defaultValue: `You've been switched to the ${selectedPlanData.name} plan. Any billing adjustments will appear on your next invoice.`,
                  plan: planName(t, selectedPlanData),
                })
              : selectedPlan === 'free'
                ? t('billing.canceled_desc', {
                    defaultValue:
                      "Your subscription will be canceled at the end of your current billing period. You'll keep full access until then.",
                  })
                : t('billing.scheduled_desc', {
                    defaultValue: `Your plan will switch to ${selectedPlanData.name} at the end of your current billing cycle. You'll keep full access to your current plan until then.`,
                    plan: planName(t, selectedPlanData),
                  })}
          </p>
          <div className="mt-6 flex justify-center">
            <Button variant="primary" size="lg" onClick={onBack}>
              {t('billing.back_to_plan_usage', { defaultValue: 'Back to Plan & Usage' })}
            </Button>
          </div>
        </Panel>
      </div>
    )
  }

  return null
}
