'use client'
import React, { useState } from 'react'
import {
  Boxes,
  ExternalLink,
  X,
  Plus,
  BookOpen,
  Users,
  ShieldCheck,
  Sparkles,
  Zap,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@components/ui/dialog'
import {
  findPlan,
  applyPlanLimits,
  getCurrencySymbol,
  calcPrice,
  PACK_CATALOG,
  getPackPrice,
  getPackCurrencySymbol,
  type PackCatalogEntry,
  type PriceOverrides,
  type PackPrices,
  type PlanLimits,
} from '../_lib/plans'
import {
  billingPortal,
  billingCancel,
  billingPackCheckout,
  type SubscriptionDetail,
} from '../_lib/billingClient'
import UsageBar from './UsageBar'

interface PlanUsageProps {
  org: any
  currentPlanId: string
  isOrgActive: boolean
  subscription: SubscriptionDetail | null
  subLoading: boolean
  usage: any
  aiCredits: any
  packsData: any
  priceOverrides?: PriceOverrides
  packPrices?: PackPrices
  planLimits?: PlanLimits
  /** Open the plan-switch wizard. */
  onSwitch: () => void
  /** Re-fetch subscription/usage after a change. */
  onChanged: () => void
}

export default function PlanUsage({
  org,
  currentPlanId,
  isOrgActive,
  subscription,
  subLoading,
  usage,
  aiCredits,
  packsData,
  priceOverrides,
  packPrices,
  planLimits,
  onSwitch,
  onChanged,
}: PlanUsageProps) {
  const { t } = useTranslation()
  const rawPlan = findPlan(currentPlanId)
  const plan = rawPlan ? applyPlanLimits(rawPlan, planLimits) : undefined

  const [cancelLoading, setCancelLoading] = useState(false)
  const [packLoading, setPackLoading] = useState<string | null>(null)
  const [disclaimerPack, setDisclaimerPack] = useState<PackCatalogEntry | null>(null)

  const features = usage?.features
  const activePacks: any[] = packsData?.active_packs ?? []

  const price = (() => {
    if (!plan || plan.monthlyPrice === 0) return 0
    const billing = subscription?.billing ?? 'monthly'
    return calcPrice(plan.monthlyPrice, billing, currentPlanId, priceOverrides)
  })()

  const periodEnd = subscription?.currentPeriodEnd
    ? new Date(subscription.currentPeriodEnd * 1000).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : null

  async function handleManageBilling() {
    try {
      const { url } = await billingPortal()
      if (!url) {
        toast.error(t('billing.no_billing_account', { defaultValue: 'No billing account found. Subscribe to a plan first.' }))
        return
      }
      window.open(url, '_blank')
    } catch {
      toast.error(t('billing.portal_error', { defaultValue: 'Could not open billing portal. Please try again.' }))
    }
  }

  async function handleCancelSubscription() {
    if (!org?.id) return
    setCancelLoading(true)
    try {
      await billingCancel({ orgId: org.id })
      toast.success(t('billing.cancel_success', { defaultValue: 'Subscription will be canceled at the end of the billing period.' }))
      onChanged()
    } catch {
      toast.error(t('billing.cancel_error', { defaultValue: 'Failed to cancel subscription. Please try again.' }))
    } finally {
      setCancelLoading(false)
    }
  }

  async function handleConfirmPurchase() {
    if (!disclaimerPack || !org?.id) return
    const packId = disclaimerPack.id
    setPackLoading(packId)
    setDisclaimerPack(null)
    try {
      const { url } = await billingPackCheckout({ packId, orgId: org.id, orgSlug: org.slug })
      window.location.href = url
    } catch (err: any) {
      toast.error(err?.message ?? t('billing.checkout_error', { defaultValue: 'Failed to start checkout.' }))
    } finally {
      setPackLoading(null)
    }
  }

  return (
    <div className="pt-2 space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-bold text-2xl tracking-tight text-black">
            {t('billing.plan_and_usage', { defaultValue: 'Plan & Usage' })}
          </h1>
          <p className="mt-1 text-sm text-black/40">
            {t('billing.plan_and_usage_subtitle', { defaultValue: 'Manage your subscription and monitor resource usage.' })}
          </p>
        </div>
        {subscription && (
          <button
            onClick={handleManageBilling}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-black/[0.08] text-black/60 rounded-xl text-[13px] font-semibold hover:bg-black/[0.03] transition-colors flex-shrink-0"
          >
            <ExternalLink size={13} />
            {t('billing.billing', { defaultValue: 'Billing' })}
          </button>
        )}
      </div>

      {/* Alerts */}
      {isOrgActive === false && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-3.5 flex items-center justify-between">
          <p className="text-[13px] font-medium text-red-700">
            {t('billing.org_inactive', { defaultValue: 'Your organization is inactive. Upgrade your plan to restore access.' })}
          </p>
          <button
            onClick={onSwitch}
            className="text-[13px] font-bold px-3.5 py-1.5 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors flex-shrink-0 ml-4"
          >
            {t('billing.upgrade', { defaultValue: 'Upgrade' })}
          </button>
        </div>
      )}
      {subscription?.cancelAtPeriodEnd && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-3.5">
          <p className="text-[13px] font-medium text-amber-700">
            {t('billing.cancels_on', { defaultValue: `Your subscription will cancel on ${periodEnd}. Access continues until then.`, periodEnd })}
          </p>
        </div>
      )}

      {/* Free plan upgrade prompt */}
      {!subscription && !subLoading && currentPlanId === 'free' && (
        <div className="bg-white rounded-2xl nice-shadow overflow-hidden">
          <div className="px-6 py-6 flex items-center justify-between gap-6 flex-wrap">
            <div className="flex items-center gap-4">
              {plan && (
                <span className={`inline-flex px-2.5 py-1 text-xs font-semibold rounded-md border ${plan.badge}`}>
                  {plan.name}
                </span>
              )}
              <div>
                <p className="text-[15px] font-bold text-black">
                  {t('billing.on_free_plan', { defaultValue: "You're on the free plan" })}
                </p>
                <p className="text-[13px] text-black/40 mt-0.5">
                  {t('billing.free_upsell', { defaultValue: 'Upgrade to unlock AI features, custom domains, and more.' })}
                </p>
              </div>
            </div>
            <button
              onClick={onSwitch}
              className="flex items-center gap-2 px-5 py-2.5 bg-black text-white rounded-xl text-[13px] font-semibold hover:bg-black/80 transition-colors flex-shrink-0"
            >
              <Boxes size={14} />
              {t('billing.upgrade', { defaultValue: 'Upgrade' })}
            </button>
          </div>
        </div>
      )}

      {/* Non-Stripe managed plan (e.g. enterprise) */}
      {!subscription && !subLoading && currentPlanId !== 'free' && (
        <div className="bg-white rounded-2xl nice-shadow overflow-hidden">
          <div className="px-6 py-6 flex items-center justify-between gap-6 flex-wrap">
            <div className="flex items-center gap-4">
              {plan && (
                <span className={`inline-flex px-2.5 py-1 text-xs font-semibold rounded-md border ${plan.badge}`}>
                  {plan.name}
                </span>
              )}
              <div>
                <p className="text-[15px] font-bold text-black">
                  {t('billing.on_named_plan', { defaultValue: `You're on the ${plan?.name ?? currentPlanId} plan`, plan: plan?.name ?? currentPlanId })}
                </p>
                <p className="text-[13px] text-black/40 mt-0.5">
                  {t('billing.managed_outside', { defaultValue: 'This plan is managed outside of Stripe billing.' })}
                </p>
              </div>
            </div>
            <span
              className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                isOrgActive
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                  : 'bg-red-50 text-red-600 border border-red-200'
              }`}
            >
              {isOrgActive ? t('billing.active', { defaultValue: 'Active' }) : t('billing.inactive', { defaultValue: 'Inactive' })}
            </span>
          </div>
        </div>
      )}

      {/* Paid plan cards */}
      {subscription && (
        <div className="grid md:grid-cols-3 gap-5">
          {/* Plan card */}
          <div className="bg-white rounded-2xl nice-shadow overflow-hidden">
            <div className="px-5 py-4 border-b border-black/[0.05]">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-black/35 uppercase tracking-wider">
                  {t('billing.current_plan', { defaultValue: 'Current plan' })}
                </p>
                <span
                  className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                    subscription.cancelAtPeriodEnd
                      ? 'bg-amber-50 text-amber-600 border border-amber-200'
                      : isOrgActive
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        : 'bg-red-50 text-red-600 border border-red-200'
                  }`}
                >
                  {subscription.cancelAtPeriodEnd
                    ? t('billing.canceling', { defaultValue: 'Canceling' })
                    : isOrgActive
                      ? t('billing.active', { defaultValue: 'Active' })
                      : t('billing.inactive', { defaultValue: 'Inactive' })}
                </span>
              </div>
            </div>
            <div className="px-5 py-5 space-y-4">
              {plan && (
                <span className={`inline-flex px-2.5 py-1 text-xs font-semibold rounded-md border ${plan.badge}`}>
                  {plan.name}
                </span>
              )}
              <div className="flex items-baseline gap-1">
                <span className="text-[36px] font-black leading-none text-black">
                  {getCurrencySymbol(currentPlanId, priceOverrides)}
                  {price}
                </span>
                <span className="text-sm font-medium text-black/30">/mo</span>
              </div>
              <p className="text-[11px] text-black/30 font-medium">
                {subscription.billing === 'annual'
                  ? `${getCurrencySymbol(currentPlanId, priceOverrides)}${price * 12}/yr · ${t('billing.billed_annually', { defaultValue: 'billed annually' })}`
                  : t('billing.billed_monthly', { defaultValue: 'billed monthly' })}
              </p>
            </div>
            <div className="px-5 py-3 border-t border-black/[0.04] bg-black/[0.01] flex items-center justify-between">
              <button
                onClick={onSwitch}
                className="flex items-center gap-1.5 text-[12px] font-semibold text-black/50 hover:text-black/70 transition-colors"
              >
                <Boxes size={12} />
                {t('billing.change_plan', { defaultValue: 'Change plan' })}
              </button>
              {!subscription.cancelAtPeriodEnd && currentPlanId !== 'free' && (
                <button
                  onClick={handleCancelSubscription}
                  disabled={cancelLoading}
                  className="flex items-center gap-1.5 text-[12px] font-medium text-red-400 hover:text-red-600 transition-colors"
                >
                  <X size={12} />
                  {cancelLoading
                    ? t('billing.canceling_ellipsis', { defaultValue: 'Canceling...' })
                    : t('billing.cancel_plan', { defaultValue: 'Cancel plan' })}
                </button>
              )}
            </div>
          </div>

          {/* Billing card */}
          <div className="bg-white rounded-2xl nice-shadow overflow-hidden">
            <div className="px-5 py-4 border-b border-black/[0.05]">
              <p className="text-xs font-semibold text-black/35 uppercase tracking-wider">
                {t('billing.billing', { defaultValue: 'Billing' })}
              </p>
            </div>
            <div className="px-5 py-5 space-y-5">
              <div>
                <p className="text-[11px] font-semibold text-black/30 uppercase tracking-wider">
                  {t('billing.cycle', { defaultValue: 'Cycle' })}
                </p>
                <p className="mt-1 text-sm font-semibold text-black capitalize">{subscription.billing}</p>
              </div>
              <div>
                <p className="text-[11px] font-semibold text-black/30 uppercase tracking-wider">
                  {subscription.cancelAtPeriodEnd
                    ? t('billing.access_until', { defaultValue: 'Access until' })
                    : t('billing.next_payment', { defaultValue: 'Next payment' })}
                </p>
                <p className="mt-1 text-sm font-semibold text-black">{periodEnd ?? '—'}</p>
              </div>
              <div>
                <p className="text-[11px] font-semibold text-black/30 uppercase tracking-wider">
                  {t('billing.status', { defaultValue: 'Status' })}
                </p>
                <p className="mt-1 text-sm font-semibold text-black capitalize">
                  {subscription.cancelAtPeriodEnd ? t('billing.canceling', { defaultValue: 'Canceling' }) : subscription.status}
                </p>
              </div>
            </div>
          </div>

          {/* Included features */}
          {plan && plan.features.length > 0 && (
            <div className="bg-white rounded-2xl nice-shadow overflow-hidden">
              <div className="px-5 py-4 border-b border-black/[0.05]">
                <div className="flex items-center gap-2">
                  <p className="text-xs font-semibold text-black/35 uppercase tracking-wider">
                    {t('billing.included_in', { defaultValue: `Included in ${plan.name}`, plan: plan.name })}
                  </p>
                  {plan.inheritsFrom && (
                    <span className="text-[10px] font-medium text-black/25">+ {plan.inheritsFrom}</span>
                  )}
                </div>
              </div>
              <div className="px-5 py-3">
                <div className="flex flex-wrap gap-1.5">
                  {plan.features.map((f) => (
                    <span
                      key={f.label}
                      className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium text-black/45 bg-black/[0.03] rounded-md"
                    >
                      {f.label}
                      {f.badge ? ` · ${f.badge}` : ''}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Usage breakdown */}
      <div className="bg-white rounded-2xl nice-shadow overflow-hidden">
        <div className="px-6 py-5 border-b border-black/[0.05]">
          <h2 className="font-bold text-base tracking-tight text-black">
            {t('billing.usage', { defaultValue: 'Usage' })}
          </h2>
        </div>
        <div>
          {features ? (
            <div className="flex items-stretch flex-wrap md:flex-nowrap">
              <div className="flex-1 min-w-[200px] px-6 py-6">
                <UsageBar
                  label={t('billing.courses', { defaultValue: 'Courses' })}
                  icon={<BookOpen size={14} className="text-blue-600" />}
                  usage={features.courses.usage}
                  limit={features.courses.limit}
                  color="bg-blue-50"
                />
              </div>
              <div className="w-px bg-black/[0.06]" />
              <div className="flex-1 min-w-[200px] px-6 py-6">
                <UsageBar
                  label={t('billing.members', { defaultValue: 'Members' })}
                  icon={<Users size={14} className="text-violet-600" />}
                  usage={features.members.usage}
                  limit={features.members.limit}
                  color="bg-violet-50"
                />
                {features.members.purchased > 0 && (
                  <p className="text-[10px] text-black/25 font-medium mt-1">
                    {t('billing.plan_plus_purchased', {
                      defaultValue: `Plan: ${features.members.plan_limit} + Purchased: ${features.members.purchased}`,
                      plan: features.members.plan_limit,
                      purchased: features.members.purchased,
                    })}
                  </p>
                )}
              </div>
              <div className="w-px bg-black/[0.06]" />
              <div className="flex-1 min-w-[200px] px-6 py-6">
                <UsageBar
                  label={t('billing.admin_seats', { defaultValue: 'Admin seats' })}
                  icon={<ShieldCheck size={14} className="text-amber-600" />}
                  usage={features.admin_seats.usage}
                  limit={features.admin_seats.limit}
                  color="bg-amber-50"
                />
              </div>
              {aiCredits && (aiCredits.total_credits === 'unlimited' || aiCredits.total_credits > 0) && (
                <>
                  <div className="w-px bg-black/[0.06]" />
                  <div className="flex-1 min-w-[200px] px-6 py-6">
                    <UsageBar
                      label={t('billing.ai_credits', { defaultValue: 'AI Credits' })}
                      icon={<Sparkles size={14} className="text-violet-600" />}
                      usage={aiCredits.used_credits}
                      limit={aiCredits.total_credits === 'unlimited' ? 'unlimited' : aiCredits.total_credits}
                      color="bg-violet-50"
                    />
                    {aiCredits.purchased_credits > 0 && (
                      <p className="text-[10px] text-black/25 font-medium mt-1">
                        {t('billing.base_plus_purchased', {
                          defaultValue: `Base: ${aiCredits.base_credits.toLocaleString()} + Purchased: ${aiCredits.purchased_credits.toLocaleString()}`,
                          base: aiCredits.base_credits.toLocaleString(),
                          purchased: aiCredits.purchased_credits.toLocaleString(),
                        })}
                      </p>
                    )}
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="py-8 flex items-center justify-center">
              <div className="w-5 h-5 border-2 border-black/10 border-t-black/40 rounded-full animate-spin" />
            </div>
          )}
        </div>
      </div>

      {/* Add-ons (paid plans only) */}
      {!subLoading && currentPlanId !== 'free' && (
        <div className="bg-white rounded-2xl nice-shadow overflow-hidden">
          <div className="px-6 py-5 border-b border-black/[0.05]">
            <h2 className="font-bold text-base tracking-tight text-black">
              {t('billing.addons', { defaultValue: 'Add-ons' })}
            </h2>
            <p className="text-[11px] text-black/35 font-medium mt-0.5">
              {t('billing.addons_subtitle', { defaultValue: 'Purchase additional AI credits or member seats as monthly subscriptions.' })}
            </p>
          </div>
          <div className="px-6 py-6 space-y-6">
            {/* Active add-ons — read-only (no pack-detail/cancel route in v1) */}
            {activePacks.length > 0 &&
              (() => {
                const grouped = activePacks.reduce((acc: Record<string, any[]>, pack: any) => {
                  acc[pack.pack_id] = acc[pack.pack_id] || []
                  acc[pack.pack_id].push(pack)
                  return acc
                }, {})
                return (
                  <div className="space-y-3">
                    <p className="text-[11px] font-semibold uppercase tracking-widest text-black/25">
                      {t('billing.active_subscriptions', { defaultValue: 'Active subscriptions' })}
                    </p>
                    <div className="grid md:grid-cols-2 gap-3">
                      {Object.entries(grouped).map(([packId, packs]: [string, any[]]) => {
                        const packInfo = PACK_CATALOG.find((p) => p.id === packId)
                        const isAI = packs[0].pack_type === 'ai_credits'
                        const totalQty = packs.reduce((sum: number, p: any) => sum + p.quantity, 0)
                        return (
                          <div key={packId} className="rounded-2xl bg-white nice-shadow overflow-hidden">
                            <div className="px-4 py-4 space-y-3">
                              <div className="flex items-center gap-3">
                                <div className={`p-1.5 rounded-lg ${isAI ? 'bg-violet-50' : 'bg-emerald-50'}`}>
                                  {isAI ? (
                                    <Zap size={14} className="text-violet-600" />
                                  ) : (
                                    <Users size={14} className="text-emerald-600" />
                                  )}
                                </div>
                                <div className="flex items-center gap-2">
                                  <p className="text-[13px] font-semibold text-black">{packInfo?.label ?? packId}</p>
                                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-black/[0.06] text-black/50">
                                    x{packs.length}
                                  </span>
                                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-200">
                                    {t('billing.active', { defaultValue: 'Active' })}
                                  </span>
                                </div>
                              </div>
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-black/[0.04] text-black/50">
                                  {totalQty.toLocaleString()} {isAI ? t('billing.credits', { defaultValue: 'credits' }) : t('billing.seats', { defaultValue: 'seats' })}
                                </span>
                                {packInfo && (
                                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-black/[0.04] text-black/50">
                                    {getPackCurrencySymbol(packId, packPrices, priceOverrides)}
                                    {getPackPrice(packId, packPrices) * packs.length}/mo
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })()}

            {/* Available add-ons */}
            <div className="space-y-3">
              {activePacks.length > 0 && (
                <p className="text-[11px] font-semibold uppercase tracking-widest text-black/25">
                  {t('billing.available', { defaultValue: 'Available' })}
                </p>
              )}
              <div className="grid md:grid-cols-2 gap-3">
                {PACK_CATALOG.map((pack) => (
                  <div
                    key={pack.id}
                    className="flex items-center justify-between rounded-2xl bg-white nice-shadow px-4 py-3 hover:shadow-md transition-shadow"
                  >
                    <div className="flex items-center gap-3">
                      <div className={`p-1.5 rounded-lg ${pack.type === 'ai_credits' ? 'bg-violet-50' : 'bg-emerald-50'}`}>
                        {pack.type === 'ai_credits' ? (
                          <Zap size={14} className="text-violet-600" />
                        ) : (
                          <Users size={14} className="text-emerald-600" />
                        )}
                      </div>
                      <div>
                        <p className="text-[13px] font-semibold text-black">{pack.label}</p>
                        <p className="text-[11px] text-black/30 font-medium">
                          {getPackCurrencySymbol(pack.id, packPrices, priceOverrides)}
                          {getPackPrice(pack.id, packPrices)}/mo {t('billing.per_pack', { defaultValue: 'per pack' })}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => setDisclaimerPack(pack)}
                      disabled={packLoading === pack.id}
                      className="flex items-center gap-1 px-3 py-1.5 bg-black text-white rounded-lg text-[11px] font-bold hover:bg-black/80 transition-colors disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
                    >
                      {packLoading === pack.id ? (
                        <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      ) : (
                        <Plus size={11} />
                      )}
                      {t('billing.add', { defaultValue: 'Add' })}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Disclaimer modal */}
      <Dialog open={!!disclaimerPack} onOpenChange={(o) => !o && setDisclaimerPack(null)}>
        <DialogContent className="max-w-md p-0">
          {disclaimerPack && (
            <div>
              <div className="px-6 py-5 space-y-4">
                <DialogTitle asChild>
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-xl ${disclaimerPack.type === 'ai_credits' ? 'bg-violet-50' : 'bg-emerald-50'}`}>
                      {disclaimerPack.type === 'ai_credits' ? (
                        <Zap size={18} className="text-violet-600" />
                      ) : (
                        <Users size={18} className="text-emerald-600" />
                      )}
                    </div>
                    <div>
                      <p className="text-[15px] font-bold text-black">
                        {t('billing.add_pack', { defaultValue: `Add ${disclaimerPack.label}`, pack: disclaimerPack.label })}
                      </p>
                      <p className="text-[13px] text-black/40 mt-0.5 font-normal">
                        {getPackCurrencySymbol(disclaimerPack.id, packPrices, priceOverrides)}
                        {getPackPrice(disclaimerPack.id, packPrices)}/mo {t('billing.recurring_subscription', { defaultValue: 'recurring subscription' })}
                      </p>
                    </div>
                  </div>
                </DialogTitle>

                <div className="bg-black/[0.02] rounded-xl px-4 py-3 space-y-2.5">
                  <p className="text-[12px] font-semibold text-black/50">
                    {t('billing.what_youre_getting', { defaultValue: "What you're getting" })}
                  </p>
                  <ul className="space-y-1.5">
                    <li className="text-[12px] text-black/60 flex items-start gap-2">
                      <span className="text-emerald-500 mt-0.5">&#10003;</span>
                      {disclaimerPack.type === 'ai_credits'
                        ? t('billing.pack_ai_desc', {
                            defaultValue: `${disclaimerPack.quantity.toLocaleString()} additional AI credits added to your organization`,
                            quantity: disclaimerPack.quantity.toLocaleString(),
                          })
                        : t('billing.pack_seats_desc', {
                            defaultValue: `${disclaimerPack.quantity.toLocaleString()} additional member seats for your organization`,
                            quantity: disclaimerPack.quantity.toLocaleString(),
                          })}
                    </li>
                    <li className="text-[12px] text-black/60 flex items-start gap-2">
                      <span className="text-emerald-500 mt-0.5">&#10003;</span>
                      {t('billing.pack_immediate', { defaultValue: 'Takes effect immediately after payment' })}
                    </li>
                    <li className="text-[12px] text-black/60 flex items-start gap-2">
                      <span className="text-emerald-500 mt-0.5">&#10003;</span>
                      {t('billing.pack_cancel_anytime', { defaultValue: 'Cancel anytime — stays active until end of billing period' })}
                    </li>
                    {disclaimerPack.type === 'ai_credits' && (
                      <li className="text-[12px] text-black/60 flex items-start gap-2">
                        <span className="text-emerald-500 mt-0.5">&#10003;</span>
                        {t('billing.pack_credits_reset', { defaultValue: 'Credits reset each billing cycle' })}
                      </li>
                    )}
                  </ul>
                </div>

                {aiCredits && disclaimerPack.type === 'ai_credits' && (
                  <div className="bg-black/[0.02] rounded-xl px-4 py-3">
                    <p className="text-[11px] font-semibold text-black/40 uppercase tracking-wider mb-1.5">
                      {t('billing.after_purchase', { defaultValue: 'After purchase' })}
                    </p>
                    <p className="text-[13px] font-semibold text-black">
                      {t('billing.ai_credits', { defaultValue: 'AI Credits' })}:{' '}
                      {aiCredits.total_credits === 'unlimited' ? t('billing.unlimited', { defaultValue: 'Unlimited' }) : aiCredits.total_credits.toLocaleString()}
                      <span className="text-emerald-600">
                        {' '}
                        → {aiCredits.total_credits === 'unlimited' ? t('billing.unlimited', { defaultValue: 'Unlimited' }) : (aiCredits.total_credits + disclaimerPack.quantity).toLocaleString()}
                      </span>
                    </p>
                  </div>
                )}
                {features && disclaimerPack.type === 'member_seats' && (
                  <div className="bg-black/[0.02] rounded-xl px-4 py-3">
                    <p className="text-[11px] font-semibold text-black/40 uppercase tracking-wider mb-1.5">
                      {t('billing.after_purchase', { defaultValue: 'After purchase' })}
                    </p>
                    <p className="text-[13px] font-semibold text-black">
                      {t('billing.members', { defaultValue: 'Member seats' })}:{' '}
                      {features.members.limit === 'unlimited' ? t('billing.unlimited', { defaultValue: 'Unlimited' }) : features.members.limit.toLocaleString()}
                      <span className="text-emerald-600">
                        {' '}
                        → {features.members.limit === 'unlimited' ? t('billing.unlimited', { defaultValue: 'Unlimited' }) : (Number(features.members.limit) + disclaimerPack.quantity).toLocaleString()}
                      </span>
                    </p>
                  </div>
                )}

                <p className="text-[11px] text-black/30 font-medium">
                  {t('billing.pack_redirect_notice', { defaultValue: "You'll be redirected to Stripe to complete payment. You can purchase multiple packs of the same type." })}
                </p>
              </div>
              <div className="px-6 py-4 border-t border-black/[0.05] bg-black/[0.01] flex items-center justify-end gap-3">
                <button
                  onClick={() => setDisclaimerPack(null)}
                  className="px-4 py-2 text-[13px] font-semibold text-black/50 hover:text-black/70 rounded-xl hover:bg-black/[0.04] transition-colors"
                >
                  {t('billing.cancel', { defaultValue: 'Cancel' })}
                </button>
                <button
                  onClick={handleConfirmPurchase}
                  className="flex items-center gap-2 px-5 py-2 bg-black text-white rounded-xl text-[13px] font-semibold hover:bg-black/80 transition-colors"
                >
                  <ExternalLink size={13} />
                  {t('billing.continue_to_payment', { defaultValue: 'Continue to payment' })}
                </button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
