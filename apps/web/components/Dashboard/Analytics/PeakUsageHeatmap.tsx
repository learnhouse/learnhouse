'use client'
import React from 'react'
import { useAnalyticsPipe } from './useAnalyticsDashboard'

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const HOURS = Array.from({ length: 24 }, (_, i) => i)

export default function PeakUsageHeatmap({ days = '30' }: { days?: string }) {
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
      <h3 className="text-sm font-semibold text-gray-700 mb-1">Peak Usage Hours</h3>
      <p className="text-xs text-gray-400 mb-4">Event volume by day and hour</p>
      {isLoading ? (
        <div className="h-48 flex items-center justify-center text-gray-300">Loading...</div>
      ) : (
        <div className="overflow-x-auto">
          <div className="inline-grid gap-0.5" style={{ gridTemplateColumns: `60px repeat(24, 20px)` }}>
            <div />
            {HOURS.map((h) => (
              <div key={h} className="text-[9px] text-gray-400 text-center">{h}</div>
            ))}
            {DAYS.map((day, di) => (
              <React.Fragment key={day}>
                <div className="text-xs text-gray-500 pr-2 flex items-center">{day}</div>
                {HOURS.map((h) => {
                  const count = lookup.get(`${di + 1}-${h}`) ?? 0
                  return (
                    <div
                      key={h}
                      className={`w-5 h-5 rounded-sm ${intensity(count)} text-[8px] flex items-center justify-center`}
                      title={`${day} ${h}:00 — ${count} events`}
                    />
                  )
                })}
              </React.Fragment>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
