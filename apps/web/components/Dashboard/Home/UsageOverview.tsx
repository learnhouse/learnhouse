'use client'
import React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import {
  BookOpen,
  Users,
  ShieldCheck,
  Chalkboard,
  ChatCircle,
  Microphone,
  CaretRight,
} from '@phosphor-icons/react'
import { AIMark } from '@components/Objects/AI/AIBrand'
import { useTranslation } from 'react-i18next'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getAPIUrl } from '@services/config/config'
import { OrgUsageResponse, getOrgUsage } from '@services/orgs/usage'
import PlanBadge from '@components/Dashboard/Shared/PlanRestricted/PlanBadge'
import { Chip, SectionCard } from '@components/Dashboard/Shared/DashKit/DashKit'
import { FEATURES_SETTINGS_HREF, getOptionalFeatureState } from '@services/features/optionalFeatures'
import { apiFetch } from '@services/utils/ts/requests'
import { usePlan } from '@components/Hooks/usePlan'
import { PlanChip } from './homeKit'

interface AICreditsSummary {
  plan: string
  base_credits: number | string
  purchased_credits: number
  total_credits: number | string
  used_credits: number
  remaining_credits: number | string
  mode?: string | null
}

function barTone(percent: number, base = 'bg-neutral-900') {
  if (percent > 90) return 'bg-rose-500'
  if (percent > 70) return 'bg-amber-500'
  return base
}

// One usage line: label and "used / limit", then a bar when there is a limit.
function Meter({
  icon,
  label,
  usage,
  limitText,
  percent,
  barClass,
  hint,
}: {
  icon: React.ReactNode
  label: string
  usage: number
  limitText: string
  percent: number | null
  barClass: string
  hint?: React.ReactNode
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 min-w-0 text-sm font-medium text-neutral-700">
          <span className="text-neutral-400 shrink-0">{icon}</span>
          <span className="truncate">{label}</span>
        </span>
        <span className="text-xs text-neutral-500 tabular-nums shrink-0">
          <span className="font-semibold text-neutral-900">{usage}</span> / {limitText}
        </span>
      </div>
      {percent !== null && (
        <div
          className="mt-2 h-1.5 bg-neutral-100 rounded-full overflow-hidden"
          role="progressbar"
          aria-label={label}
          aria-valuenow={Math.round(percent)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className={`h-full rounded-full transition-[width] duration-500 ${barClass}`}
            style={{ width: `${Math.max(percent, usage > 0 ? 2 : 0)}%` }}
          />
        </div>
      )}
      {hint && <p className="mt-1.5 text-xs">{hint}</p>}
    </div>
  )
}

export default function UsageOverview() {
  const { t } = useTranslation()
  const org = useOrg() as any
  const session = useLHSession() as any
  const token = session?.data?.tokens?.access_token
  const orgId = org?.id
  const plan = usePlan()

  const { data: usageData, isLoading } = useQuery<OrgUsageResponse>({
    queryKey: queryKeys.org.usage(orgId),
    queryFn: () => getOrgUsage(orgId, token),
    enabled: !!token && !!orgId,
    staleTime: 60_000,
  })

  const { data: aiCredits } = useQuery<AICreditsSummary>({
    queryKey: ['org', orgId, 'ai-credits'],
    queryFn: () => apiFetch(`${getAPIUrl()}orgs/${orgId}/ai-credits`, token),
    enabled: !!token && !!orgId,
    staleTime: 60_000,
  })

  // The backend sends `mode`, never `oss_mode`; reading the latter made this
  // permanently false, so non-SaaS deployments were shown plan limits.
  const ossMode = usageData?.mode !== undefined && usageData.mode !== 'saas'
  const features = usageData?.features

  const meters = features
    ? [
        { key: 'courses', icon: <BookOpen size={16} />, label: t('dashboard.home.courses'), ...features.courses },
        { key: 'members', icon: <Users size={16} />, label: t('dashboard.home.members'), ...features.members },
        { key: 'admin_seats', icon: <ShieldCheck size={16} />, label: t('dashboard.home.admin_seats'), ...features.admin_seats },
      ]
    : []

  return (
    <SectionCard
      title={t('dashboard.home.plan_and_usage')}
      actions={<PlanChip plan={plan} />}
    >
      {isLoading ? (
        <div className="space-y-5" aria-hidden>
          {[1, 2, 3].map((i) => (
            <div key={i} className="animate-pulse">
              <div className="flex justify-between mb-2.5">
                <div className="h-3 w-24 rounded bg-neutral-100" />
                <div className="h-3 w-12 rounded bg-neutral-100" />
              </div>
              <div className="h-1.5 rounded-full bg-neutral-100" />
            </div>
          ))}
        </div>
      ) : meters.length === 0 ? (
        <p className="text-sm text-neutral-500 text-center py-4">{t('dashboard.home.usage_data_unavailable')}</p>
      ) : (
        <div className="space-y-5">
          {meters.map((meter) => {
            const isUnlimited = ossMode || meter.limit === 'unlimited'
            const limit = meter.limit as number
            const percent = isUnlimited || !limit ? null : Math.min((meter.usage / limit) * 100, 100)
            return (
              <Meter
                key={meter.key}
                icon={meter.icon}
                label={meter.label}
                usage={meter.usage}
                limitText={isUnlimited ? t('dashboard.home.unlimited') : String(meter.limit)}
                percent={isUnlimited ? null : (percent ?? 100)}
                barClass={barTone(percent ?? 100)}
                hint={
                  isUnlimited ? null : meter.limit_reached ? (
                    <span className="font-medium text-rose-600">{t('dashboard.home.limit_reached')}</span>
                  ) : (
                    <span className="text-neutral-400">
                      {meter.remaining} {t('dashboard.home.remaining')}
                    </span>
                  )
                }
              />
            )
          })}
        </div>
      )}

      {aiCredits && aiCredits.mode !== 'disabled' && (
        <div className="mt-5 pt-5 border-t border-neutral-100">
          <AICreditsMeter credits={aiCredits} />
        </div>
      )}
    </SectionCard>
  )
}

function AICreditsMeter({ credits }: { credits: AICreditsSummary }) {
  const { t } = useTranslation()
  const total = typeof credits.total_credits === 'number' ? credits.total_credits : 0
  const used = credits.used_credits ?? 0
  const remaining = typeof credits.remaining_credits === 'number' ? credits.remaining_credits : null
  const isUnlimited = credits.total_credits === 'unlimited' || credits.remaining_credits === 'unlimited'
  const percent = isUnlimited ? null : total > 0 ? Math.min((used / total) * 100, 100) : 0

  const status = isUnlimited ? (
    <span className="text-neutral-400">
      {used} {t('dashboard.home.used')}
    </span>
  ) : remaining !== null && remaining > 0 ? (
    <span className="text-neutral-400">
      {remaining} {t('dashboard.home.remaining')}
    </span>
  ) : remaining !== null ? (
    <span className="font-medium text-rose-600">{t('dashboard.home.no_credits_remaining')}</span>
  ) : null

  return (
    <Meter
      icon={<AIMark size={16} alt="" />}
      label={t('dashboard.home.ai_credits')}
      usage={used}
      limitText={isUnlimited ? t('dashboard.home.unlimited') : String(total)}
      percent={percent}
      barClass={barTone(percent ?? 0, 'bg-violet-500')}
      hint={
        status || credits.purchased_credits > 0 ? (
          <span className="flex flex-wrap gap-x-2">
            {status}
            {credits.purchased_credits > 0 && (
              <span className="text-neutral-400">
                {t('dashboard.home.includes_purchased', { count: credits.purchased_credits })}
              </span>
            )}
          </span>
        ) : null
      }
    />
  )
}

// Which optional features are on, with a way in (or the plan that unlocks it).
export function FeaturesCard() {
  const { t } = useTranslation()
  const org = useOrg() as any
  const plan = usePlan()
  const orgFeatures = org?.config?.config?.resolved_features || org?.config?.config?.features

  const items = [
    {
      key: 'courses',
      label: t('dashboard.home.courses'),
      icon: BookOpen,
      enabled: orgFeatures?.courses?.enabled !== false,
      upgradePlan: null,
      href: '/dash/courses',
    },
    {
      key: 'communities',
      label: t('dashboard.home.communities'),
      icon: ChatCircle,
      enabled: orgFeatures?.communities?.enabled !== false,
      upgradePlan: getOptionalFeatureState(orgFeatures?.communities).upgradePlan,
      href: '/dash/communities',
    },
    {
      key: 'podcasts',
      label: t('dashboard.home.podcasts'),
      icon: Microphone,
      enabled: orgFeatures?.podcasts?.enabled === true,
      upgradePlan: getOptionalFeatureState(orgFeatures?.podcasts).upgradePlan,
      href: '/dash/podcasts',
    },
    {
      key: 'boards',
      label: t('dashboard.home.boards'),
      icon: Chalkboard,
      enabled: orgFeatures?.boards?.enabled === true,
      upgradePlan: getOptionalFeatureState(orgFeatures?.boards).upgradePlan,
      href: '/dash/boards',
    },
  ]

  const rowBase = 'flex items-center gap-3 rounded-xl px-3 py-2'

  return (
    <SectionCard title={t('dashboard.home.features')} bodyClassName="px-2 pt-3 pb-2">
      <ul className="flex flex-col">
        {items.map(({ key, label, icon: Icon, enabled, upgradePlan, href }) => {
          const tile = (
            <span
              className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                enabled ? 'bg-neutral-100 text-neutral-700' : 'bg-neutral-50 text-neutral-300'
              }`}
            >
              <Icon size={16} />
            </span>
          )
          const name = (
            <span className={`flex-1 min-w-0 truncate text-sm ${enabled ? 'font-medium text-neutral-800' : 'text-neutral-400'}`}>
              {label}
            </span>
          )
          return (
            <li key={key}>
              {enabled ? (
                <Link href={href} className={`group ${rowBase} hover:bg-neutral-50 transition-colors`}>
                  {tile}
                  {name}
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" aria-hidden />
                  <CaretRight
                    size={14}
                    className="shrink-0 text-neutral-300 group-hover:text-neutral-500 transition-colors rtl:rotate-180"
                  />
                </Link>
              ) : upgradePlan ? (
                // Not in the plan: name the plan that unlocks it, not "Off".
                <div className={rowBase}>
                  {tile}
                  {name}
                  <PlanBadge currentPlan={plan} requiredPlan={upgradePlan} alwaysShow noMargin />
                </div>
              ) : (
                <Link href={FEATURES_SETTINGS_HREF} className={`${rowBase} hover:bg-neutral-50 transition-colors`}>
                  {tile}
                  {name}
                  <Chip>{t('dashboard.home.off')}</Chip>
                </Link>
              )}
            </li>
          )
        })}
      </ul>
    </SectionCard>
  )
}
