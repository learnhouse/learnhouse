'use client'
import React from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import {
  BookOpen,
  Users,
  ShieldCheck,
  Chalkboard,
  ChatCircle,
  Microphone,
  ArrowRight,
  Lightning,
} from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getAPIUrl } from '@services/config/config'
import { OrgUsageResponse, orgUsageFetcher } from '@services/orgs/usage'
import { swrFetcher } from '@services/utils/ts/requests'
import { usePlan } from '@components/Hooks/usePlan'

interface AICreditsSummary {
  plan: string
  base_credits: number | string
  purchased_credits: number
  total_credits: number | string
  used_credits: number
  remaining_credits: number | string
  mode?: string | null
}

const PLAN_COLORS: Record<string, { bg: string; text: string }> = {
  free: { bg: 'bg-gray-100', text: 'text-gray-600' },
  oss: { bg: 'bg-emerald-100', text: 'text-emerald-700' },
  standard: { bg: 'bg-blue-100', text: 'text-blue-700' },
  pro: { bg: 'bg-purple-100', text: 'text-purple-700' },
  enterprise: { bg: 'bg-amber-100', text: 'text-amber-700' },
}

function getBarColor(usage: number, limit: number | 'unlimited'): string {
  if (limit === 'unlimited') return 'bg-green-500'
  const pct = (usage / (limit as number)) * 100
  if (pct > 90) return 'bg-red-500'
  if (pct > 70) return 'bg-amber-500'
  return 'bg-green-500'
}

function getBarPercent(usage: number, limit: number | 'unlimited'): number {
  if (limit === 'unlimited') return Math.min(usage > 0 ? 30 : 0, 100)
  return Math.min((usage / (limit as number)) * 100, 100)
}

const METER_ICONS: Record<string, React.ComponentType<any>> = {
  Courses: BookOpen,
  Members: Users,
  'Admin Seats': ShieldCheck,
}

export default function UsageOverview() {
  const { t } = useTranslation()
  const org = useOrg() as any
  const session = useLHSession() as any
  const token = session?.data?.tokens?.access_token
  const orgId = org?.id

  const { data: usageData, isLoading } = useSWR<OrgUsageResponse>(
    token && orgId ? `${getAPIUrl()}orgs/${orgId}/usage` : null,
    (url) => orgUsageFetcher(url, token),
    { revalidateOnFocus: false, dedupingInterval: 30000 }
  )

  const { data: aiCredits } = useSWR<AICreditsSummary>(
    token && orgId ? `${getAPIUrl()}orgs/${orgId}/ai-credits` : null,
    (url) => swrFetcher(url, token),
    { revalidateOnFocus: false, dedupingInterval: 30000 }
  )

  const ossMode = usageData?.oss_mode ?? false
  const plan = usePlan()
  const planStyle = PLAN_COLORS[plan] || PLAN_COLORS.free
  const features = usageData?.features

  const meters = features
    ? [
        { key: 'Courses', label: t('dashboard.home.courses'), ...features.courses },
        { key: 'Members', label: t('dashboard.home.members'), ...features.members },
        { key: 'Admin Seats', label: t('dashboard.home.admin_seats'), ...features.admin_seats },
      ]
    : []

  // Feature flags
  const orgFeatures = org?.config?.config?.resolved_features || org?.config?.config?.features
  const enabledFeatures = [
    {
      key: 'courses',
      label: t('dashboard.home.courses'),
      icon: BookOpen,
      enabled: orgFeatures?.courses?.enabled !== false,
      href: '/dash/courses',
    },
    {
      key: 'communities',
      label: t('dashboard.home.communities'),
      icon: ChatCircle,
      enabled: orgFeatures?.communities?.enabled !== false,
      href: '/dash/communities',
    },
    {
      key: 'podcasts',
      label: t('dashboard.home.podcasts'),
      icon: Microphone,
      enabled: orgFeatures?.podcasts?.enabled === true,
      href: '/dash/podcasts',
    },
    {
      key: 'boards',
      label: t('dashboard.home.boards'),
      icon: Chalkboard,
      enabled: orgFeatures?.boards?.enabled === true,
      href: '/dash/boards',
    },
  ]

  return (
    <div className="space-y-6">
      {/* Usage card */}
      <div className="bg-white rounded-xl nice-shadow p-5">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-sm font-semibold text-gray-700">{t('dashboard.home.plan_and_usage')}</h3>
          <span
            className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full capitalize ${planStyle.bg} ${planStyle.text}`}
          >
            {plan === 'oss' ? 'OSS' : plan}
          </span>
        </div>

        {isLoading ? (
          <div className="space-y-5">
            {[1, 2, 3].map((i) => (
              <div key={i} className="animate-pulse">
                <div className="h-3 bg-gray-100 rounded w-20 mb-2" />
                <div className="h-2 bg-gray-100 rounded w-full" />
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-5">
            {meters.map((meter) => {
              const isUnlimited = ossMode || meter.limit === 'unlimited'
              const limitText = isUnlimited ? t('dashboard.home.unlimited') : String(meter.limit)
              const barColor = isUnlimited
                ? 'bg-green-500'
                : getBarColor(meter.usage, meter.limit)
              const barPercent = isUnlimited
                ? 30
                : getBarPercent(meter.usage, meter.limit)
              const Icon = METER_ICONS[meter.key] || BookOpen

              return (
                <div key={meter.label}>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <Icon
                        size={13}
                        weight="duotone"
                        className="text-gray-400"
                      />
                      <span className="text-xs font-medium text-gray-600">
                        {meter.label}
                      </span>
                    </div>
                    <span className="text-[11px] text-gray-400 tabular-nums">
                      {meter.usage} / {limitText}
                    </span>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${barColor}`}
                      style={{ width: `${barPercent}%` }}
                    />
                  </div>
                  {!isUnlimited && meter.limit_reached && (
                    <p className="text-[10px] text-red-500 mt-1">
                      {t('dashboard.home.limit_reached')}
                    </p>
                  )}
                  {!isUnlimited && !meter.limit_reached && (
                    <p className="text-[10px] text-gray-300 mt-1">
                      {meter.remaining} {t('dashboard.home.remaining')}
                    </p>
                  )}
                </div>
              )
            })}

            {meters.length === 0 && (
              <p className="text-xs text-gray-400 text-center py-4">
                {t('dashboard.home.usage_data_unavailable')}
              </p>
            )}
          </div>
        )}

        {/* AI Credits */}
        {aiCredits && aiCredits.mode !== 'disabled' && (
          <>
            <div className="border-t border-gray-100 my-4" />
            <AICreditsSection credits={aiCredits} />
          </>
        )}
      </div>

      {/* Features card */}
      <div className="bg-white rounded-xl nice-shadow p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">
          {t('dashboard.home.features')}
        </h3>
        <div className="space-y-2.5">
          {enabledFeatures.map((feature) => (
            <div
              key={feature.key}
              className="flex items-center justify-between"
            >
              <div className="flex items-center gap-2.5">
                <div
                  className={`w-1.5 h-1.5 rounded-full ${
                    feature.enabled ? 'bg-green-500' : 'bg-gray-300'
                  }`}
                />
                <feature.icon
                  size={14}
                  weight="duotone"
                  className={
                    feature.enabled ? 'text-gray-500' : 'text-gray-300'
                  }
                />
                <span
                  className={`text-xs ${
                    feature.enabled
                      ? 'text-gray-600 font-medium'
                      : 'text-gray-400'
                  }`}
                >
                  {feature.label}
                </span>
              </div>
              {feature.enabled ? (
                <Link href={feature.href}>
                  <ArrowRight
                    size={12}
                    className="text-gray-300 hover:text-gray-500 transition-colors"
                  />
                </Link>
              ) : (
                <span className="text-[10px] text-gray-300">{t('dashboard.home.off')}</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function AICreditsSection({ credits }: { credits: AICreditsSummary }) {
  const { t } = useTranslation()
  const total =
    typeof credits.total_credits === 'number' ? credits.total_credits : 0
  const used = credits.used_credits ?? 0
  const remaining =
    typeof credits.remaining_credits === 'number'
      ? credits.remaining_credits
      : null
  const isUnlimited =
    credits.total_credits === 'unlimited' ||
    credits.remaining_credits === 'unlimited'

  const percent = isUnlimited
    ? used > 0
      ? 30
      : 0
    : total > 0
      ? Math.min((used / total) * 100, 100)
      : 0

  const barColor = isUnlimited
    ? 'bg-violet-500'
    : percent > 90
      ? 'bg-red-500'
      : percent > 70
        ? 'bg-amber-500'
        : 'bg-violet-500'

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <Lightning size={13} weight="duotone" className="text-violet-400" />
          <span className="text-xs font-medium text-gray-600">{t('dashboard.home.ai_credits')}</span>
        </div>
        <span className="text-[11px] text-gray-400 tabular-nums">
          {used} / {isUnlimited ? t('dashboard.home.unlimited') : total}
        </span>
      </div>
      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${barColor}`}
          style={{ width: `${percent}%` }}
        />
      </div>
      {isUnlimited ? (
        <p className="text-[10px] text-gray-300 mt-1">{used} {t('dashboard.home.used')}</p>
      ) : remaining !== null && remaining > 0 ? (
        <p className="text-[10px] text-gray-300 mt-1">{remaining} {t('dashboard.home.remaining')}</p>
      ) : remaining !== null && remaining <= 0 ? (
        <p className="text-[10px] text-red-500 mt-1">{t('dashboard.home.no_credits_remaining')}</p>
      ) : null}
      {credits.purchased_credits > 0 && (
        <p className="text-[10px] text-gray-300 mt-0.5">
          {t('dashboard.home.includes_purchased', { count: credits.purchased_credits })}
        </p>
      )}
    </div>
  )
}
