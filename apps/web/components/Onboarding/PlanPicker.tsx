'use client'
import React, { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ArrowUpRight, Check, Sparkle } from '@phosphor-icons/react'
import { Button, SegmentedControl, buttonClass } from '@/design'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics'
import { getUpgradeUrl } from '@services/config/config'
import {
  getPlanPicker,
  onboardingKeys,
  recordOnboardingEvent,
  type PickerPlan,
} from '@services/onboarding/onboarding'
import { calcPrice, findPlan, getCurrencySymbol, type Billing, type PricesResponse } from '@/app/(hub)/_billing/plans'

// Where "Talk to us" goes for the plans sold through a conversation.
export const CONTACT_SALES_URL = 'https://learnhouse.app/contact?subject=business'

const nameKey = (id: string) => `billing.catalog.names.${id.replace('-', '_')}`
const taglineKey = (id: string) => `billing.catalog.taglines.${id.replace('-', '_')}`

async function fetchPrices(): Promise<PricesResponse | null> {
  try {
    const res = await fetch('/api/billing/prices')
    return res.ok ? res.json() : null
  } catch {
    return null
  }
}

function limitLabel(t: any, key: 'courses' | 'members' | 'admin_seats' | 'ai_credits', value: number) {
  if (value === 0 || value < 0) return t(`onb2.plans.limits.${key}_unlimited`)
  return t(`onb2.plans.limits.${key}`, { count: value, formatted: value.toLocaleString() })
}

/**
 * The plan picker: the plans that exist (from plans.py via the API), what each
 * adds, monthly or annual prices from billing, the plan recommended for the
 * org's goal, and "Continue free" always one click away. Choosing a paid plan
 * opens the billing page's switch wizard at that plan (real checkout lives
 * there); Enterprise is a conversation.
 */
export default function PlanPicker({
  open,
  onOpenChange,
  orgId,
  orgSlug,
  source,
}: {
  open: boolean
  onOpenChange: (_open: boolean) => void
  orgId: number
  orgSlug: string
  source: string
}) {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const token = session?.data?.tokens?.access_token
  const { track } = useLHAnalytics('dashboard')
  const [billing, setBilling] = useState<Billing>('annual')

  const picker = useQuery({
    queryKey: onboardingKeys.plans(orgId),
    queryFn: () => getPlanPicker(token, orgId),
    enabled: open && !!token && !!orgId,
    staleTime: 5 * 60_000,
    retry: false,
  })
  const prices = useQuery({ queryKey: ['billing', 'prices'], queryFn: fetchPrices, enabled: open, staleTime: 5 * 60_000 })

  useEffect(() => {
    if (!open || !orgId) return
    track(AnalyticsEvent.PlanPickerViewed, { source })
    recordOnboardingEvent(token, orgId, 'plan_picker_viewed').catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, orgId])

  const continueFree = () => {
    track(AnalyticsEvent.PlanPickerContinuedFree, { source })
    recordOnboardingEvent(token, orgId, 'continued_free').catch(() => {})
    onOpenChange(false)
  }

  const choose = (plan: PickerPlan) => {
    track(AnalyticsEvent.PlanPickerPlanChosen, { source, plan: plan.id, billing })
    recordOnboardingEvent(token, orgId, 'checkout_started').catch(() => {})
    const url = getUpgradeUrl(orgSlug, plan.id)
    if (url) window.location.href = url
  }

  const data = picker.data
  const overrides = prices.data?.plans

  const body = (
    <div className="flex flex-col gap-5 p-1">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-neutral-500 max-w-md">{t('onb2.plans.subtitle')}</p>
        <SegmentedControl<Billing>
          value={billing}
          onChange={setBilling}
          ariaLabel={t('onb2.plans.billing')}
          options={[
            { key: 'monthly', label: t('billing.pricing.monthly') },
            { key: 'annual', label: t('billing.pricing.annual') },
          ]}
        />
      </div>

      {picker.isError && <p className="text-sm text-rose-600">{t('onb2.plans.load_error')}</p>}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        {(data?.plans ?? []).map((plan) => {
          const catalog = findPlan(plan.id)
          const price = catalog ? calcPrice(catalog.monthlyPrice, billing, plan.id, overrides) : null
          const symbol = getCurrencySymbol(plan.id, overrides)
          return (
            <div
              key={plan.id}
              data-plan={plan.id}
              className={[
                'relative flex flex-col rounded-2xl bg-white p-4 nice-shadow',
                plan.recommended ? 'ring-2 ring-neutral-900' : '',
              ].join(' ')}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-neutral-900">{t(nameKey(plan.id))}</span>
                {plan.current ? (
                  <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-600">{t('onb2.plans.current')}</span>
                ) : plan.recommended ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-neutral-900 px-2 py-0.5 text-[11px] font-medium text-white">
                    <Sparkle size={10} weight="fill" />
                    {t('onb2.plans.recommended')}
                  </span>
                ) : null}
              </div>
              <div className="mt-2 flex items-baseline gap-1">
                {plan.contact_sales ? (
                  <span className="text-xl font-bold text-neutral-900">{t('onb2.plans.custom_price')}</span>
                ) : price === 0 ? (
                  <span className="text-xl font-bold text-neutral-900">{t('billing.pricing.free')}</span>
                ) : (
                  <>
                    <span className="text-xl font-bold text-neutral-900 tabular-nums">
                      {symbol}
                      {price ?? '–'}
                    </span>
                    <span className="text-xs text-neutral-400">{t('billing.pricing.per_month')}</span>
                  </>
                )}
              </div>
              <p className="mt-1 text-xs text-neutral-500 line-clamp-2 min-h-[2rem]">{t(taglineKey(plan.id))}</p>

              <ul className="mt-3 space-y-1.5 text-xs text-neutral-700">
                {(['courses', 'members', 'admin_seats', 'ai_credits'] as const).map((k) => (
                  <li key={k} className="flex items-center gap-1.5">
                    <Check size={12} weight="bold" className="shrink-0 text-emerald-600" />
                    <span className="truncate">{limitLabel(t, k, plan.limits[k])}</span>
                  </li>
                ))}
                {plan.unlocks
                  .filter((k) => !['courses', 'assignments', 'folders', 'messaging', 'ai'].includes(k))
                  .slice(0, 4)
                  .map((k) => (
                    <li key={k} className="flex items-center gap-1.5">
                      <Check size={12} weight="bold" className="shrink-0 text-emerald-600" />
                      <span className="truncate">{t(`dashboard.organization.plan_usage.features.names.${k}`)}</span>
                    </li>
                  ))}
              </ul>

              <div className="mt-auto pt-4">
                {plan.current ? (
                  <span className={buttonClass('secondary', 'sm', 'w-full justify-center pointer-events-none opacity-60')}>
                    {t('onb2.plans.current')}
                  </span>
                ) : plan.contact_sales ? (
                  <a href={CONTACT_SALES_URL} target="_blank" rel="noopener noreferrer" className={buttonClass('secondary', 'sm', 'w-full justify-center')}>
                    {t('billing.pricing.talk_to_us')}
                    <ArrowUpRight size={12} weight="bold" data-dir-flip />
                  </a>
                ) : plan.id === 'free' ? (
                  <Button size="sm" className="w-full justify-center" onClick={continueFree}>
                    {t('onb2.plans.continue_free')}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant={plan.recommended ? 'primary' : 'secondary'}
                    className="w-full justify-center"
                    onClick={() => choose(plan)}
                  >
                    {t('billing.pricing.choose_plan', { plan: t(nameKey(plan.id)) })}
                  </Button>
                )}
              </div>
            </div>
          )
        })}
        {picker.isLoading &&
          [0, 1, 2, 3].map((i) => <div key={i} className="h-72 rounded-2xl bg-neutral-100 animate-pulse" />)}
      </div>
    </div>
  )

  return (
    <Modal
      isDialogOpen={open}
      onOpenChange={onOpenChange}
      size="xl"
      dialogTitle={t('onb2.plans.title')}
      dialogContent={body}
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-3">
          <span className="text-xs text-neutral-400">{t('onb2.plans.footnote')}</span>
          {(data?.can_continue_free ?? true) && (
            <Button size="sm" variant="ghost" onClick={continueFree}>
              {t('onb2.plans.continue_free')}
            </Button>
          )}
        </div>
      }
    />
  )
}

/** "Compare plans" for Settings → Overview: the plan picker, opened on request. */
export function ComparePlansButton({ orgId, orgSlug }: { orgId: number; orgSlug: string }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  return (
    <>
      <div className="flex justify-end">
        <Button size="sm" variant="ghost" onClick={() => setOpen(true)} data-testid="compare-plans">
          {t('onb2.plans.compare')}
        </Button>
      </div>
      <PlanPicker open={open} onOpenChange={setOpen} orgId={orgId} orgSlug={orgSlug} source="settings_overview" />
    </>
  )
}
