'use client'
import React, { useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { ChartBar } from '@phosphor-icons/react'
import ToolTip from '@components/Objects/StyledElements/Tooltip/Tooltip'
import { dayKey } from './trailStats'
import { TrailSection } from './trailUi'

const WEEKS = 26 // ~6 months

function tone(count: number, max: number) {
  if (count === 0) return 'bg-neutral-100'
  const ratio = count / Math.max(max, 1)
  if (ratio > 0.75) return 'bg-teal-600'
  if (ratio > 0.5) return 'bg-teal-500'
  if (ratio > 0.25) return 'bg-teal-400'
  return 'bg-teal-200'
}

// The last 26 weeks of completed activities, one cell per day, like a
// contribution graph. Weeks run left to right (right to left in RTL).
export default function ActivityHeatmap({ byDay, streak }: { byDay: Map<string, number>; streak: number }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language || 'en'
  const scrollRef = useRef<HTMLDivElement>(null)
  // On narrow screens the graph scrolls; start on the most recent weeks.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const rtl = getComputedStyle(el).direction === 'rtl'
    el.scrollLeft = rtl ? -el.scrollWidth : el.scrollWidth
  }, [])

  const { weeks, total, activeDays, max } = useMemo(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    // Start on the Monday WEEKS-1 weeks back, so columns are whole weeks.
    const start = new Date(today)
    const weekday = (start.getDay() + 6) % 7
    start.setDate(start.getDate() - weekday - (WEEKS - 1) * 7)
    const weeks: { date: Date; count: number; future: boolean }[][] = []
    let total = 0
    let activeDays = 0
    let max = 0
    const cursor = new Date(start)
    for (let w = 0; w < WEEKS; w++) {
      const col: { date: Date; count: number; future: boolean }[] = []
      for (let d = 0; d < 7; d++) {
        const count = byDay.get(dayKey(cursor)) ?? 0
        const future = cursor > today
        if (!future) {
          total += count
          if (count > 0) activeDays += 1
          max = Math.max(max, count)
        }
        col.push({ date: new Date(cursor), count, future })
        cursor.setDate(cursor.getDate() + 1)
      }
      weeks.push(col)
    }
    return { weeks, total, activeDays, max }
  }, [byDay])

  const dayLabel = (d: Date) => d.toLocaleDateString(locale, { weekday: 'short', month: 'short', day: 'numeric' })
  const monthLabel = (d: Date) => d.toLocaleDateString(locale, { month: 'short' })

  return (
    <TrailSection
      id="trail-activity"
      icon={<ChartBar size={18} />}
      title={t('trail.activity.title', 'Your activity')}
      description={t('trail.activity.description', 'Activities you completed over the last six months.')}
    >
      <div className="bg-white rounded-2xl nice-shadow p-5 flex flex-col lg:flex-row gap-6 lg:items-center">
        <div className="flex flex-wrap lg:flex-col gap-x-8 gap-y-4 lg:w-48 shrink-0">
          <div>
            <p className="text-xs text-neutral-500">{t('trail.activity.total', 'Completed in six months')}</p>
            <p className="text-xl font-bold tabular-nums text-neutral-900">{total}</p>
          </div>
          <div>
            <p className="text-xs text-neutral-500">{t('trail.activity.active_days', 'Active days')}</p>
            <p className="text-xl font-bold tabular-nums text-neutral-900">{activeDays}</p>
          </div>
          <div>
            <p className="text-xs text-neutral-500">{t('trail.stats.streak', 'Learning streak')}</p>
            <p className="text-xl font-bold tabular-nums text-neutral-900">
              {t('trail.stats.days', { defaultValue_one: '{{count}} day', defaultValue_other: '{{count}} days', count: streak })}
            </p>
          </div>
        </div>

        <div ref={scrollRef} className="min-w-0 flex-1 overflow-x-auto scrollbar-hide">
          <div className="inline-flex flex-col gap-1.5">
            {/* Month labels over the first week of each month. */}
            <div className="flex gap-[3px] ps-0 text-[10px] text-neutral-400 h-3">
              {weeks.map((col, i) => {
                const first = col[0].date
                const show = i === 0 || first.getMonth() !== weeks[i - 1][0].date.getMonth()
                return (
                  <span key={i} className="w-3.5 sm:w-4 lg:w-5 shrink-0 whitespace-nowrap overflow-visible">
                    {show ? monthLabel(first) : ''}
                  </span>
                )
              })}
            </div>
            <div className="flex gap-[3px]" role="img" aria-label={t('trail.activity.aria', { defaultValue: '{{total}} activities completed on {{days}} days in the last six months', total, days: activeDays })}>
              {weeks.map((col, i) => (
                <div key={i} className="flex flex-col gap-[3px]">
                  {col.map((cell) =>
                    cell.future ? (
                      <span key={cell.date.toISOString()} className="w-3.5 h-3.5 sm:w-4 sm:h-4 lg:w-5 lg:h-5 rounded-[4px]" />
                    ) : (
                      <ToolTip
                        key={cell.date.toISOString()}
                        content={`${dayLabel(cell.date)}: ${t('trail.activity.count', { defaultValue_one: '{{count}} activity', defaultValue_other: '{{count}} activities', count: cell.count })}`}
                      >
                        <span className={`block w-3.5 h-3.5 sm:w-4 sm:h-4 lg:w-5 lg:h-5 rounded-[4px] ${tone(cell.count, max)}`} />
                      </ToolTip>
                    )
                  )}
                </div>
              ))}
            </div>
            <div className="flex items-center justify-end gap-1 text-[10px] text-neutral-400 mt-1">
              {t('trail.activity.less', 'Less')}
              {['bg-neutral-100', 'bg-teal-200', 'bg-teal-400', 'bg-teal-500', 'bg-teal-600'].map((c) => (
                <span key={c} className={`w-3 h-3 rounded-[3px] ${c}`} />
              ))}
              {t('trail.activity.more', 'More')}
            </div>
          </div>
        </div>
      </div>
    </TrailSection>
  )
}
