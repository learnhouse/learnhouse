'use client'
import React, { useState, useMemo } from 'react'
import dynamic from 'next/dynamic'
import { useTranslation } from 'react-i18next'
import { ChartBar } from '@phosphor-icons/react'
import { useOrg } from '@components/Contexts/OrgContext'
import { useCourse } from '@components/Contexts/CourseContext'
import { isFeatureAvailable, PlanLevel } from '@services/plans/plans'
import { useAnalyticsStatus } from '../useAnalyticsDashboard'
import PlanRestrictedFeature from '@components/Dashboard/Shared/PlanRestricted/PlanRestrictedFeature'
import ExportAnalyticsButton from '../AnalyticsExport'
import { usePlan } from '@components/Hooks/usePlan'

const CourseOverviewStats = dynamic(() => import('./CourseOverviewStats'))
const CourseEnrollmentTrend = dynamic(() => import('./CourseEnrollmentTrend'))
const CourseActivityFunnel = dynamic(() => import('./CourseActivityFunnel'))
const CourseLearnerProgress = dynamic(() => import('./CourseLearnerProgress'))
const CourseTimePerActivity = dynamic(() => import('./CourseTimePerActivity'))
const CourseCompletionVelocity = dynamic(() => import('./CourseCompletionVelocity'))
const CourseActiveLearners = dynamic(() => import('./CourseActiveLearners'))
const CourseTimeToCompletion = dynamic(() => import('./CourseTimeToCompletion'))
const CourseRecentEnrollments = dynamic(() => import('./CourseRecentEnrollments'))
const CourseCertificationRate = dynamic(() => import('./CourseCertificationRate'))
const CourseViewToEnrollment = dynamic(() => import('./CourseViewToEnrollment'))
const CourseActivityTypeBreakdown = dynamic(() => import('./CourseActivityTypeBreakdown'))
const CoursePeakHours = dynamic(() => import('./CoursePeakHours'))
const CourseLearnerRetention = dynamic(() => import('./CourseLearnerRetention'))
const CourseTopLearners = dynamic(() => import('./CourseTopLearners'))
const CourseActivityDropoff = dynamic(() => import('./CourseActivityDropoff'))
const CourseEngagementByType = dynamic(() => import('./CourseEngagementByType'))
const CourseDailyCompletions = dynamic(() => import('./CourseDailyCompletions'))
const CourseAvgSessionDuration = dynamic(() => import('./CourseAvgSessionDuration'))
const CourseUniqueViewers = dynamic(() => import('./CourseUniqueViewers'))

const COURSE_QUERY_NAMES = [
  'course_overview_stats', 'course_enrollment_trend', 'course_activity_funnel',
  'course_learner_progress', 'course_time_per_activity', 'course_completion_velocity',
  'course_active_learners', 'course_time_to_completion', 'course_certification_rate',
  'course_view_to_enrollment', 'course_activity_type_breakdown', 'course_peak_hours',
  'course_learner_retention', 'course_activity_dropoff', 'course_engagement_by_type',
  'course_daily_completions', 'course_avg_session_duration', 'course_unique_viewers',
  'course_recent_enrollments', 'course_top_learners',
]

const DATE_RANGES = [
  { label: '7d', value: '7' },
  { label: '30d', value: '30' },
  { label: '90d', value: '90' },
]

export type ActivityInfo = {
  name: string
  type: string
  chapterName: string
  activityUuid: string
}

/** Map of clean activity UUID (without prefix) → activity info */
export type ActivityMap = Record<string, ActivityInfo>

export default function CourseAnalyticsTab({ courseUUID }: { courseUUID: string }) {
  const { t } = useTranslation()
  const [days, setDays] = useState('30')
  const org = useOrg() as any
  const courseContext = useCourse() as any
  const currentPlan = usePlan()
  const isCourseAnalyticsAvailable = isFeatureAvailable('course_analytics', currentPlan)
  const { data: analyticsStatus } = useAnalyticsStatus()
  const isConfigured = analyticsStatus?.configured === true
  const orgslug = org?.slug || ''

  // courseUUID is always available from props; context is only used for activityMap
  const courseId = courseUUID

  // Build activity name map from course structure
  // Keys are the FULL activity_uuid (with prefix) since that's how ClickHouse stores them
  const activityMap: ActivityMap = useMemo(() => {
    const map: ActivityMap = {}
    const course = courseContext?.courseStructure
    if (!course?.chapters) return map
    for (const chapter of course.chapters) {
      for (const activity of chapter.activities || []) {
        const uuid = activity.activity_uuid || ''
        if (uuid) {
          const cleanUuid = uuid.replace('activity_', '')
          map[uuid] = {
            name: activity.name || 'Untitled',
            type: activity.activity_type || '',
            chapterName: chapter.name || '',
            activityUuid: cleanUuid,
          }
        }
      }
    }
    return map
  }, [courseContext?.courseStructure])

  if (!isCourseAnalyticsAvailable) {
    return (
      <div className="p-6">
        <PlanRestrictedFeature
          currentPlan={currentPlan}
          requiredPlan="pro"
          icon={ChartBar}
          titleKey="common.plans.feature_restricted.course_analytics.title"
          descriptionKey="common.plans.feature_restricted.course_analytics.description"
        >
          <></>
        </PlanRestrictedFeature>
      </div>
    )
  }

  if (analyticsStatus && !isConfigured) {
    return (
      <div className="flex flex-col items-center justify-center h-96 text-center p-6">
        <div className="bg-white rounded-2xl border border-gray-100 p-10 max-w-md nice-shadow">
          <h2 className="text-lg font-bold text-gray-900 mb-2">{t('analytics.course_analytics.not_configured_title')}</h2>
          <p className="text-sm text-gray-500 leading-relaxed">
            {t('analytics.course_analytics.not_configured_desc')}
          </p>
        </div>
      </div>
    )
  }

  const cleanCourseUuid = courseUUID.replace('course_', '')

  return (
    <div className="p-6 space-y-6 max-w-[1600px] mx-auto w-full">
      {/* Date range selector */}
      <div className="flex justify-end items-center gap-2">
        <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
          {DATE_RANGES.map((r) => (
            <button
              key={r.value}
              onClick={() => setDays(r.value)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                days === r.value
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
        <ExportAnalyticsButton
          days={days}
          queries={COURSE_QUERY_NAMES}
          courseId={courseId}
        />
      </div>

      {/* Overview KPIs — 4 columns */}
      <CourseOverviewStats courseId={courseId} days={days} />

      {/* Row: 3 columns — Enrollment trend, Active learners, Unique viewers */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <CourseEnrollmentTrend courseId={courseId} days={days} />
        <CourseActiveLearners courseId={courseId} days={days} />
        <CourseUniqueViewers courseId={courseId} days={days} />
      </div>

      {/* Row: 2 columns — View-to-enrollment conversion, Daily completions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <CourseViewToEnrollment courseId={courseId} days={days} />
        <CourseDailyCompletions courseId={courseId} days={days} />
      </div>

      {/* Full-width: Activity completion funnel */}
      <CourseActivityFunnel
        courseId={courseId}
        days={days}
        activityMap={activityMap}
        orgslug={orgslug}
        courseUuid={cleanCourseUuid}
      />

      {/* Row: 2 columns — Time per activity, Drop-off points */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <CourseTimePerActivity
          courseId={courseId}
          days={days}
          activityMap={activityMap}
          orgslug={orgslug}
          courseUuid={cleanCourseUuid}
        />
        <CourseActivityDropoff
          courseId={courseId}
          days={days}
          activityMap={activityMap}
          orgslug={orgslug}
          courseUuid={cleanCourseUuid}
        />
      </div>

      {/* Row: 2 columns — Activity type breakdown, Engagement by type */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <CourseActivityTypeBreakdown courseId={courseId} days={days} />
        <CourseEngagementByType courseId={courseId} days={days} />
      </div>

      {/* Row: 3 columns — Completion velocity, Time to completion, Certification rate */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <CourseCompletionVelocity courseId={courseId} days={days} />
        <CourseTimeToCompletion courseId={courseId} days={days} />
        <CourseCertificationRate courseId={courseId} days={days} />
      </div>

      {/* Row: 2 columns — Avg session duration, Learner progress */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <CourseAvgSessionDuration courseId={courseId} days={days} />
        <CourseLearnerProgress courseId={courseId} days={days} />
      </div>

      {/* Full-width: Peak learning hours heatmap */}
      <CoursePeakHours courseId={courseId} days={days} />

      {/* Row: 2 columns — Learner retention, Top learners */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <CourseLearnerRetention courseId={courseId} days={days} />
        <CourseTopLearners courseId={courseId} days={days} />
      </div>

      {/* Full-width: Recent enrollments */}
      <CourseRecentEnrollments courseId={courseId} days={days} />
    </div>
  )
}
