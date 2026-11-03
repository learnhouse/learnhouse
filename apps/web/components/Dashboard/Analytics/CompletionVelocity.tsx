'use client'
import React from 'react'
import { useAnalyticsPipe } from './useAnalyticsDashboard'
import { Lightning } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'

function formatVelocity(hours: number, t: (k: string) => string): { value: string; unit: string } {
  if (hours < 1) {
    return { value: `${Math.round(hours * 60)}`, unit: t('analytics.course_analytics.units.minutes') }
  }
  if (hours < 48) {
    return { value: `${Math.round(hours * 10) / 10}`, unit: t('analytics.course_analytics.units.hours') }
  }
  const days = Math.round((hours / 24) * 10) / 10
  return { value: `${days}`, unit: t('analytics.course_analytics.units.days') }
}

export default function CompletionVelocity({ days = '90' }: { days?: string }) {
  const { t } = useTranslation()
  const { data, isLoading } = useAnalyticsPipe('completion_velocity', { days })
  const rows = data?.data ?? []

  // Calculate overall average across all courses
  const totalTransitions = rows.reduce((sum: number, r: any) => sum + (r.transitions || 0), 0)
  const weightedSum = rows.reduce(
    (sum: number, r: any) => sum + (r.avg_hours_between || 0) * (r.transitions || 0),
    0
  )
  const avgHours = totalTransitions > 0 ? weightedSum / totalTransitions : null
  const velocity = avgHours != null && totalTransitions >= 3 ? formatVelocity(avgHours, t) : null

  return (
    <div className="bg-white rounded-xl nice-shadow p-5 min-h-[300px] overflow-hidden min-w-0">
      <h3 className="text-sm font-semibold text-gray-700 mb-1">{t('analytics.advanced_widgets.completion_velocity.title')}</h3>
      <p className="text-xs text-gray-400 mb-4">{t('analytics.advanced_widgets.completion_velocity.description')}</p>
      {isLoading ? (
        <div className="h-48 flex items-center justify-center text-gray-300">{t('analytics.common.loading')}</div>
      ) : !velocity ? (
        <div className="h-48 flex items-center justify-center text-gray-300">{t('analytics.advanced_widgets.completion_velocity.not_enough_data')}</div>
      ) : (
        <div className="flex flex-col items-center justify-center h-48 gap-3">
          <div className="p-3 rounded-full bg-amber-50">
            <Lightning size={24} weight="fill" className="text-amber-500" />
          </div>
          <div className="text-center">
            <p className="text-4xl font-bold text-gray-900">{velocity.value}</p>
            <p className="text-sm text-gray-500 mt-1">{t('analytics.advanced_widgets.completion_velocity.avg_between', { unit: velocity.unit })}</p>
          </div>
          <p className="text-xs text-gray-400">
            {t('analytics.advanced_widgets.completion_velocity.based_on', { count: totalTransitions })}
          </p>
        </div>
      )}
    </div>
  )
}
