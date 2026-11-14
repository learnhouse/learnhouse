'use client'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import ListShortcuts from '@components/Objects/Shortcuts/ListShortcuts'
import UserCertificates from '@components/Pages/Trail/UserCertificates'
import UserPaths from '@components/Pages/Trail/UserPaths'
import GeneralWrapperStyled from '@components/Objects/StyledElements/Wrappers/GeneralWrapper'
import TrailOverview, { type TrailStats } from '@components/Pages/Trail/TrailOverview'
import ActivityHeatmap from '@components/Pages/Trail/ActivityHeatmap'
import MyCourses from '@components/Pages/Trail/MyCourses'
import MyAssignments from '@components/Pages/Trail/MyAssignments'
import { getMyAssignments } from '@services/courses/assignments'
import { activityByDay, learningStreak, summarizeRuns } from '@components/Pages/Trail/trailStats'
import { useNextActivities } from '@components/Pages/Trail/useNextActivity'
import { useTrail } from '@/hooks/queries/useTrail'
import React, { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { getAllUserCertificates } from '@services/courses/certifications'
import { useContentLanguage } from '@/hooks/useContentLanguage'
import { asArray } from '@services/utils/ts/requests'
import { usePlayTrail } from '@ee/components/Plays/Trail/PlayTrail'
import FeatureGate from '@components/Dashboard/Shared/FeatureGate/FeatureGate'
import { useTrackView, AnalyticsEvent } from '@services/analytics'

// The learner's home for progress: where to pick up, headline numbers,
// activity over time, their courses, paths and achievements. Everything is
// derived from data the page already had (trail runs and steps, certificates,
// paths), plus Play badges and streak when the org has Plays.
function Trail(params: any) {
  const orgslug = params.orgslug
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const user = session?.data?.user
  const org = useOrg() as any
  const orgID = org?.id
  const features = org?.config?.config?.resolved_features ?? {}

  // Check if courses feature is enabled
  const isCoursesEnabled = features?.courses?.enabled ?? org?.config?.config?.features?.courses?.enabled !== false
  const playsEnabled = features?.playgrounds?.enabled === true

  // Only fetch trail data if courses feature is enabled; shares cache with course/activity pages
  const { data: trail } = useTrail(isCoursesEnabled ? orgID : undefined)
  useTrackView(AnalyticsEvent.TrailViewed, { runs_count: trail?.runs?.length ?? 0 }, !!trail)

  const summaries = useMemo(() => summarizeRuns(trail), [trail])
  const byDay = useMemo(() => activityByDay(trail), [trail])
  const streak = useMemo(() => learningStreak(byDay), [byDay])

  // Next activity per course, most recently active first so the courses the
  // learner is likely to continue stay within the fetch cap.
  const byRecent = useMemo(
    () => [...summaries].sort((a, b) => (b.lastActive?.getTime() ?? 0) - (a.lastActive?.getTime() ?? 0)),
    [summaries]
  )
  const nextByCourse = useNextActivities(byRecent)

  // Learner assignments, when the org has the feature.
  // Not a plan-gated FeatureKey: read the org toggle directly (on by default).
  const assignmentsEnabled =
    !!org && (features?.assignments?.enabled ?? org?.config?.config?.features?.assignments?.enabled) !== false
  const { data: myAssignments, isPending: assignmentsPending, isError: assignmentsError } = useQuery({
    queryKey: queryKeys.assignments.mine(orgID ?? 0),
    queryFn: () => getMyAssignments(orgID, access_token),
    enabled: assignmentsEnabled && !!access_token && !!orgID,
    staleTime: 30_000,
    retry: false,
  })
  const weekAhead = Date.now() + 7 * 24 * 3600 * 1000
  // An API without the endpoint (or any failure) just hides the section.
  const showAssignments = assignmentsEnabled && !assignmentsError
  const dueThisWeek = Array.isArray(myAssignments)
    ? myAssignments.filter((a) => {
        if (a.status === 'graded' || a.status === 'submitted' || a.status === 'late') return false
        if (a.overdue) return true
        if (!a.due_date) return false
        const d = new Date(a.due_date.length === 10 ? `${a.due_date}T23:59:59` : a.due_date)
        return !isNaN(d.getTime()) && d.getTime() <= weekAhead
      }).length
    : null

  const contentLang = useContentLanguage()
  // Same query (and cache) as the certificates section below.
  const { data: certificates } = useQuery({
    // Course names in the learner's content language (same key as the other list).
    queryKey: [...queryKeys.certifications.detail(`user_all_${orgID}`), contentLang.lang],
    queryFn: () => getAllUserCertificates(orgID, access_token, contentLang.lang || undefined),
    select: (res: any) => asArray(res),
    enabled: !!access_token && !!orgID && contentLang.ready,
    staleTime: 60_000,
  })

  // Plays (EE) are optional: without them, or on any failure, the Play
  // numbers stay hidden.
  const { badges: badgeList, streakDays: playStreakDays } = usePlayTrail({
    userId: user?.id,
    orgId: orgID,
    accessToken: access_token,
    enabled: playsEnabled,
  })

  const stats: TrailStats | null = trail
    ? {
        inProgress: summaries.filter((s) => !s.completed).length,
        completed: summaries.filter((s) => s.completed).length,
        activitiesDone: summaries.reduce((sum, s) => sum + s.done, 0),
        certificates: Array.isArray(certificates) ? certificates.length : null,
        streak,
        playBadges: badgeList ? badgeList.length : null,
        playStreak: playStreakDays,
        dueThisWeek: showAssignments ? dueThisWeek : null,
      }
    : null

  return (
    <FeatureGate feature="courses" orgslug={orgslug} context="public">
      <GeneralWrapperStyled>
        <ListShortcuts />
        {/* Compact first screen: greeting + numbers, then the courses,
            then assignments beside the activity graph. */}
        <div className="space-y-10 sm:space-y-14 pt-2 pb-16">
          <TrailOverview firstName={user?.first_name || user?.username} stats={stats} />

          <MyCourses
            orgslug={orgslug}
            orgId={orgID}
            accessToken={access_token}
            summaries={summaries}
            nextByCourse={nextByCourse}
            loading={!trail}
          />

          {(showAssignments || (trail && summaries.length > 0)) && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-12 items-start">
              {showAssignments && (
                <MyAssignments items={myAssignments} loading={assignmentsPending} orgslug={orgslug} />
              )}
              {trail && summaries.length > 0 && <ActivityHeatmap byDay={byDay} streak={streak} />}
            </div>
          )}

          <UserPaths orgslug={orgslug} />
          <UserCertificates orgslug={orgslug} badges={badgeList} />
        </div>
      </GeneralWrapperStyled>
    </FeatureGate>
  )
}

export default Trail
