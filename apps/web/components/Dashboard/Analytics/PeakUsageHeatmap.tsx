'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useAnalyticsPipe } from './useAnalyticsDashboard'

const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
const HOURS = Array.from({ length: 24 }, (_, i) => i)

export default function PeakUsageHeatmap({ days = '30' }: { days?: string }) {
  const { t } = useTranslation()
  const { data, isLoading } = useAnalyticsPipe('peak_usage_hours', { days })
  const rows: any[] = data?.data ?? []

  const lookup = new Map<string, number>()
  let maxCount = 1
  for (const r of rows) {
    const key = `${r.day_of_week}-${r.hour_of_day}`
    lookup.set(key, r.event_count)
    if (r.event_count > maxCount) maxCount = r.event_count
  }

  const intensity = (count: number) => {
    if (count === 0) return 'bg-gray-50'
    const p = count / maxCount
    if (p > 0.75) return 'bg-indigo-500 text-white'
    if (p > 0.5) return 'bg-indigo-300'
    if (p > 0.25) return 'bg-indigo-200'
    return 'bg-indigo-100'
  }

  return (
    <div className="bg-white rounded-xl nice-shadow p-5 min-h-[300px] overflow-hidden min-w-0">
      <h3 className="text-sm font-semibold text-gray-700 mb-1">{t('dash.analytics.peak_usage_hours')}</h3>
      <p className="text-xs text-gray-400 mb-4">{t('dash.analytics.peak_usage_hours_sub')}</p>
      {isLoading ? (
        <div className="h-48 flex items-center justify-center text-gray-300">{t('dash.analytics.loading')}</div>
      ) : (
        <div className="overflow-x-auto">
          <div className="inline-grid gap-0.5" style={{ gridTemplateColumns: `60px repeat(24, 20px)` }}>
            <div />
            {HOURS.map((h) => (
              <div key={h} className="text-[9px] text-gray-400 text-center">{h}</div>
            ))}
            {DAY_KEYS.map((dayKey, di) => {
              const dayLabel = t(`dash.analytics.day_${dayKey}`)
              return (
              <React.Fragment key={dayKey}>
                <div className="text-xs text-gray-500 pr-2 flex items-center">{dayLabel}</div>
                {HOURS.map((h) => {
                  const count = lookup.get(`${di + 1}-${h}`) ?? 0
                  return (
                    <div
                      key={h}
                      className={`w-5 h-5 rounded-sm ${intensity(count)} text-[8px] flex items-center justify-center`}
                      title={t('dash.analytics.heatmap_cell_title', { day: dayLabel, hour: h, count })}
                    />
                  )
                })}
              </React.Fragment>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
