'use client'
import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useCoursePipe } from '../useAnalyticsDashboard'
import { Clock } from '@phosphor-icons/react'
import CourseWidgetCard, { WidgetIcon } from './CourseWidgetCard'

const HOUR_LABELS = Array.from({ length: 24 }, (_, i) =>
  i === 0 ? '12a' : i < 12 ? `${i}a` : i === 12 ? '12p' : `${i - 12}p`
)

function HeatmapGrid({
  grid,
  maxCount,
  compact = false,
  dayLabels,
  eventsTooltip,
  lessLabel,
  moreLabel,
}: {
  grid: number[][]
  maxCount: number
  compact?: boolean
  dayLabels: string[]
  eventsTooltip: (day: string, hour: string, count: number) => string
  lessLabel: string
  moreLabel: string
}) {
  function getOpacity(count: number) {
    if (maxCount === 0 || count === 0) return 0.05
    return 0.15 + (count / maxCount) * 0.85
  }

  return (
    <div className={compact ? '' : 'min-w-[600px]'}>
      {/* Hour labels */}
      <div className={`flex ${compact ? 'ml-7' : 'ml-10'} mb-1`}>
        {HOUR_LABELS.map((label, i) => (
          <div key={i} className="flex-1 text-center text-[9px] text-gray-400">
            {(compact ? i % 6 === 0 : i % 3 === 0) ? label : ''}
          </div>
        ))}
      </div>
      {/* Grid */}
      {grid.map((dayRow, dow) => (
        <div key={dow} className="flex items-center gap-1 mb-0.5">
          <span className={`${compact ? 'w-6 text-[8px]' : 'w-9 text-[10px]'} text-gray-500 text-right pr-1`}>
            {dayLabels[dow]}
          </span>
          <div className="flex flex-1 gap-0.5">
            {dayRow.map((count, h) => (
              <div
                key={h}
                className={`flex-1 ${compact ? 'h-3' : 'h-5'} rounded-sm bg-violet-500 transition-opacity`}
                style={{ opacity: getOpacity(count) }}
                title={eventsTooltip(dayLabels[dow], HOUR_LABELS[h], count)}
              />
            ))}
          </div>
        </div>
      ))}
      {/* Legend */}
      <div className={`flex items-center gap-2 mt-2 ${compact ? 'ml-7' : 'ml-10'}`}>
        <span className="text-[9px] text-gray-400">{lessLabel}</span>
        {[0.1, 0.3, 0.5, 0.7, 1].map((op, i) => (
          <div
            key={i}
            className={`${compact ? 'w-3 h-3' : 'w-4 h-4'} rounded-sm bg-violet-500`}
            style={{ opacity: op }}
          />
        ))}
        <span className="text-[9px] text-gray-400">{moreLabel}</span>
      </div>
    </div>
  )
}

export default function CoursePeakHours({
  courseId,
  days = '30',
}: {
  courseId: string | number
  days?: string
}) {
  const { t } = useTranslation()
  const { data, isLoading } = useCoursePipe('course_peak_hours', courseId, { days })
  const rows = data?.data ?? []

  const DAY_LABELS = [
    t('analytics.course_analytics.peak_hours.days.mon'),
    t('analytics.course_analytics.peak_hours.days.tue'),
    t('analytics.course_analytics.peak_hours.days.wed'),
    t('analytics.course_analytics.peak_hours.days.thu'),
    t('analytics.course_analytics.peak_hours.days.fri'),
    t('analytics.course_analytics.peak_hours.days.sat'),
    t('analytics.course_analytics.peak_hours.days.sun'),
  ]

  const eventsTooltip = (day: string, hour: string, count: number) =>
    t('analytics.course_analytics.peak_hours.events_tooltip', { day, hour, count })

  const { grid, maxCount, peakHour, peakDay } = useMemo(() => {
    const g: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0))
    let max = 0
    let bestH = 0
    let bestD = 0
    for (const row of rows) {
      const dow = (row.day_of_week || 1) - 1
      const h = row.hour || 0
      if (dow >= 0 && dow < 7 && h >= 0 && h < 24) {
        g[dow][h] = row.event_count || 0
        if (g[dow][h] > max) {
          max = g[dow][h]
          bestH = h
          bestD = dow
        }
      }
    }
    return { grid: g, maxCount: max, peakHour: bestH, peakDay: bestD }
  }, [rows])

  return (
    <CourseWidgetCard
      icon={<WidgetIcon icon={Clock} bg="bg-violet-50" color="text-violet-500" />}
      title={t('analytics.course_analytics.peak_hours.title')}
      subtitle={t('analytics.course_analytics.peak_hours.subtitle')}
      modalContent={
        isLoading ? (
          <div className="h-80 flex items-center justify-center text-gray-300">{t('analytics.course_analytics.common.loading')}</div>
        ) : rows.length === 0 ? (
          <div className="h-80 flex items-center justify-center text-gray-300">{t('analytics.course_analytics.common.no_data')}</div>
        ) : (
          <div className="space-y-4">
            <div className="flex gap-6 text-sm">
              <div>
                <p className="text-gray-400 text-xs">{t('analytics.course_analytics.peak_hours.peak_time')}</p>
                <p className="text-xl font-bold text-violet-600">
                  {DAY_LABELS[peakDay]} {HOUR_LABELS[peakHour]}
                </p>
              </div>
              <div>
                <p className="text-gray-400 text-xs">{t('analytics.course_analytics.peak_hours.peak_events')}</p>
                <p className="text-xl font-bold text-gray-900">{maxCount}</p>
              </div>
            </div>
            <div className="overflow-x-auto">
              <HeatmapGrid
                grid={grid}
                maxCount={maxCount}
                dayLabels={DAY_LABELS}
                eventsTooltip={eventsTooltip}
                lessLabel={t('analytics.course_analytics.peak_hours.less')}
                moreLabel={t('analytics.course_analytics.peak_hours.more')}
              />
            </div>
          </div>
        )
      }
    >
      {isLoading ? (
        <div className="h-40 flex items-center justify-center text-gray-300 text-sm">{t('analytics.course_analytics.common.loading')}</div>
      ) : rows.length === 0 ? (
        <div className="h-40 flex items-center justify-center text-gray-300 text-sm">{t('analytics.course_analytics.common.no_data')}</div>
      ) : (
        <div className="h-40">
          <div className="flex items-center justify-between mb-2">
            <div>
              <span className="text-lg font-bold text-violet-600">
                {DAY_LABELS[peakDay]} {HOUR_LABELS[peakHour]}
              </span>
              <p className="text-[10px] text-gray-400">{t('analytics.course_analytics.units.busiest_time')}</p>
            </div>
          </div>
          <HeatmapGrid
            grid={grid}
            maxCount={maxCount}
            compact
            dayLabels={DAY_LABELS}
            eventsTooltip={eventsTooltip}
            lessLabel={t('analytics.course_analytics.peak_hours.less')}
            moreLabel={t('analytics.course_analytics.peak_hours.more')}
          />
        </div>
      )}
    </CourseWidgetCard>
  )
}
