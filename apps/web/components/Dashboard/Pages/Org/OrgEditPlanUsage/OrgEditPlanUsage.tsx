'use client'
// Settings → Plan & usage. The plan and its status first (summary card, then a
// POC / trial / license brief when one applies), then three sub-tabs: usage
// against the plan's limits, every feature and where it comes from, and the AI
// credits in detail. Replaces the old Usage tab (its URL redirects here).
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { ArrowSquareOut, Lightning, Package, ShoppingCart, WarningCircle } from '@phosphor-icons/react'
import { Chip, EmptyState, Panel, SectionCard, Skeleton, SubTabPanel, SubTabs, buttonClass, useSubTab } from '@/design'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import useAdminStatus from '@components/Hooks/useAdminStatus'
import { queryKeys } from '@/lib/query/keys'
import { getAPIUrl, getUpgradeUrl, getUriWithOrg } from '@services/config/config'
import { ComparePlansButton } from '@components/Onboarding/PlanPicker'
import { apiFetch } from '@services/utils/ts/requests'
import { getOrgUsage, type OrgUsageResponse } from '@services/orgs/usage'
import { getPlanOverview, type PlanOverview } from '@services/orgs/planOverview'
import type { OrgPacksResponse } from '@services/packs/packs'
import { fetchSubscription, fetchUpcomingInvoice } from '@/app/(hub)/billing/_lib/billingClient'
import { AICreditsBalanceNotice } from '@components/Objects/AI/CreditCost'
import { AICreditPriceTable, AICreditsUsageBreakdown } from './AICreditsUsage'
import FeatureMatrix from './FeatureMatrix'
import UsageMeters, { AICreditsDetail, useMeters, type AICreditsSummary } from './UsageMeters'
import { LicenseCard, PlanSummaryCard, PocBriefCard, StatusNotice } from './PlanSummary'

const P = 'dashboard.organization.plan_usage'
const SECTIONS = ['usage', 'features', 'ai'] as const
type Section = (typeof SECTIONS)[number]

export default function OrgEditPlanUsage() {
  const { t } = useTranslation()
  const org = useOrg() as any
  const session = useLHSession() as any
  const { canManageOrg } = useAdminStatus()
  const token = session?.data?.tokens?.access_token
  const orgId: number | undefined = org?.id
  const orgSlug: string = org?.slug ?? ''
  const enabled = !!(token && orgId)
  const [section, setSection] = useSubTab<Section>('usage', SECTIONS)

  const overviewQ = useQuery<PlanOverview>({
    queryKey: ['org', orgId, 'plan-overview'],
    queryFn: () => getPlanOverview(orgId!, token),
    enabled,
    staleTime: 60_000,
  })
  const usageQ = useQuery<OrgUsageResponse>({
    queryKey: queryKeys.org.usage(orgId as number),
    queryFn: () => getOrgUsage(orgId!, token),
    enabled,
    staleTime: 60_000,
  })
  const creditsQ = useQuery<AICreditsSummary>({
    queryKey: ['org', orgId, 'ai-credits'],
    queryFn: () => apiFetch(`${getAPIUrl()}orgs/${orgId}/ai-credits`, token),
    enabled,
    staleTime: 60_000,
  })
  const packsQ = useQuery<OrgPacksResponse>({
    queryKey: ['org', orgId, 'packs'],
    queryFn: () => apiFetch(`${getAPIUrl()}orgs/${orgId}/packs`, token),
    enabled,
    staleTime: 60_000,
  })

  const overview = overviewQ.data
  // Stripe details only exist for a plan paid through checkout; the billing
  // routes answer 404 (null here) when SaaS billing isn't configured.
  const billed = enabled && canManageOrg && overview?.mode === 'saas' && overview.billing !== 'none'
  const subQ = useQuery({
    queryKey: ['org', orgId, 'billing-subscription'],
    queryFn: () => fetchSubscription(orgId!),
    enabled: billed,
    staleTime: 5 * 60_000,
    retry: false,
  })
  const invoiceQ = useQuery({
    queryKey: ['org', orgId, 'billing-upcoming'],
    queryFn: () => fetchUpcomingInvoice(orgId!),
    enabled: billed && !!subQ.data,
    staleTime: 5 * 60_000,
    retry: false,
  })

  const credits = creditsQ.data
  const aiOn = !!credits && credits.mode !== 'disabled'
  const meters = useMeters(usageQ.data, overview, credits)
  const settingsBase = getUriWithOrg(orgSlug, '') + '/dash/org/settings'
  const manageUrl = getUpgradeUrl(orgSlug)
  const pocPlan = overview?.poc?.state === 'active' ? overview.poc.plan : null
  const upgradeTarget = pocPlan ?? overview?.next_plan ?? null
  const upgradeUrl = upgradeTarget ? getUpgradeUrl(orgSlug, upgradeTarget) : null
  const endedPocUrl = overview?.poc?.state === 'ended' && overview.poc.plan ? getUpgradeUrl(orgSlug, overview.poc.plan) : null
  const activePacks = packsQ.data?.active_packs ?? []

  if (overviewQ.isError) {
    return (
      <Panel>
        <EmptyState
          icon={<WarningCircle size={22} />}
          title={t('dashboard.organization.usage.unavailable')}
          action={
            <button type="button" className={buttonClass('secondary', 'sm')} onClick={() => overviewQ.refetch()}>
              {t('common.retry')}
            </button>
          }
        />
      </Panel>
    )
  }

  return (
    <div className="flex flex-col gap-5" data-testid="plan-usage-page">
      {!overview ? (
        <Panel padded className="flex flex-col gap-3">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </Panel>
      ) : (
        <>
          <PlanSummaryCard
            overview={overview}
            usage={usageQ.data}
            subscription={subQ.data ?? null}
            invoice={invoiceQ.data ?? null}
            manageUrl={manageUrl}
            upgradeUrl={upgradeUrl}
            canManage={canManageOrg}
          />
          {overview.mode === 'saas' && canManageOrg && !!orgId && <ComparePlansButton orgId={Number(orgId)} orgSlug={orgSlug} />}
          {overview.poc && <PocBriefCard poc={overview.poc} upgradeUrl={endedPocUrl} canManage={canManageOrg} />}
          {!overview.poc && (overview.status === 'trial' || overview.status === 'suspended') && <StatusNotice status={overview.status} />}
          {overview.mode !== 'saas' && <LicenseCard overview={overview} />}
        </>
      )}

      <SubTabs<Section>
        items={[
          { key: 'usage', label: t(`${P}.sections.usage`) },
          {
            key: 'features',
            label: t(`${P}.sections.features`),
            badge: overview?.poc?.unlocks?.length ? <Chip tone="sky">{overview.poc.unlocks.length}</Chip> : undefined,
          },
          { key: 'ai', label: t(`${P}.sections.ai`), hidden: !aiOn },
        ]}
        value={section}
        onChange={setSection}
        idPrefix="plan-usage"
      >
        <SubTabPanel tab="usage">
          <div className="flex flex-col gap-5">
            <UsageMeters meters={meters} loading={usageQ.isLoading} />
            {activePacks.length > 0 && (
              <SectionCard
                icon={<Package size={18} />}
                title={t('dashboard.organization.usage.active_packs')}
                description={t('dashboard.organization.settings_ui.usage.packs_desc')}
                bodyClassName="px-5 pb-5 pt-4"
              >
                <div className="rounded-xl ring-1 ring-inset ring-neutral-200/70 divide-y divide-neutral-100">
                  {activePacks.map((pack) => {
                    const item = (packsQ.data?.available_packs ?? []).find((p) => p.pack_id === pack.pack_id)
                    return (
                      <div key={pack.id} className="flex items-center justify-between gap-3 px-4 py-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-neutral-800 truncate">{item?.label ?? pack.pack_id}</p>
                          <p className="text-xs text-neutral-400">
                            {t('dashboard.organization.usage.ai_credits')} &middot; {pack.quantity}
                          </p>
                        </div>
                        <Chip tone="emerald">{t('dashboard.organization.usage.active')}</Chip>
                      </div>
                    )
                  })}
                </div>
              </SectionCard>
            )}
            {overview?.mode === 'saas' && canManageOrg && manageUrl && (
              <SectionCard
                icon={<ShoppingCart size={18} />}
                title={t('dashboard.organization.usage.need_capacity')}
                description={t('dashboard.organization.usage.purchase_credits')}
                className="pb-5"
                actions={
                  <a href={manageUrl} target="_blank" rel="noopener noreferrer" className={buttonClass('secondary', 'md')}>
                    {t('dashboard.organization.usage.buy_more')}
                    <ArrowSquareOut size={13} />
                  </a>
                }
              />
            )}
          </div>
        </SubTabPanel>
        <SubTabPanel tab="features">
          {overview ? (
            <FeatureMatrix features={overview.features} areas={overview.areas} settingsBase={settingsBase} />
          ) : (
            <Panel padded>
              <Skeleton className="h-48" />
            </Panel>
          )}
        </SubTabPanel>
        <SubTabPanel tab="ai" unmountWhenHidden>
          {aiOn && credits && orgId && (
            <div className="flex flex-col gap-5">
              <SectionCard
                icon={<Lightning size={18} />}
                title={t('dashboard.organization.usage.ai_credits')}
                description={t('dashboard.organization.settings_ui.usage.ai_desc')}
              >
                <AICreditsBalanceNotice className="mb-4" />
                <AICreditsDetail credits={credits} />
              </SectionCard>
              <AICreditsUsageBreakdown orgId={orgId} />
              <AICreditPriceTable />
            </div>
          )}
        </SubTabPanel>
      </SubTabs>
    </div>
  )
}
