'use client'
// The top of Plan & usage: the plan and its status, how it is paid for, the
// seats in use, and the POC / trial / license brief when one applies.
import React from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowRight,
  ArrowSquareOut,
  Buildings,
  CalendarBlank,
  Certificate,
  CheckCircle,
  Clock,
  Handshake,
  Info,
  Warning,
} from '@phosphor-icons/react'
import { Chip, Eyebrow, Panel, SectionCard, StatusPill, buttonClass } from '@/design'
import { planNameById } from '@/app/(hub)/_billing/planText'
import {
  formatMoney,
  planStatus,
  pocProgress,
  type PlanOverview,
  type PocBrief,
  type SubscriptionLike,
} from '@services/orgs/planOverview'
import type { OrgUsageResponse } from '@services/orgs/usage'

const P = 'dashboard.organization.plan_usage'
const F = `${P}.features`

export interface UpcomingInvoiceLike {
  amountDue: number
  currency: string
  nextPaymentAttempt?: number
  periodEnd?: number
}

function useDate() {
  const { i18n } = useTranslation()
  return React.useCallback(
    (value: string | number | null | undefined) => {
      if (value == null) return ''
      const d = typeof value === 'number' ? new Date(value * 1000) : new Date(value)
      if (Number.isNaN(d.getTime())) return ''
      return d.toLocaleDateString(i18n.language, { year: 'numeric', month: 'short', day: 'numeric' })
    },
    [i18n.language]
  )
}

function Fact({ label, children, alert = false }: { label: string; children: React.ReactNode; alert?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-neutral-400">{label}</p>
      <p className={`text-sm font-semibold tabular-nums truncate ${alert ? 'text-rose-600' : 'text-neutral-900'}`}>{children}</p>
    </div>
  )
}

export function PlanSummaryCard({
  overview,
  usage,
  subscription,
  invoice,
  manageUrl,
  upgradeUrl,
  canManage,
}: {
  overview: PlanOverview
  usage?: OrgUsageResponse
  subscription?: SubscriptionLike | null
  invoice?: UpcomingInvoiceLike | null
  manageUrl: string | null
  upgradeUrl: string | null
  canManage: boolean
}) {
  const { t, i18n } = useTranslation()
  const date = useDate()
  const status = planStatus(overview, subscription)
  const saas = overview.mode === 'saas'
  const planLabel = saas
    ? planNameById(t, overview.plan, overview.plan)
    : overview.mode === 'ee'
      ? t(`${P}.status.licensed`)
      : t(`${P}.status.community`)

  // One line on how the plan runs: renewal and price, contract, POC end…
  let line: string
  if (overview.status === 'poc' && overview.poc?.state === 'active') {
    line = t(`${P}.line.poc`, { date: date(overview.poc.ends_at), plan: planNameById(t, overview.poc.returns_to, overview.poc.returns_to) })
  } else if (overview.status === 'trial' || overview.status === 'suspended') {
    line = t(`${P}.line.${overview.status}`)
  } else if (!saas) {
    line = t(`${P}.line.${overview.mode === 'ee' ? 'licensed' : 'community'}`)
  } else if (overview.billing === 'none') {
    line = t(`${P}.line.free`)
  } else if (subscription) {
    const price = formatMoney(subscription.amount, subscription.currency, i18n.language)
    const when = subscription.currentPeriodEnd
      ? t(`${P}.line.${subscription.cancelAtPeriodEnd ? 'ends' : 'renews'}`, { date: date(subscription.currentPeriodEnd) })
      : ''
    const per = price ? t(`${P}.line.${subscription.interval === 'year' ? 'price_year' : 'price_month'}`, { amount: price }) : ''
    line = [when, per].filter(Boolean).join(' · ') || t(`${P}.line.billing_page`)
  } else {
    line = overview.billing === 'contract' ? t(`${P}.line.contract`) : t(`${P}.line.billing_page`)
  }

  const invoiceAmount = invoice ? formatMoney(invoice.amountDue, invoice.currency, i18n.language) : null
  const invoiceDate = invoice ? date(invoice.nextPaymentAttempt ?? invoice.periodEnd ?? null) : ''

  const members = usage?.features?.members
  const seats = usage?.features?.admin_seats
  const of = (used: number, limit: number | 'unlimited') =>
    typeof limit === 'number' && limit > 0
      ? t(`${P}.seats_of`, { used: used.toLocaleString(), limit: limit.toLocaleString() })
      : t(`${P}.seats_no_limit`, { used: used.toLocaleString() })

  const pocActive = overview.poc?.state === 'active' && overview.poc.plan
  const nextPlan = pocActive ? overview.poc!.plan : overview.next_plan

  return (
    <Panel padded className="flex flex-col gap-5" data-testid="plan-summary" data-status={status.key}>
      <div className="flex flex-col sm:flex-row sm:items-start gap-4 sm:justify-between">
        <div className="flex items-start gap-3 min-w-0">
          <div className="w-11 h-11 rounded-xl bg-neutral-100 text-neutral-600 flex items-center justify-center shrink-0">
            {saas ? <Buildings size={20} /> : <Certificate size={20} />}
          </div>
          <div className="min-w-0">
            <Eyebrow>{t(`${P}.your_plan`)}</Eyebrow>
            <div className="mt-0.5 flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-bold text-neutral-900 tracking-tight" data-testid="plan-name">{planLabel}</h2>
              {saas && status.key !== 'free' && (
                <StatusPill status={status.tone} dot>
                  {t(`${P}.status.${status.key}`)}
                </StatusPill>
              )}
            </div>
            <p className="mt-1 text-sm text-neutral-500">{line}</p>
          </div>
        </div>
        {saas && canManage && (manageUrl || (upgradeUrl && nextPlan)) && (
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {manageUrl && overview.billing !== 'none' && (
              <a href={manageUrl} className={buttonClass('secondary', 'md')} data-testid="plan-manage-billing">
                {t(`${P}.manage_billing`)}
                <ArrowSquareOut size={13} />
              </a>
            )}
            {upgradeUrl && nextPlan && (
              <a href={upgradeUrl} className={buttonClass('primary', 'md')} data-testid="plan-upgrade">
                {pocActive
                  ? t(`${P}.keep_plan`, { plan: planNameById(t, nextPlan, nextPlan) })
                  : t('dashboard.organization.usage.upsell.upgrade_to', { plan: planNameById(t, nextPlan, nextPlan) })}
                <ArrowRight size={13} weight="bold" className="rtl:rotate-180" />
              </a>
            )}
          </div>
        )}
      </div>

      {(members || seats || invoiceAmount) && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 pt-4 border-t border-neutral-100">
          {members && (
            <Fact label={t('dashboard.organization.usage.members_label')} alert={members.limit_reached}>
              {of(members.usage, members.limit)}
            </Fact>
          )}
          {seats && (
            <Fact label={t('dashboard.organization.usage.admin_seats')} alert={seats.limit_reached}>
              {of(seats.usage, seats.limit)}
            </Fact>
          )}
          {invoiceAmount && invoiceDate && (
            <div className="col-span-2 sm:col-span-1 min-w-0" data-testid="plan-next-invoice">
              <p className="text-xs text-neutral-400 flex items-center gap-1">
                <CalendarBlank size={12} /> {t(`${P}.next_invoice_label`)}
              </p>
              <p className="text-sm font-semibold text-neutral-900 tabular-nums">
                {t(`${P}.next_invoice`, { amount: invoiceAmount, date: invoiceDate })}
              </p>
            </div>
          )}
        </div>
      )}
    </Panel>
  )
}

export function PocBriefCard({ poc, upgradeUrl, canManage }: { poc: PocBrief; upgradeUrl: string | null; canManage: boolean }) {
  const { t } = useTranslation()
  const date = useDate()
  const live = poc.state === 'active'
  const plan = planNameById(t, poc.plan ?? '', poc.plan ?? '')
  const back = planNameById(t, poc.returns_to, poc.returns_to)
  const { pct, daysLeft } = pocProgress(poc)
  const shown = poc.unlocks.slice(0, 8)
  const ending = live && daysLeft <= 7

  return (
    <SectionCard
      icon={<Handshake size={18} />}
      title={live ? t(`${P}.poc.title`) : t(`${P}.poc.ended_title`)}
      description={live ? t(`${P}.poc.desc`, { plan, count: poc.total_days }) : undefined}
      actions={
        live ? (
          <StatusPill status={ending ? 'warning' : 'info'} icon={<Clock size={12} />}>
            {daysLeft > 0 ? t(`${P}.poc.days_left`, { count: daysLeft }) : t(`${P}.poc.ends_today`)}
          </StatusPill>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-5" data-testid="plan-poc" data-poc-state={poc.state}>
        {live ? (
          <>
            <div>
              <div className="h-2 bg-neutral-100 rounded-full overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                <div className={`h-full rounded-full ${ending ? 'bg-amber-500' : 'bg-sky-500'}`} style={{ width: `${Math.max(pct, 3)}%` }} />
              </div>
              <div className="mt-2 flex items-center justify-between gap-3 text-xs text-neutral-500 tabular-nums">
                <span>
                  {t(`${P}.poc.started`)} {date(poc.started_at)}
                </span>
                <span className="flex items-center gap-1.5">
                  {poc.extended && <Chip>{t(`${P}.poc.extended`)}</Chip>}
                  {t(`${P}.poc.ends`)} {date(poc.ends_at)}
                </span>
              </div>
            </div>
            <div className="grid gap-5 lg:grid-cols-2">
              {shown.length > 0 && (
                <div className="min-w-0">
                  <h3 className="text-xs font-semibold text-neutral-500 mb-2">{t(`${P}.poc.unlocks`)}</h3>
                  <div className="flex flex-wrap gap-1.5">
                    {shown.map((key) => (
                      <Chip key={key} tone="sky" icon={<CheckCircle size={12} weight="fill" />}>
                        {t(`${F}.names.${key}`)}
                      </Chip>
                    ))}
                    {poc.unlocks.length > shown.length && <Chip>{t(`${P}.poc.more`, { count: poc.unlocks.length - shown.length })}</Chip>}
                  </div>
                </div>
              )}
              <div className="min-w-0">
                <h3 className="text-xs font-semibold text-neutral-500 mb-2">{t(`${P}.poc.after`)}</h3>
                <p className="text-sm text-neutral-600">{t(`${P}.poc.after_desc`, { plan: back })}</p>
              </div>
            </div>
          </>
        ) : (
          <p className="text-sm text-neutral-600">
            {poc.outcome === 'won'
              ? t(`${P}.poc.won`, { plan, date: date(poc.ended_at) })
              : t(`${P}.poc.ended_desc`, { plan: back, date: date(poc.ended_at) })}
          </p>
        )}
        {(poc.contact || (canManage && upgradeUrl && poc.outcome !== 'won')) && (
          <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-neutral-100">
            {poc.contact ? (
              <p className="text-sm text-neutral-600 min-w-0 flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-xs text-neutral-400">{t(`${P}.poc.contact`)}</span>
                <span className="font-medium text-neutral-800" dir="auto">{poc.contact.name}</span>
              </p>
            ) : (
              <span />
            )}
            {canManage && upgradeUrl && poc.outcome !== 'won' && !live && (
              <a href={upgradeUrl} className={buttonClass('secondary', 'sm')}>
                {t('dashboard.organization.usage.upsell.upgrade_to', { plan })}
                <ArrowRight size={12} weight="bold" className="rtl:rotate-180" />
              </a>
            )}
          </div>
        )}
      </div>
    </SectionCard>
  )
}

export function StatusNotice({ status }: { status: 'trial' | 'suspended' }) {
  const { t } = useTranslation()
  const danger = status === 'suspended'
  return (
    <Panel padded className="flex items-start gap-3" data-testid={`plan-notice-${status}`}>
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${danger ? 'bg-rose-50 text-rose-600' : 'bg-sky-50 text-sky-600'}`}>
        {danger ? <Warning size={18} /> : <Info size={18} />}
      </div>
      <div className="min-w-0">
        <h2 className="text-base font-semibold text-neutral-900 leading-tight">{t(`${P}.poc.${status}_title`)}</h2>
        <p className="mt-0.5 text-sm text-neutral-500">{t(`${P}.poc.${status}_desc`)}</p>
      </div>
    </Panel>
  )
}

export function LicenseCard({ overview }: { overview: PlanOverview }) {
  const { t } = useTranslation()
  const date = useDate()
  const lic = overview.license
  if (overview.mode === 'oss' && !lic?.active) {
    return (
      <SectionCard icon={<Certificate size={18} />} title={t(`${P}.license.community_title`)} description={t(`${P}.license.community_desc`)}>
        {lic?.reason && (
          <div className="flex flex-wrap gap-x-8 gap-y-2" data-testid="plan-license">
            <Fact label={t(`${P}.license.reason`)}>{lic.reason}</Fact>
          </div>
        )}
      </SectionCard>
    )
  }
  if (!lic) return null
  return (
    <SectionCard
      icon={<Certificate size={18} />}
      title={t(`${P}.license.title`)}
      actions={
        <StatusPill status={lic.active ? 'success' : 'danger'} dot>
          {lic.active ? t(`${P}.license.active`) : t(`${P}.license.inactive`)}
        </StatusPill>
      }
    >
      <div className="flex flex-wrap gap-x-10 gap-y-3" data-testid="plan-license">
        {lic.tier && <Fact label={t(`${P}.license.tier`)}>{lic.tier}</Fact>}
        {lic.expires_at && <Fact label={t(`${P}.license.expires`)}>{date(lic.expires_at)}</Fact>}
        {!lic.active && lic.reason && <Fact label={t(`${P}.license.reason`)}>{lic.reason}</Fact>}
      </div>
    </SectionCard>
  )
}
