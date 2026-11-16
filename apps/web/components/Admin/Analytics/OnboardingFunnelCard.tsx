'use client'
import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { FunnelSimple } from '@phosphor-icons/react'
import { SectionCard, Skeleton } from '@/design'
import { getOnboardingFunnel } from '@services/ee/platform/api'
import { useAccessToken, shouldRetry } from '@components/Admin/hooks'
import { CHART_COLORS } from '@components/Admin/Shared/AdminKit'

/**
 * The signup-to-paid funnel across every organization, from live rows (not
 * analytics events), so it works on installs where analytics is empty.
 */
export default function OnboardingFunnelCard({ days }: { days: number }) {
  const { t } = useTranslation()
  const token = useAccessToken()
  const q = useQuery({
    queryKey: ['platform', 'onboarding-funnel', days],
    queryFn: () => getOnboardingFunnel(token, days),
    enabled: !!token,
    retry: shouldRetry,
    placeholderData: (prev) => prev,
  })
  const steps = q.data?.steps ?? []
  const top = Math.max(1, steps[0]?.count ?? 0)
  const goals = Object.entries(q.data?.by_goal ?? {}).filter(([, n]) => n > 0)
  const events = q.data?.events ?? {}

  return (
    <SectionCard icon={<FunnelSimple size={18} />} title={t('onb2.funnel.title')} description={t('onb2.funnel.desc', { count: days })}>
      {q.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : q.error ? (
        <p className="text-sm text-neutral-400">{t('admin.analytics.no_data')}</p>
      ) : (
        <div className="flex flex-col gap-4" data-testid="onboarding-funnel">
          <ol className="space-y-2">
            {steps.map((s, i) => {
              const prev = i > 0 ? steps[i - 1].count : null
              const drop = prev ? Math.round((1 - s.count / prev) * 100) : null
              return (
                <li key={s.key} className="space-y-1">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="truncate text-neutral-700">{t(`onb2.funnel.steps.${s.key}`)}</span>
                    <span className="shrink-0 tabular-nums text-neutral-900">
                      <span className="font-semibold">{s.count.toLocaleString()}</span>
                      <span className="ms-2 text-xs text-neutral-400">{Math.round(s.rate * 100)}%</span>
                      {drop != null && drop > 0 && <span className="ms-2 text-xs text-rose-500">−{drop}%</span>}
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-neutral-100">
                    <div className="h-full rounded-full" style={{ width: `${(s.count / top) * 100}%`, background: CHART_COLORS[0] }} />
                  </div>
                </li>
              )
            })}
          </ol>
          <div className="flex flex-wrap gap-x-5 gap-y-1 border-t border-neutral-100 pt-3 text-xs text-neutral-500">
            {(['starter_applied', 'plan_picker_viewed', 'continued_free', 'checkout_started'] as const).map((k) => (
              <span key={k}>
                {t(`onb2.funnel.events.${k}`)} <span className="font-semibold tabular-nums text-neutral-800">{(events[k] ?? 0).toLocaleString()}</span>
              </span>
            ))}
          </div>
          {goals.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {goals.map(([g, n]) => (
                <span key={g} className="rounded-md bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-600">
                  {t(`onboarding.intent.${g}.label`)} · {n}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </SectionCard>
  )
}
