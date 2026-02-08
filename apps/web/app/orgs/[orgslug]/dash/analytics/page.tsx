'use client'
import React, { useState } from 'react'
import AdminAuthorization from '@components/Security/AdminAuthorization'
import { usePlanInfo, useAnalyticsStatus } from '@components/Dashboard/Analytics/useAnalyticsDashboard'
import { isFeatureAvailable, PlanLevel } from '@services/plans/plans'

// Core widgets
import EventOverview from '@components/Dashboard/Analytics/EventOverview'
import CoreWidgetsRow from '@components/Dashboard/Analytics/CoreWidgetsRow'

// Advanced widgets
import { AdvancedGate } from '@components/Dashboard/Analytics/AdvancedGate'
import CourseDropoffMap from '@components/Dashboard/Analytics/CourseDropoffMap'
import CohortRetention from '@components/Dashboard/Analytics/CohortRetention'
import TimeToCompletion from '@components/Dashboard/Analytics/TimeToCompletion'
import PeakUsageHeatmap from '@components/Dashboard/Analytics/PeakUsageHeatmap'
import ContentTypeEffectiveness from '@components/Dashboard/Analytics/ContentTypeEffectiveness'
import NewVsReturning from '@components/Dashboard/Analytics/NewVsReturning'
import CompletionVelocity from '@components/Dashboard/Analytics/CompletionVelocity'
import CommunityCorrelation from '@components/Dashboard/Analytics/CommunityCorrelation'
import UserProgressSnapshot from '@components/Dashboard/Analytics/UserProgressSnapshot'
import GradeDistribution from '@components/Dashboard/Analytics/GradeDistribution'
import SearchEffectiveness from '@components/Dashboard/Analytics/SearchEffectiveness'
import CertificationRate from '@components/Dashboard/Analytics/CertificationRate'
import OrgGrowthTrend from '@components/Dashboard/Analytics/OrgGrowthTrend'
import LearnerEngagementScore from '@components/Dashboard/Analytics/LearnerEngagementScore'
import CourseEffectivenessMatrix from '@components/Dashboard/Analytics/CourseEffectivenessMatrix'

const DATE_RANGES = [
  { label: '7d', value: '7' },
  { label: '30d', value: '30' },
  { label: '90d', value: '90' },
]

export default function AnalyticsDashboard() {
  const [days, setDays] = useState('30')
  const { data: planInfo } = usePlanInfo()
  const { data: analyticsStatus, isLoading: statusLoading } = useAnalyticsStatus()
  const plan: PlanLevel = planInfo?.plan ?? 'free'
  const isAdvanced = isFeatureAvailable('analytics_advanced', plan)
  const isConfigured = analyticsStatus?.configured === true

  if (statusLoading) {
    return (
      <AdminAuthorization authorizationMode="component">
        <div className="p-6 max-w-[1400px] mx-auto">
          <div className="flex items-center justify-center h-64 text-gray-400">Loading...</div>
        </div>
      </AdminAuthorization>
    )
  }

  if (!isConfigured) {
    return (
      <AdminAuthorization authorizationMode="component">
        <div className="p-6 max-w-[1400px] mx-auto">
          <div className="flex flex-col items-center justify-center h-96 text-center">
            <div className="bg-gray-50 rounded-2xl border border-gray-100 p-10 max-w-md">
              <div className="text-4xl mb-4">📊</div>
              <h2 className="text-lg font-bold text-gray-900 mb-2">Analytics not configured</h2>
              <p className="text-sm text-gray-500 leading-relaxed">
                Analytics requires a Tinybird connection. Set the{' '}
                <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded font-mono">LEARNHOUSE_TINYBIRD_INGEST_TOKEN</code>{' '}
                and{' '}
                <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded font-mono">LEARNHOUSE_TINYBIRD_READ_TOKEN</code>{' '}
                environment variables to enable it.
              </p>
            </div>
          </div>
        </div>
      </AdminAuthorization>
    )
  }

  return (
    <AdminAuthorization authorizationMode="component">
      <div className="p-6 max-w-[1400px] mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Analytics</h1>
            <p className="text-sm text-gray-400">Insights about your learners and content</p>
          </div>
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
        </div>

        {/* Core Section */}
        <div className="space-y-6">
          {/* Stats + DAU chart in one box */}
          <EventOverview days={days} />

          {/* Funnel + Top Courses + Activity glued in one row */}
          <CoreWidgetsRow days={days} />
        </div>

        {/* Advanced Section */}
        <div className="mt-10">
          <div className="flex items-center gap-3 mb-6">
            <h2 className="text-lg font-bold text-gray-900">Advanced Analytics</h2>
            {!isAdvanced && (
              <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-medium">
                Pro
              </span>
            )}
          </div>

          <div className="space-y-6">
            {/* Growth & Retention */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <AdvancedGate isAdvanced={isAdvanced}>
                <OrgGrowthTrend days={days} />
              </AdvancedGate>
              <AdvancedGate isAdvanced={isAdvanced}>
                <NewVsReturning days={days} />
              </AdvancedGate>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <AdvancedGate isAdvanced={isAdvanced}>
                <CohortRetention days={days} />
              </AdvancedGate>
              <AdvancedGate isAdvanced={isAdvanced}>
                <PeakUsageHeatmap days={days} />
              </AdvancedGate>
            </div>

            {/* Course Performance */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <AdvancedGate isAdvanced={isAdvanced}>
                <CourseDropoffMap days={days} />
              </AdvancedGate>
              <AdvancedGate isAdvanced={isAdvanced}>
                <TimeToCompletion />
              </AdvancedGate>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <AdvancedGate isAdvanced={isAdvanced}>
                <CompletionVelocity days={days} />
              </AdvancedGate>
              <AdvancedGate isAdvanced={isAdvanced}>
                <ContentTypeEffectiveness days={days} />
              </AdvancedGate>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <AdvancedGate isAdvanced={isAdvanced}>
                <CourseEffectivenessMatrix days={days} />
              </AdvancedGate>
              <AdvancedGate isAdvanced={isAdvanced}>
                <CommunityCorrelation days={days} />
              </AdvancedGate>
            </div>

            {/* Learner Insights */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <AdvancedGate isAdvanced={isAdvanced}>
                <LearnerEngagementScore days={days} />
              </AdvancedGate>
              <AdvancedGate isAdvanced={isAdvanced}>
                <UserProgressSnapshot days={days} />
              </AdvancedGate>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <AdvancedGate isAdvanced={isAdvanced}>
                <GradeDistribution />
              </AdvancedGate>
              <AdvancedGate isAdvanced={isAdvanced}>
                <CertificationRate days={days} />
              </AdvancedGate>
            </div>

            <AdvancedGate isAdvanced={isAdvanced}>
              <SearchEffectiveness days={days} />
            </AdvancedGate>
          </div>
        </div>
      </div>
    </AdminAuthorization>
  )
}
