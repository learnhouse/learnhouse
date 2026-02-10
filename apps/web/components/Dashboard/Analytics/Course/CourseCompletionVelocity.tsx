'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useCoursePipe } from '../useAnalyticsDashboard'
import { Lightning } from '@phosphor-icons/react'
import CourseWidgetCard, { WidgetIcon } from './CourseWidgetCard'

function formatVelocity(hours: number, t: any): { value: string; unit: string } {
  if (hours < 1) return { value: `${Math.round(hours * 60)}`, unit: t('analytics.course_analytics.units.minutes') }
  if (hours < 48) return { value: `${Math.round(hours * 10) / 10}`, unit: t('analytics.course_analytics.units.hours') }
  return { value: `${Math.round((hours / 24) * 10) / 10}`, unit: t('analytics.course_analytics.units.days') }
}

export default function CourseCompletionVelocity({
  courseId,
  days = '90',
}: {
  courseId: string
  days?: string
}) {
  const { t } = useTranslation()
  const { data, isLoading } = useCoursePipe('course_completion_velocity', courseId, { days })
  const row = data?.data?.[0]

  const hasEnoughData = row?.transitions >= 3
  const velocity = row?.avg_hours_between != null && hasEnoughData
    ? formatVelocity(row.avg_hours_between, t)
    : null

  return (
    <CourseWidgetCard
      icon={<WidgetIcon icon={Lightning} bg="bg-amber-50" color="text-amber-500" weight="fill" />}
      title={t('analytics.course_analytics.completion_velocity.title')}
      subtitle={t('analytics.course_analytics.completion_velocity.subtitle')}
      modalContent={
        isLoading ? (
          <div className="h-60 flex items-center justify-center text-gray-300">{t('analytics.course_analytics.common.loading')}</div>
        ) : !row || !velocity ? (
          <div className="h-60 flex flex-col items-center justify-center text-gray-400 gap-3">
            <div className="p-4 rounded-full bg-gray-50">
              <Lightning size={36} weight="fill" className="text-gray-200" />
            </div>
            <p className="text-sm font-medium">{t('analytics.course_analytics.completion_velocity.not_enough_data')}</p>
            <p className="text-xs text-gray-400">{t('analytics.course_analytics.completion_velocity.need_transitions')}</p>
          </div>
        ) : (
          <div className="space-y-8 py-6">
            <div className="text-center">
              <div className="inline-flex items-center gap-3 bg-amber-50 rounded-2xl px-8 py-5">
                <Lightning size={32} weight="fill" className="text-amber-500" />
                <div>
                  <p className="text-5xl font-black text-gray-900">{velocity.value}</p>
                  <p className="text-sm text-gray-500 mt-1">{t('analytics.course_analytics.completion_velocity.avg_between', { unit: velocity.unit })}</p>
                </div>
              </div>
            </div>
            <div className="flex justify-center gap-6">
              <div className="text-center px-6 py-4 bg-gray-50 rounded-xl">
                <p className="text-2xl font-bold text-gray-700">{row.transitions}</p>
                <p className="text-xs text-gray-400 mt-1">{t('analytics.course_analytics.completion_velocity.transitions_tracked')}</p>
              </div>
              <div className="text-center px-6 py-4 bg-gray-50 rounded-xl">
                <p className="text-2xl font-bold text-gray-700">{Math.round(row.avg_hours_between * 10) / 10}h</p>
                <p className="text-xs text-gray-400 mt-1">{t('analytics.course_analytics.completion_velocity.raw_hours_avg')}</p>
              </div>
            </div>
            <p className="text-xs text-center text-gray-400 max-w-sm mx-auto">
              {t('analytics.course_analytics.completion_velocity.description')}
            </p>
          </div>
        )
      }
    >
      {isLoading ? (
        <div className="h-48 flex items-center justify-center text-gray-300 text-sm">{t('analytics.course_analytics.common.loading')}</div>
      ) : !row || !velocity ? (
        <div className="h-48 flex flex-col items-center justify-center text-gray-300 gap-2">
          <div className="p-3 rounded-full bg-gray-50">
            <Lightning size={24} weight="fill" className="text-gray-200" />
          </div>
          <p className="text-sm">{t('analytics.course_analytics.completion_velocity.not_enough_data_short')}</p>
          <p className="text-[10px] text-gray-300">{t('analytics.course_analytics.completion_velocity.need_transitions_short')}</p>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center h-48 gap-3">
          <div className="p-3 rounded-2xl bg-gradient-to-br from-amber-50 to-orange-50">
            <Lightning size={28} weight="fill" className="text-amber-500" />
          </div>
          <div className="text-center">
            <p className="text-4xl font-black text-gray-900">{velocity.value}</p>
            <p className="text-sm text-gray-500 mt-0.5">{t('analytics.course_analytics.common.avg_prefix', { value: velocity.unit })}</p>
          </div>
          <span className="text-[10px] text-gray-300 bg-gray-50 px-2 py-0.5 rounded-full">
            {row.transitions} {t('analytics.course_analytics.units.transitions')}
          </span>
        </div>
      )}
    </CourseWidgetCard>
  )
}
