'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useCoursePipe } from '../useAnalyticsDashboard'
import { Certificate } from '@phosphor-icons/react'
import CourseWidgetCard, { WidgetIcon, ProgressRing } from './CourseWidgetCard'

export default function CourseCertificationRate({
  courseId,
  days = '90',
}: {
  courseId: string | number
  days?: string
}) {
  const { t } = useTranslation()
  const { data, isLoading } = useCoursePipe('course_certification_rate', courseId, { days })
  const row = data?.data?.[0]

  const rate = row?.claim_rate ?? 0
  const completions = row?.completions ?? 0
  const claims = row?.claims ?? 0

  return (
    <CourseWidgetCard
      icon={<WidgetIcon icon={Certificate} bg="bg-emerald-50" color="text-emerald-500" weight="fill" />}
      title={t('analytics.course_analytics.certification_rate.title')}
      subtitle={t('analytics.course_analytics.certification_rate.subtitle')}
      modalContent={
        isLoading ? (
          <div className="h-60 flex items-center justify-center text-gray-300">{t('analytics.course_analytics.common.loading')}</div>
        ) : !row ? (
          <div className="h-60 flex items-center justify-center text-gray-300">{t('analytics.course_analytics.common.no_data')}</div>
        ) : (
          <div className="space-y-8 py-6">
            <div className="flex justify-center">
              <ProgressRing percent={rate} size={160} strokeWidth={12} color="#10b981" />
            </div>
            <div className="text-center">
              <p className="text-5xl font-black text-gray-900">{rate}%</p>
              <p className="text-sm text-gray-500 mt-1">{t('analytics.course_analytics.certification_rate.of_completers_claimed')}</p>
            </div>
            <div className="flex justify-center gap-6">
              <div className="text-center px-6 py-4 bg-emerald-50 rounded-xl">
                <p className="text-2xl font-bold text-emerald-600">{claims}</p>
                <p className="text-xs text-gray-400 mt-1">{t('analytics.course_analytics.certification_rate.certificates_claimed')}</p>
              </div>
              <div className="text-center px-6 py-4 bg-gray-50 rounded-xl">
                <p className="text-2xl font-bold text-gray-700">{completions}</p>
                <p className="text-xs text-gray-400 mt-1">{t('analytics.course_analytics.certification_rate.course_completions')}</p>
              </div>
            </div>
          </div>
        )
      }
    >
      {isLoading ? (
        <div className="h-48 flex items-center justify-center text-gray-300 text-sm">{t('analytics.course_analytics.common.loading')}</div>
      ) : !row ? (
        <div className="h-48 flex items-center justify-center text-gray-300 text-sm">{t('analytics.course_analytics.common.no_data')}</div>
      ) : (
        <div className="flex items-center justify-center h-48 gap-5">
          <ProgressRing percent={rate} size={80} strokeWidth={6} color="#10b981" />
          <div>
            <p className="text-4xl font-black text-gray-900">{rate}%</p>
            <p className="text-sm text-gray-500">{t('analytics.course_analytics.units.claim_rate')}</p>
            <div className="flex gap-3 mt-2 text-[10px]">
              <span className="bg-emerald-50 text-emerald-500 px-2 py-0.5 rounded-full font-medium">{claims} {t('analytics.course_analytics.units.claimed')}</span>
              <span className="bg-gray-50 text-gray-500 px-2 py-0.5 rounded-full font-medium">{completions} {t('analytics.course_analytics.units.completed')}</span>
            </div>
          </div>
        </div>
      )}
    </CourseWidgetCard>
  )
}
