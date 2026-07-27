'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@components/ui/badge'
import { TrendingUp } from 'lucide-react'
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts'
import { fmtDuration } from '../format'
import { Card, SectionTitle, Empty, P } from './primitives'

export default function BehaviorSection({ behavior }: { behavior: any }) {
  const { t } = useTranslation()
  const daily = (behavior?.user_daily_activity || []).map((d: any) => ({
    day: d.day, events: Number(d.events || 0), minutes: Math.round(Number(d.seconds || 0) / 60),
  }))
  const searches = behavior?.user_searches || []
  const byCourse = behavior?.user_time_by_course || []
  const views = behavior?.user_views || []
  const hasAny = daily.length > 0 || searches.length > 0 || byCourse.length > 0 || views.length > 0

  return (
    <Card>
      <SectionTitle icon={<TrendingUp size={18} />} title={t(`${P}.behavior.title`)} />
      {!hasAny ? (
        <Empty label={t(`${P}.no_behavioral`)} />
      ) : (
        <div className="space-y-6">
          {daily.length > 0 && (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={daily} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="ua-grad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Area type="monotone" dataKey="minutes" name="minutes" stroke="#3b82f6" fill="url(#ua-grad)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
          {byCourse.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-gray-400 uppercase mb-2">{t(`${P}.behavior.time_by_course`)}</div>
              <div className="space-y-1">
                {byCourse.map((c: any, i: number) => (
                  <div key={i} className="flex items-center justify-between text-sm gap-3">
                    <span className="truncate">
                      {c.course_name || t(`${P}.behavior.untitled_course`, { defaultValue: 'Untitled course' })}
                    </span>
                    <span className="flex-shrink-0">{fmtDuration(c.total_seconds)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {views.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-gray-400 uppercase mb-2">
                {t(`${P}.behavior.views`, { defaultValue: 'Page & content views' })}
              </div>
              <div className="flex flex-wrap gap-2">
                {views.map((v: any, i: number) => (
                  <Badge key={i} variant="secondary">{v.label || v.event_name} · {v.count ?? v.events}</Badge>
                ))}
              </div>
            </div>
          )}
          {searches.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-gray-400 uppercase mb-2">{t(`${P}.behavior.searches`)}</div>
              <div className="flex flex-wrap gap-2">
                {searches.map((s: any, i: number) => (
                  <Badge key={i} variant="secondary">{s.query} · {s.count}</Badge>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  )
}
