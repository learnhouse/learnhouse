'use client'
import React, { useState } from 'react'
import dynamic from 'next/dynamic'
import { Breadcrumbs } from '@components/Objects/Breadcrumbs/Breadcrumbs'
import { ChartBar, ChartLine, SquaresFour } from '@phosphor-icons/react'
import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { usePlanInfo, useAnalyticsStatus } from '@components/Dashboard/Analytics/useAnalyticsDashboard'
import { isFeatureAvailable, PlanLevel } from '@services/plans/plans'
import PlanBadge from '@components/Dashboard/Shared/PlanRestricted/PlanBadge'
import PlanRestrictedFeature from '@components/Dashboard/Shared/PlanRestricted/PlanRestrictedFeature'
import ExportAnalyticsButton from '@components/Dashboard/Analytics/AnalyticsExport'

// Core widgets — dynamic to code-split recharts
const EventOverview = dynamic(() => import('@components/Dashboard/Analytics/EventOverview'))
const CoreWidgetsRow = dynamic(() => import('@components/Dashboard/Analytics/CoreWidgetsRow'))

// Advanced widgets — only loaded when user clicks the Advanced tab
const AdvancedGate = dynamic(() => import('@components/Dashboard/Analytics/AdvancedGate').then(m => ({ default: m.AdvancedGate })))
const CourseDropoffMap = dynamic(() => import('@components/Dashboard/Analytics/CourseDropoffMap'))
const CohortRetention = dynamic(() => import('@components/Dashboard/Analytics/CohortRetention'))
const TimeToCompletion = dynamic(() => import('@components/Dashboard/Analytics/TimeToCompletion'))
const PeakUsageHeatmap = dynamic(() => import('@components/Dashboard/Analytics/PeakUsageHeatmap'))
const ContentTypeEffectiveness = dynamic(() => import('@components/Dashboard/Analytics/ContentTypeEffectiveness'))
const NewVsReturning = dynamic(() => import('@components/Dashboard/Analytics/NewVsReturning'))
const CompletionVelocity = dynamic(() => import('@components/Dashboard/Analytics/CompletionVelocity'))
const CommunityCorrelation = dynamic(() => import('@components/Dashboard/Analytics/CommunityCorrelation'))
const UserProgressSnapshot = dynamic(() => import('@components/Dashboard/Analytics/UserProgressSnapshot'))
const GradeDistribution = dynamic(() => import('@components/Dashboard/Analytics/GradeDistribution'))
const SearchEffectiveness = dynamic(() => import('@components/Dashboard/Analytics/SearchEffectiveness'))
const CertificationRate = dynamic(() => import('@components/Dashboard/Analytics/CertificationRate'))
const OrgGrowthTrend = dynamic(() => import('@components/Dashboard/Analytics/OrgGrowthTrend'))
const LearnerEngagementScore = dynamic(() => import('@components/Dashboard/Analytics/LearnerEngagementScore'))
const CourseEffectivenessMatrix = dynamic(() => import('@components/Dashboard/Analytics/CourseEffectivenessMatrix'))

const OVERVIEW_QUERIES = [
  'live_users', 'daily_active_users', 'top_courses', 'enrollment_funnel',
  'event_counts', 'activity_engagement', 'visitors_by_country',
  'visitors_by_device', 'visitors_by_referrer', 'daily_visitor_breakdown',
]

const ADVANCED_QUERY_NAMES = [
  'org_growth_trend', 'new_vs_returning', 'cohort_retention', 'peak_usage_hours',
  'course_dropoff', 'time_to_completion', 'completion_velocity',
  'content_type_effectiveness', 'course_rating_by_completion',
  'community_correlation', 'learner_engagement_score', 'user_progress_snapshot',
  'search_effectiveness', 'certification_rate',
]

const DATE_RANGES = [
  { label: '7d', value: '7' },
  { label: '30d', value: '30' },
  { label: '90d', value: '90' },
]

type Tab = 'overview' | 'advanced'

export default function AnalyticsDashboard() {
  const { t } = useTranslation()
  const [days, setDays] = useState('30')
  const [tab, setTab] = useState<Tab>('overview')
  const { data: planInfo } = usePlanInfo()
  const { data: analyticsStatus } = useAnalyticsStatus()
  const plan: PlanLevel = planInfo?.plan ?? 'free'
  const isAnalyticsAvailable = isFeatureAvailable('analytics', plan)
  const isAdvanced = isFeatureAvailable('analytics_advanced', plan)
  const isConfigured = analyticsStatus?.configured === true

  if (!isAnalyticsAvailable) {
    return (
      <PlanRestrictedFeature
        currentPlan={plan}
        requiredPlan="standard"
        icon={ChartBar}
        titleKey="common.plans.feature_restricted.analytics.title"
        descriptionKey="common.plans.feature_restricted.analytics.description"
        fullScreen
      >
        <></>
      </PlanRestrictedFeature>
    )
  }

  return (
    <div className="h-full w-full bg-[#f8f8f8] flex flex-col">
      {/* Sticky header box */}
      <div className="pl-10 pr-10 tracking-tight bg-[#fcfbfc] z-10 nice-shadow flex-shrink-0 relative">
        <div className="pt-6 pb-4">
          <Breadcrumbs items={[
            { label: t('analytics.title'), href: '/dash/analytics', icon: <ChartBar size={14} /> }
          ]} />
        </div>
        <div className="my-2 py-2">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex flex-col space-y-1">
              <div className="pt-3 flex font-bold text-4xl tracking-tighter">
                {t('analytics.title')}
              </div>
              <div className="flex font-medium text-gray-400 text-md">
                {t('analytics.subtitle')}
              </div>
            </div>
            <div className="flex items-center gap-2">
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
              {isConfigured && (
                <ExportAnalyticsButton
                  days={days}
                  queries={tab === 'overview' ? OVERVIEW_QUERIES : ADVANCED_QUERY_NAMES}
                />
              )}
            </div>
          </div>
        </div>
        <div className="flex space-x-5 font-black text-sm">
          <button onClick={() => setTab('overview')}>
            <div
              className={`py-2 w-fit text-center border-black transition-all ease-linear ${
                tab === 'overview' ? 'border-b-4' : 'opacity-50'
              } cursor-pointer`}
            >
              <div className="flex items-center space-x-2.5 mx-2">
                <ChartLine size={16} />
                <div>{t('analytics.tabs.overview')}</div>
              </div>
            </div>
          </button>
          <button onClick={() => setTab('advanced')}>
            <div
              className={`py-2 w-fit text-center border-black transition-all ease-linear ${
                tab === 'advanced' ? 'border-b-4' : 'opacity-50'
              } cursor-pointer`}
            >
              <div className="flex items-center space-x-2.5 mx-2">
                <SquaresFour size={16} />
                <div className="flex items-center">
                  {t('analytics.tabs.advanced')}
                  {!isAdvanced && (
                    <PlanBadge currentPlan={plan} requiredPlan="pro" />
                  )}
                </div>
              </div>
            </div>
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="h-6 flex-shrink-0"></div>
      <motion.div
        key={tab}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.1, type: 'spring', stiffness: 80 }}
        className="flex-1 overflow-y-auto overflow-x-hidden px-10 pb-10"
      >
        {analyticsStatus && !isConfigured ? (
          <div className="flex flex-col items-center justify-center h-96 text-center">
            <div className="bg-white rounded-2xl border border-gray-100 p-10 max-w-md nice-shadow">
              <div className="text-4xl mb-4">📊</div>
              <h2 className="text-lg font-bold text-gray-900 mb-2">{t('analytics.not_configured.title')}</h2>
              <p className="text-sm text-gray-500 leading-relaxed">
                {t('analytics.not_configured.description')}
              </p>
            </div>
          </div>
        ) : tab === 'overview' ? (
          <div className="space-y-6 max-w-[1600px] mx-auto w-full">
            <EventOverview days={days} />
            <CoreWidgetsRow days={days} />
          </div>
        ) : (
          <div className="space-y-6 max-w-[1600px] mx-auto w-full">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <AdvancedGate isAdvanced={isAdvanced} currentPlan={plan}>
                <OrgGrowthTrend days={days} />
              </AdvancedGate>
              <AdvancedGate isAdvanced={isAdvanced} currentPlan={plan}>
                <NewVsReturning days={days} />
              </AdvancedGate>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <AdvancedGate isAdvanced={isAdvanced} currentPlan={plan}>
                <CohortRetention days={days} />
              </AdvancedGate>
              <AdvancedGate isAdvanced={isAdvanced} currentPlan={plan}>
                <PeakUsageHeatmap days={days} />
              </AdvancedGate>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <AdvancedGate isAdvanced={isAdvanced} currentPlan={plan}>
                <CourseDropoffMap days={days} />
              </AdvancedGate>
              <AdvancedGate isAdvanced={isAdvanced} currentPlan={plan}>
                <TimeToCompletion />
              </AdvancedGate>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <AdvancedGate isAdvanced={isAdvanced} currentPlan={plan}>
                <CompletionVelocity days={days} />
              </AdvancedGate>
              <AdvancedGate isAdvanced={isAdvanced} currentPlan={plan}>
                <ContentTypeEffectiveness days={days} />
              </AdvancedGate>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <AdvancedGate isAdvanced={isAdvanced} currentPlan={plan}>
                <CourseEffectivenessMatrix days={days} />
              </AdvancedGate>
              <AdvancedGate isAdvanced={isAdvanced} currentPlan={plan}>
                <CommunityCorrelation days={days} />
              </AdvancedGate>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <AdvancedGate isAdvanced={isAdvanced} currentPlan={plan}>
                <LearnerEngagementScore days={days} />
              </AdvancedGate>
              <AdvancedGate isAdvanced={isAdvanced} currentPlan={plan}>
                <UserProgressSnapshot days={days} />
              </AdvancedGate>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <AdvancedGate isAdvanced={isAdvanced} currentPlan={plan}>
                <GradeDistribution />
              </AdvancedGate>
              <AdvancedGate isAdvanced={isAdvanced} currentPlan={plan}>
                <CertificationRate days={days} />
              </AdvancedGate>
            </div>

            <AdvancedGate isAdvanced={isAdvanced} currentPlan={plan}>
              <SearchEffectiveness days={days} />
            </AdvancedGate>
          </div>
        )}
      </motion.div>
    </div>
  )
}
