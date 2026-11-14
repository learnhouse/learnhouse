'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { Detective } from '@phosphor-icons/react'
import { SectionCard, StatusPill } from '@/design'
import { getSignals, opsKeys } from '@services/ee/platform/ops'
import { useAccessToken, shouldRetry } from '@components/Admin/hooks'
import { QueryError } from '@components/Admin/Shared/AdminKit'

// "Is this a real organization?" The test-org score with the reasons behind
// it, and what each admin address looks like. Free providers only add weight;
// they never make an org fake on their own.

export function scoreTone(score: number): { text: string; bar: string; status: 'danger' | 'warning' | 'success' } {
  if (score >= 80) return { text: 'text-rose-600', bar: 'bg-rose-500', status: 'danger' }
  if (score >= 50) return { text: 'text-amber-600', bar: 'bg-amber-500', status: 'warning' }
  return { text: 'text-emerald-600', bar: 'bg-emerald-500', status: 'success' }
}

export default function SignalsCard({ orgId }: { orgId: number }) {
  const { t } = useTranslation()
  const token = useAccessToken()
  const q = useQuery({ queryKey: opsKeys.signals(orgId), queryFn: () => getSignals(token, orgId), enabled: !!token, retry: shouldRetry, staleTime: 5 * 60_000 })
  const s = q.data
  const score = s?.test_org_score ?? 0
  const tone = scoreTone(score)
  const admins = Array.isArray(s?.admins) ? s!.admins : []
  const reasons = Array.isArray(s?.reasons) ? s!.reasons : []

  return (
    <SectionCard icon={<Detective size={18} />} title={t('admin.org.signals.title')} description={t('admin.org.signals.desc')}>
      {q.error ? (
        <QueryError error={q.error} compact />
      ) : !s ? (
        <p className="text-sm text-neutral-400">{t('common.loading')}</p>
      ) : (
        <div className="space-y-4">
          <div>
            <div className="flex items-baseline justify-between gap-3">
              <span className={`text-3xl font-bold tabular-nums ${tone.text}`}>{score}</span>
              <span className={`text-xs font-semibold ${tone.text}`}>{t(`admin.org.signals.band_${tone.status}`)}</span>
            </div>
            <div className="mt-2 h-1.5 rounded-full bg-neutral-100 overflow-hidden" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={score} aria-label={t('admin.org.signals.score')}>
              <div className={`h-full rounded-full ${tone.bar}`} style={{ width: `${Math.max(3, score)}%` }} />
            </div>
          </div>
          {reasons.length > 0 ? (
            <ul className="space-y-1 text-xs text-neutral-600 list-disc ps-4">
              {reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-neutral-500">{t('admin.org.signals.no_reasons')}</p>
          )}
          {admins.length > 0 && (
            <ul className="divide-y divide-neutral-100">
              {admins.map((a) => (
                <li key={a.email} className="flex flex-wrap items-center justify-between gap-2 py-2 first:pt-0 last:pb-0">
                  <span className="text-xs text-neutral-700 truncate min-w-0" dir="ltr">
                    {a.email}
                  </span>
                  <span className="flex flex-wrap gap-1">
                    {a.disposable || a.abstract_disposable ? (
                      <StatusPill status="danger">{t('admin.org.signals.disposable')}</StatusPill>
                    ) : (
                      <>
                        {a.free_provider && <StatusPill status="warning">{t('admin.org.signals.free_provider')}</StatusPill>}
                        {a.looks_test && <StatusPill status="warning">{t('admin.org.signals.looks_test')}</StatusPill>}
                        {!a.free_provider && !a.looks_test && <StatusPill status="success">{t('admin.org.signals.looks_real')}</StatusPill>}
                      </>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </SectionCard>
  )
}
