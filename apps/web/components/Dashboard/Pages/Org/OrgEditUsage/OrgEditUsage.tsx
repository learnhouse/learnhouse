'use client'
import React from 'react'
import useSWR from 'swr'
import {
  BookOpen,
  Users,
  ShieldCheck,
  Lightning,
} from '@phosphor-icons/react'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getAPIUrl } from '@services/config/config'
import { OrgUsageResponse, orgUsageFetcher } from '@services/orgs/usage'
import { swrFetcher } from '@services/utils/ts/requests'


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

export default function OrgEditUsage() {
  const org = useOrg() as any
  const session = useLHSession() as any
  const token = session?.data?.tokens?.access_token
  const orgId = org?.id

  const { data: usageData, isLoading } = useSWR<OrgUsageResponse>(
    token && orgId ? `${getAPIUrl()}orgs/${orgId}/usage` : null,
    (url) => orgUsageFetcher(url, token),
    { revalidateOnFocus: false }
  )

  const { data: aiCredits } = useSWR<AICreditsSummary>(
    token && orgId ? `${getAPIUrl()}orgs/${orgId}/ai-credits` : null,
    (url) => swrFetcher(url, token),
    { revalidateOnFocus: false }
  )

  const ossMode = usageData?.oss_mode ?? false
  const plan = ossMode
    ? 'oss'
    : usageData?.plan || org?.config?.config?.cloud?.plan || 'free'
  const planStyle = PLAN_COLORS[plan] || PLAN_COLORS.free
  const features = usageData?.features

  const meters = features
    ? [
        { label: 'Courses', ...features.courses },
        { label: 'Members', ...features.members },
        { label: 'Admin Seats', ...features.admin_seats },
      ]
    : []

  return (
    <div className="sm:mx-10 mx-0 space-y-6 pb-10">
      {/* Plan & Resource Usage */}
      <div className="bg-white rounded-xl nice-shadow">
        <div className="border-b px-6 py-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-800">
            Plan & Resource Usage
          </h3>
          <span
            className={`text-xs font-semibold px-3 py-1 rounded-full capitalize ${planStyle.bg} ${planStyle.text}`}
          >
            {plan === 'oss' ? 'OSS' : plan}
          </span>
        </div>
        <div className="p-6">
          {isLoading ? (
            <div className="space-y-6">
              {[1, 2, 3].map((i) => (
                <div key={i} className="animate-pulse">
                  <div className="h-4 bg-gray-100 rounded w-24 mb-3" />
                  <div className="h-3 bg-gray-100 rounded w-full" />
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-6">
              {meters.map((meter) => {
                const isUnlimited = ossMode || meter.limit === 'unlimited'
                const limitText = isUnlimited ? 'Unlimited' : String(meter.limit)
                const barColor = isUnlimited
                  ? 'bg-green-500'
                  : getBarColor(meter.usage, meter.limit)
                const barPercent = isUnlimited
                  ? 30
                  : getBarPercent(meter.usage, meter.limit)
                const Icon = METER_ICONS[meter.label] || BookOpen
                const pct = isUnlimited
                  ? null
                  : Math.round(
                      (meter.usage / (meter.limit as number)) * 100
                    )

                return (
                  <div key={meter.label}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2.5">
                        <Icon
                          size={16}
                          weight="duotone"
                          className="text-gray-400"
                        />
                        <span className="text-sm font-medium text-gray-700">
                          {meter.label}
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        {pct !== null && (
                          <span className="text-xs text-gray-400">
                            {pct}%
                          </span>
                        )}
                        <span className="text-sm text-gray-500 tabular-nums font-medium">
                          {meter.usage} / {limitText}
                        </span>
                      </div>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${barColor}`}
                        style={{ width: `${barPercent}%` }}
                      />
                    </div>
                    {!isUnlimited && meter.limit_reached && (
                      <p className="text-xs text-red-500 mt-1.5">
                        Limit reached
                      </p>
                    )}
                    {!isUnlimited && !meter.limit_reached && (
                      <p className="text-xs text-gray-400 mt-1.5">
                        {meter.remaining} remaining
                      </p>
                    )}
                    {isUnlimited && (
                      <p className="text-xs text-gray-400 mt-1.5">
                        Unlimited
                      </p>
                    )}
                  </div>
                )
              })}

              {meters.length === 0 && (
                <p className="text-sm text-gray-400 text-center py-6">
                  Usage data unavailable
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* AI Credits */}
      {aiCredits && aiCredits.mode !== 'disabled' && (
        <div className="bg-white rounded-xl nice-shadow">
          <div className="border-b px-6 py-4">
            <h3 className="text-lg font-semibold text-gray-800">AI Credits</h3>
          </div>
          <div className="p-6">
            <AICreditsDetail credits={aiCredits} />
          </div>
        </div>
      )}

    </div>
  )
}

function AICreditsDetail({ credits }: { credits: AICreditsSummary }) {
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
    <div className="space-y-4">
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2.5">
            <Lightning size={16} weight="duotone" className="text-violet-400" />
            <span className="text-sm font-medium text-gray-700">
              Credit Usage
            </span>
          </div>
          <span className="text-sm text-gray-500 tabular-nums font-medium">
            {used} / {isUnlimited ? 'Unlimited' : total}
          </span>
        </div>
        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${barColor}`}
            style={{ width: `${percent}%` }}
          />
        </div>
        {isUnlimited ? (
          <p className="text-xs text-gray-400 mt-1.5">{used} used</p>
        ) : remaining !== null && remaining > 0 ? (
          <p className="text-xs text-gray-400 mt-1.5">
            {remaining} remaining
          </p>
        ) : remaining !== null && remaining <= 0 ? (
          <p className="text-xs text-red-500 mt-1.5">No credits remaining</p>
        ) : null}
      </div>

      {/* Breakdown */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
        <div className="bg-gray-50 rounded-lg px-4 py-3">
          <p className="text-xs text-gray-400 mb-1">Base Credits</p>
          <p className="text-lg font-semibold text-gray-700 tabular-nums">
            {credits.base_credits === 'unlimited'
              ? 'Unlimited'
              : credits.base_credits}
          </p>
        </div>
        <div className="bg-gray-50 rounded-lg px-4 py-3">
          <p className="text-xs text-gray-400 mb-1">Purchased</p>
          <p className="text-lg font-semibold text-gray-700 tabular-nums">
            {credits.purchased_credits}
          </p>
        </div>
        <div className="bg-gray-50 rounded-lg px-4 py-3">
          <p className="text-xs text-gray-400 mb-1">Used</p>
          <p className="text-lg font-semibold text-gray-700 tabular-nums">
            {used}
          </p>
        </div>
        <div className="bg-gray-50 rounded-lg px-4 py-3">
          <p className="text-xs text-gray-400 mb-1">Remaining</p>
          <p className="text-lg font-semibold text-gray-700 tabular-nums">
            {isUnlimited ? 'Unlimited' : remaining ?? 0}
          </p>
        </div>
      </div>
    </div>
  )
}
