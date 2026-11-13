'use client'
import Link from 'next/link'
import { getUriWithOrg } from '@services/config/config'
import { CheckCircle, Circle, ChevronLeft, ChevronRight, Edit2, Loader2, Maximize2, Minimize2, Lock } from 'lucide-react'
import DripGate from '@components/Objects/Courses/DripGate'
import { markActivityAsComplete, unmarkActivityAsComplete } from '@services/courses/activity'
import { usePathname, useRouter } from 'next/navigation'
import AuthenticatedClientElement from '@components/Security/AuthenticatedClientElement'
import { getCourseThumbnailMediaDirectory, getUserAvatarMediaDirectory } from '@services/media/media'
import './theater.css'
import { useOrg, useOrgMembership } from '@components/Contexts/OrgContext'
import { CourseProvider } from '@components/Contexts/CourseContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useShortcut } from '@/lib/shortcuts/ShortcutsContext'
import { Keys } from '@components/Objects/Shortcuts/Kbd'
import { ShortcutHint } from '@components/Objects/Shortcuts/ShortcutHint'
import React, { useEffect, useRef, useMemo, lazy, Suspense } from 'react'
import { getAssignmentFromActivityUUID } from '@services/courses/assignments'
import { AssignmentProvider } from '@components/Contexts/Assignments/AssignmentContext'
import { AssignmentsTaskProvider } from '@components/Contexts/Assignments/AssignmentsTaskContext'
import AssignmentSubmissionProvider from '@components/Contexts/Assignments/AssignmentSubmissionContext'
import { AssignmentDirtyTasksProvider } from '@components/Contexts/Assignments/AssignmentDirtyTasksContext'
import AssignmentTools from '@components/Objects/Activities/Assignment/AssignmentTools'
import toast from 'react-hot-toast'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { useTrail } from '@/hooks/queries/useTrail'
import { useCourseMeta } from '@/hooks/queries/useCourses'
import { activityQueryOptions, useActivity } from '@/hooks/queries/useActivity'
import CourseAccessError from '@components/Objects/Courses/CourseAccessError/CourseAccessError'
import ConfirmationModal from '@components/Objects/StyledElements/ConfirmationModal/ConfirmationModal'
import { useMediaQuery } from 'usehooks-ts'
import PaidCourseActivityDisclaimer from '@ee/components/Payments/PaidCourseActivityDisclaimer'
import { useContributorStatus } from '../../../../../../../../hooks/useContributorStatus'
import ToolTip from '@components/Objects/StyledElements/Tooltip/Tooltip'
import ActivityChapterDropdown from '@components/Pages/Activity/ActivityChapterDropdown'
import ActivityShareDropdown from '@components/Pages/Activity/ActivityShareDropdown'
import FixedActivitySecondaryBar from '@components/Pages/Activity/FixedActivitySecondaryBar'
import MobileActivityBar from '@components/Pages/Activity/MobileActivityBar'
import CourseEndView from '@components/Pages/Activity/CourseEndView'
import { motion, AnimatePresence } from 'motion/react'
import { Breadcrumbs } from '@components/Objects/Breadcrumbs/Breadcrumbs'
import { BookCopy, ChevronLeft as BackIcon } from 'lucide-react'
import MiniInfoTooltip from '@components/Objects/MiniInfoTooltip'
import GeneralWrapperStyled from '@components/Objects/StyledElements/Wrappers/GeneralWrapper'
import ActivityIndicators from '@components/Pages/Courses/ActivityIndicators'
import UserAvatar from '@components/Objects/UserAvatar'
import { useTranslation } from 'react-i18next'
import { useDirection } from '@hooks/useDirection'
import { formatDate } from '@/lib/format'
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics'

// Lazy load heavy components
const Canva = lazy(() => import('@components/Objects/Activities/DynamicCanva/DynamicCanva'))
const VideoActivity = lazy(() => import('@components/Objects/Activities/Video/Video'))
const DocumentPdfActivity = lazy(() => import('@components/Objects/Activities/DocumentPdf/DocumentPdf'))
const AssignmentStudentActivity = lazy(() => import('@components/Objects/Activities/Assignment/AssignmentStudentActivity'))
const AIActivityAsk = lazy(() => import('@components/Objects/Activities/AI/AIActivityAsk'))
const AISidePanelContentWrapper = lazy(() => import('@components/Objects/Activities/AI/AIActivityAsk').then(mod => ({ default: mod.AISidePanelContentWrapper })))
const AISidePanelInline = lazy(() => import('@components/Objects/Activities/AI/AIActivityAsk').then(mod => ({ default: mod.AISidePanelInline })))
const AIChatBotProvider = lazy(() => import('@components/Contexts/AI/AIChatBotContext'))
const ScormActivity = lazy(() => import('@ee/components/Activities/ScormActivity'))
const MarkdownActivity = lazy(() => import('@components/Objects/Activities/Markdown/MarkdownActivity'))
const EmbedActivity = lazy(() => import('@components/Objects/Activities/Embed/EmbedActivity'))
const ResourceActivity = lazy(() => import('@components/Objects/Activities/Resource/ResourceActivity'))
const LiveSessionActivity = lazy(() => import('@ee/components/LiveSessions/LiveSessionActivity'))

// Loading fallback component
const LoadingFallback = () => (
  <div className="flex items-center justify-center h-64">
    <div className="relative w-6 h-6">
      <div className="absolute top-0 start-0 w-full h-full border-2 border-gray-100 rounded-full"></div>
      <div className="absolute top-0 start-0 w-full h-full border-2 border-gray-400 rounded-full animate-spin border-t-transparent"></div>
    </div>
  </div>
);

function ActivityContentSkeleton({ activityType }: { activityType?: string }) {
  const isVideo = activityType === 'TYPE_VIDEO' || activityType === 'TYPE_SCORM'
  const isDocument = activityType === 'TYPE_DOCUMENT'

  if (isVideo) {
    return (
      <div className="rounded-lg overflow-hidden relative bg-zinc-900 animate-pulse" style={{ minHeight: '420px' }}>
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-20 h-20 rounded-full bg-white/10 flex items-center justify-center">
            <div className="ms-1 w-0 h-0 border-t-[12px] border-t-transparent border-b-[12px] border-b-transparent border-s-[18px] border-s-white/25" />
          </div>
        </div>
      </div>
    )
  }

  if (isDocument) {
    return (
      <div className="bg-white nice-shadow rounded-lg p-3 sm:p-7 animate-pulse space-y-3" style={{ minHeight: '520px' }}>
        <div className="h-4 bg-gray-100 rounded w-full" />
        <div className="h-4 bg-gray-100 rounded w-[94%]" />
        <div className="h-4 bg-gray-100 rounded w-[88%]" />
        <div className="rounded bg-gray-100 h-[320px] mt-4" />
        <div className="h-4 bg-gray-100 rounded w-full mt-4" />
        <div className="h-4 bg-gray-100 rounded w-[91%]" />
        <div className="h-4 bg-gray-100 rounded w-[82%]" />
      </div>
    )
  }

  return (
    <div className="bg-white nice-shadow rounded-lg p-3 sm:p-7 animate-pulse space-y-4" style={{ minHeight: '420px' }}>
      <div className="h-7 bg-gray-100 rounded w-2/5 mb-2" />
      <div className="h-4 bg-gray-100 rounded w-full" />
      <div className="h-4 bg-gray-100 rounded w-[92%]" />
      <div className="h-4 bg-gray-100 rounded w-full" />
      <div className="h-4 bg-gray-100 rounded w-[86%]" />
      <div className="h-5 bg-gray-100 rounded w-1/3 mt-6" />
      <div className="h-4 bg-gray-100 rounded w-full" />
      <div className="h-4 bg-gray-100 rounded w-[96%]" />
      <div className="h-4 bg-gray-100 rounded w-[78%]" />
      <div className="h-5 bg-gray-100 rounded w-2/5 mt-4" />
      <div className="h-4 bg-gray-100 rounded w-full" />
      <div className="h-4 bg-gray-100 rounded w-[88%]" />
      <div className="h-4 bg-gray-100 rounded w-[72%]" />
    </div>
  )
}

interface ActivityClientProps {
  activityid: string
  courseuuid: string
  orgslug: string
  activity: any | null
  course: any | null
}

interface ActivityActionsProps {
  activity: any
  activityid: string
  course: any
  orgslug: string
  assignment: any
  showNavigation?: boolean
  trailData?: any
  /** Dark styling, for the video theater band. */
  dark?: boolean
  /** Phone activity bar presentation. */
  compact?: boolean
}

// Custom hook for activity position
function useActivityPosition(course: any, activityId: string) {
  return useMemo(() => {
    if (!course?.chapters) return { allActivities: [], currentIndex: -1 };

    let allActivities: any[] = [];
    let currentIndex = -1;

    course.chapters.forEach((chapter: any) => {
      chapter.activities.forEach((activity: any) => {
        const cleanActivityUuid = activity.activity_uuid?.replace('activity_', '');
        allActivities.push({
          ...activity,
          cleanUuid: cleanActivityUuid,
          chapterName: chapter.name
        });

        if (cleanActivityUuid === activityId.replace('activity_', '')) {
          currentIndex = allActivities.length - 1;
        }
      });
    });

    return { allActivities, currentIndex };
  }, [course, activityId]);
}

function ActivityActions({ activity, activityid, course, orgslug, assignment, showNavigation = true, trailData, dark = false, compact = false }: ActivityActionsProps) {

  const { t: _t } = useTranslation();
  const _org = useOrg() as any;
  const session = useLHSession() as any;
  const _access_token = session?.data?.tokens?.access_token;


  return (
    <div className="flex space-x-2 items-center">
      {activity && activity.published == true && activity.content.paid_access != false && (
        <AuthenticatedClientElement checkMethod="authentication">
          {activity.activity_type != 'TYPE_ASSIGNMENT' && (
            <>
              <MarkStatus
                activity={activity}
                activityid={activityid}
                course={course}
                orgslug={orgslug}
                trailData={trailData}
                dark={dark}
                compact={compact}
              />
            </>
          )}
          {activity.activity_type == 'TYPE_ASSIGNMENT' && (
            <>
              <AssignmentSubmissionProvider assignment_uuid={assignment?.assignment_uuid}>
                <div className={compact ? 'lh-assign-compact' : 'contents'}>
                  <AssignmentTools
                    assignment={assignment}
                    activity={activity}
                    activityid={activityid}
                    course={course}
                    orgslug={orgslug}
                  />
                </div>
              </AssignmentSubmissionProvider>
            </>
          )}
          {showNavigation && (
            <NextActivityButton course={course} currentActivityId={activity.id} orgslug={orgslug} dark={dark} />
          )}
        </AuthenticatedClientElement>
      )}
    </div>
  );
}

function ActivityClient(props: ActivityClientProps) {
  const { t, i18n } = useTranslation()
  // Slide offsets are physical pixels; flip their sign in RTL.
  const { x: dx, isRTL } = useDirection()
  const activityid = props.activityid

  function getRelativeTime(date: Date): string {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    const weeks = Math.floor(days / 7);
    const months = Math.floor(days / 30);
    const years = Math.floor(days / 365);
  
    if (years > 0) return t('time.years_ago', { count: years });
    if (months > 0) return t('time.months_ago', { count: months });
    if (weeks > 0) return t('time.weeks_ago', { count: weeks });
    if (days > 0) return t('time.days_ago', { count: days });
    if (hours > 0) return t('time.hours_ago', { count: hours });
    if (minutes > 0) return t('time.minutes_ago', { count: minutes });
    return t('common.just_now');
  }

  const courseuuid = props.courseuuid
  const orgslug = props.orgslug
  const org = useOrg() as any

  const { data: course, isLoading: courseLoading, error: courseError } = useCourseMeta(courseuuid)
  const { data: activity, isLoading: activityLoading } = useActivity(activityid)
  const session = useLHSession() as any;
  const pathname = usePathname()
  const access_token = session?.data?.tokens?.access_token;
  const [bgColor, setBgColor] = React.useState('bg-white nice-shadow')
  const [assignment, setAssignment] = React.useState(null) as any;
  const [_markStatusButtonActive, setMarkStatusButtonActive] = React.useState(false);
  const [focusModePref, setIsFocusMode] = React.useState(false);
  // Focus mode is a desktop layout; a phone already reads one column with
  // its own bars, so a preference saved on desktop doesn't carry over.
  const isPhone = useMediaQuery('(max-width: 767px)');
  const isFocusMode = focusModePref && !isPhone;
  const isInitialRender = useRef(true);
  const { contributorStatus } = useContributorStatus(courseuuid);
  const router = useRouter();

  const { track } = useLHAnalytics('learner')
  const activityStartTime = useRef(Date.now())

  // Track activity view on mount, time_on_activity on unmount
  const activityUuidForTracking = activity?.activity_uuid
  const courseUuidForTracking = course?.course_uuid
  const activityTypeForTracking = activity?.activity_type
  useEffect(() => {
    if (activityUuidForTracking && courseUuidForTracking) {
      activityStartTime.current = Date.now()
      track(AnalyticsEvent.ActivityViewed, {
        activity_uuid: activityUuidForTracking,
        course_uuid: courseUuidForTracking,
        activity_type: activityTypeForTracking,
      })
    }
    return () => {
      if (activityUuidForTracking && courseUuidForTracking) {
        const seconds = Math.round((Date.now() - activityStartTime.current) / 1000)
        if (seconds > 0) {
          track(AnalyticsEvent.TimeOnActivity, {
            activity_uuid: activityUuidForTracking,
            course_uuid: courseUuidForTracking,
            activity_type: activityTypeForTracking,
            seconds_spent: seconds,
          })
        }
      }
    }
  }, [activityid, activityUuidForTracking, courseUuidForTracking, activityTypeForTracking, track])

  const _queryClient = useQueryClient()

  // Fetch trail data; shares cache key with course page trail query
  const { data: trailData } = useTrail(org?.id)

  // Memoize activity position calculation
  const { allActivities, currentIndex } = useActivityPosition(course, activityid);
  
  // Get previous and next activities
  const prevActivity = currentIndex > 0 ? allActivities[currentIndex - 1] : null;
  const nextActivity = currentIndex < allActivities.length - 1 ? allActivities[currentIndex + 1] : null;

  // Memoize activity content
  const activityContent = useMemo(() => {
    if (!activity || !activity.published || activity.content.paid_access === false) {
      return null;
    }

    switch (activity.activity_type) {
      case 'TYPE_DYNAMIC':
        if (activity.activity_sub_type === 'SUBTYPE_DYNAMIC_MARKDOWN') {
          return (
            <Suspense fallback={<LoadingFallback />}>
              <MarkdownActivity activity={activity} />
            </Suspense>
          );
        }
        if (activity.activity_sub_type === 'SUBTYPE_DYNAMIC_EMBED') {
          return (
            <Suspense fallback={<LoadingFallback />}>
              <EmbedActivity activity={activity} />
            </Suspense>
          );
        }
        if (activity.activity_sub_type === 'SUBTYPE_DYNAMIC_RESOURCE') {
          return (
            <Suspense fallback={<LoadingFallback />}>
              <ResourceActivity activity={activity} orgslug={orgslug} />
            </Suspense>
          );
        }
        return (
          <Suspense fallback={<LoadingFallback />}>
            <Canva content={activity.content} activity={activity} courseUuid={course?.course_uuid} orgUuid={org?.org_uuid} />
          </Suspense>
        );
      case 'TYPE_VIDEO':
        return (
          <Suspense fallback={<LoadingFallback />}>
            <VideoActivity course={course} activity={activity} />
          </Suspense>
        );
      case 'TYPE_DOCUMENT':
        return (
          <Suspense fallback={<LoadingFallback />}>
            <DocumentPdfActivity course={course} activity={activity} />
          </Suspense>
        );
      case 'TYPE_ASSIGNMENT':
        return assignment ? (
          <Suspense fallback={<LoadingFallback />}>
            {/* AssignmentSubmissionProvider wraps AssignmentProvider (instead
                of being nested inside it) so that BOTH providers mount in the
                same render cycle and kick off their SWR calls in parallel.
                Otherwise AssignmentSubmissionProvider would wait for
                AssignmentProvider's gated load before firing its own
                requests, adding an extra round-trip phase. */}
            <AssignmentSubmissionProvider assignment_uuid={assignment?.assignment_uuid}>
              <AssignmentProvider assignment_uuid={assignment?.assignment_uuid}>
                <AssignmentsTaskProvider>
                  <AssignmentStudentActivity />
                </AssignmentsTaskProvider>
              </AssignmentProvider>
            </AssignmentSubmissionProvider>
          </Suspense>
        ) : null;
      case 'TYPE_SCORM':
        return (
          <Suspense fallback={<LoadingFallback />}>
            <ScormActivity course={course} activity={activity} />
          </Suspense>
        );
      case 'TYPE_LIVE_SESSION':
        return (
          <Suspense fallback={<LoadingFallback />}>
            <LiveSessionActivity activity={activity} orgslug={orgslug} />
          </Suspense>
        );
      default:
        return null;
    }
  }, [activity, course, assignment, orgslug]);

  // Past the last activity lies the course-end screen holding the certificate.
  const isLastActivity = currentIndex >= 0 && !nextActivity;

  // Navigate to an activity. A null target means "there is nothing after this
  // one"; on the final activity that means the course-end/certificate screen
  // rather than a dead end.
  const navigateToActivity = (activity: any) => {
    const cleanCourseUuid = course.course_uuid?.replace('course_', '');
    if (!activity) {
      if (isLastActivity) {
        router.push(getUriWithOrg(orgslug, '') + `/course/${cleanCourseUuid}/activity/end`);
      }
      return;
    }

    router.push(getUriWithOrg(orgslug, '') + `/course/${cleanCourseUuid}/activity/${activity.cleanUuid}`);
  };

  // Keyboard: j / k (or the arrow pointing forward / back in the reading
  // direction) step through lessons, ] / [ jump a whole chapter, f toggles
  // focus mode and Esc leaves it, Space drives a video, c goes back to the
  // course. Registered only once the course is known, and never on the
  // course-end screen, where there is no lesson to step from.
  const shortcutsReady = !!course && activityid !== 'end'
  const forwardArrow = isRTL ? 'arrowleft' : 'arrowright'
  const backArrow = isRTL ? 'arrowright' : 'arrowleft'
  useShortcut(
    { id: 'activity.next', keys: 'j', aliases: [forwardArrow], label: t('shortcuts.next_lesson'), group: 'page',
      run: () => navigateToActivity(nextActivity) },
    shortcutsReady && (!!nextActivity || isLastActivity),
  )
  useShortcut(
    { id: 'activity.prev', keys: 'k', aliases: [backArrow], label: t('shortcuts.previous_lesson'), group: 'page',
      run: () => navigateToActivity(prevActivity) },
    shortcutsReady && !!prevActivity,
  )

  // First lesson of the neighbouring chapters, skipping empty chapters.
  const chapterNeighbours = useMemo(() => {
    const chapters: any[] = course?.chapters ?? []
    const cleanId = activityid.replace('activity_', '')
    const here = chapters.findIndex((ch) =>
      (ch.activities ?? []).some((a: any) => a.activity_uuid?.replace('activity_', '') === cleanId))
    const firstOf = (ch: any) => {
      const a = (ch?.activities ?? [])[0]
      return a ? { ...a, cleanUuid: a.activity_uuid?.replace('activity_', '') } : null
    }
    const pick = (from: number, step: 1 | -1) => {
      for (let i = from; i >= 0 && i < chapters.length; i += step) {
        const a = firstOf(chapters[i])
        if (a) return a
      }
      return null
    }
    return here < 0
      ? { next: null, prev: null }
      : { next: pick(here + 1, 1), prev: pick(here - 1, -1) }
  }, [course, activityid])
  useShortcut(
    { id: 'activity.nextChapter', keys: ']', label: t('shortcuts.next_chapter'), group: 'page',
      run: () => navigateToActivity(chapterNeighbours.next) },
    shortcutsReady && !!chapterNeighbours.next,
  )
  useShortcut(
    { id: 'activity.prevChapter', keys: '[', label: t('shortcuts.previous_chapter'), group: 'page',
      run: () => navigateToActivity(chapterNeighbours.prev) },
    shortcutsReady && !!chapterNeighbours.prev,
  )

  useShortcut(
    { id: 'activity.focus', keys: 'f', label: t('shortcuts.toggle_focus'), group: 'page',
      run: () => setIsFocusMode((v) => !v) },
    shortcutsReady,
  )
  useShortcut(
    { id: 'activity.exitFocus', keys: 'escape', label: t('shortcuts.exit_focus'), group: 'page',
      hideFromPalette: true, run: () => setIsFocusMode(false) },
    shortcutsReady && isFocusMode,
  )
  useShortcut(
    { id: 'activity.playPause', keys: 'space', label: t('shortcuts.play_pause'), group: 'page',
      run: () => {
        const video = document.querySelector<HTMLVideoElement>('.video-js video, video')
        if (!video) return
        if (video.paused) void video.play()
        else video.pause()
      } },
    shortcutsReady && activity?.activity_type === 'TYPE_VIDEO',
  )
  useShortcut(
    { id: 'activity.course', keys: 'c', label: t('shortcuts.back_to_course'), group: 'page',
      run: () => router.push(getUriWithOrg(orgslug, `/course/${course?.course_uuid?.replace('course_', '')}`)) },
    !!course,
  )

  // Initialize focus mode from localStorage
  React.useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('globalFocusMode');
      setIsFocusMode(saved === 'true');
    }
  }, []);

  // Save focus mode to localStorage
  React.useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('globalFocusMode', focusModePref.toString());
      // Dispatch custom event for focus mode change
      window.dispatchEvent(new CustomEvent('focusModeChange', { 
        detail: { isFocusMode: focusModePref } 
      }));
      isInitialRender.current = false;
    }
  }, [focusModePref]);

  function getChapterNameByActivityId(course: any, activity_id: any) {
    for (let i = 0; i < course.chapters.length; i++) {
      let chapter = course.chapters[i]
      for (let j = 0; j < chapter.activities.length; j++) {
        let activity = chapter.activities[j]
        if (activity.id === activity_id) {
          return `${t('courses.chapter')} ${i + 1} : ${chapter.name}`
        }
      }
    }
    return null // return null if no matching activity is found
  }

  async function getAssignmentUI() {
    const assignment = await getAssignmentFromActivityUUID(activity.activity_uuid, access_token)
    setAssignment(assignment.data)
  }

  useEffect(() => {
    if (!activity) return;
    if (activity.activity_type == 'TYPE_DYNAMIC' || activity.activity_type == 'TYPE_SCORM') {
      setBgColor(isFocusMode ? 'bg-white' : 'bg-white nice-shadow');
    }
    else if (activity.activity_type == 'TYPE_ASSIGNMENT') {
      setMarkStatusButtonActive(false);
      // The assignment lays out its own cards (overview, one per task, hand-in).
      setBgColor('');
      getAssignmentUI();
    }
    else if (activity.activity_type == 'TYPE_VIDEO' || activity.activity_type == 'TYPE_LIVE_SESSION') {
      // The player (or the session card) is the whole surface; no dark card around it.
      setBgColor('');
    }
    else {
      setBgColor(isFocusMode ? 'bg-zinc-950' : 'bg-zinc-950 nice-shadow');
    }
  }
    , [activity, pathname, isFocusMode])

  // Without this a failed course fetch (e.g. a signed-out visitor on a
  // members-only course) left the skeleton below spinning forever.
  if (!course && courseError) {
    return <CourseAccessError error={courseError} orgslug={orgslug} />
  }

  if (courseLoading || !course) {
    return (
      <GeneralWrapperStyled>
        <div className="animate-pulse pt-6 space-y-5">
          {/* Breadcrumb */}
          <div className="flex items-center gap-2 pb-1">
            <div className="h-3 bg-gray-200 rounded w-14" />
            <div className="h-3 bg-gray-200 rounded w-2" />
            <div className="h-3 bg-gray-200 rounded w-24" />
            <div className="h-3 bg-gray-200 rounded w-2" />
            <div className="h-3 bg-gray-200 rounded w-28" />
          </div>
          {/* Course header: thumbnail + name */}
          <div className="flex items-center gap-4">
            <div className="w-[60px] h-[34px] sm:w-[100px] sm:h-[57px] bg-gray-200 rounded-md shrink-0" />
            <div className="space-y-2">
              <div className="h-3 bg-gray-200 rounded w-10" />
              <div className="h-7 bg-gray-200 rounded w-52" />
            </div>
          </div>
          {/* Progress bar */}
          <div className="h-2 bg-gray-200 rounded-full w-full" />
          {/* Activity title row */}
          <div className="space-y-2">
            <div className="h-3 bg-gray-200 rounded w-28" />
            <div className="h-8 bg-gray-200 rounded w-2/3" />
            <div className="flex items-center gap-2 pt-0.5">
              <div className="w-6 h-6 bg-gray-200 rounded-full shrink-0" />
              <div className="h-3 bg-gray-200 rounded w-24" />
            </div>
          </div>
          {/* Content box placeholder */}
          <div className="bg-white nice-shadow rounded-lg p-3 sm:p-7 animate-pulse space-y-4" style={{ minHeight: '420px' }}>
            <div className="h-7 bg-gray-100 rounded w-2/5 mb-2" />
            <div className="h-4 bg-gray-100 rounded w-full" />
            <div className="h-4 bg-gray-100 rounded w-[92%]" />
            <div className="h-4 bg-gray-100 rounded w-full" />
            <div className="h-4 bg-gray-100 rounded w-[86%]" />
            <div className="h-5 bg-gray-100 rounded w-1/3 mt-6" />
            <div className="h-4 bg-gray-100 rounded w-full" />
            <div className="h-4 bg-gray-100 rounded w-[96%]" />
          </div>
        </div>
      </GeneralWrapperStyled>
    )
  }

  const activityNameFromCourse = allActivities[currentIndex]?.name ?? ''
  const chapterNameFromCourse = allActivities[currentIndex]?.chapterName ?? ''
  const displayName = activity?.name ?? activityNameFromCourse
  const displayActivityType = allActivities[currentIndex]?.activity_type

  if (activity?.is_locked && activity?.drip_reason) {
    return (
      <DripGate
        activityName={displayName}
        dripReason={activity.drip_reason}
        dripUnlockAt={activity.drip_unlock_at}
        courseHref={getUriWithOrg(orgslug, '') + `/course/${courseuuid}`}
      />
    )
  }

  if (activity?.is_locked) {
    const isAuthenticated = session?.status === 'authenticated'
    return (
      <GeneralWrapperStyled>
        <div className="max-w-2xl mx-auto my-16 bg-white rounded-2xl border border-gray-200/80 shadow-sm p-8 text-center">
          <div className="mx-auto w-14 h-14 rounded-full bg-rose-50 flex items-center justify-center mb-4">
            <Lock className="text-rose-500" size={24} />
          </div>
          <h1 className="text-xl font-semibold text-gray-900 mb-2">
            {t('course.locked_title', 'This activity is locked')}
          </h1>
          <p className="text-sm text-gray-500 mb-6 leading-relaxed">
            {isAuthenticated
              ? t('course.locked_restricted', 'You need to be a member of the right user group to access this. Ask a course admin to add you.')
              : t('course.locked_auth_required', 'You need to sign in to access this activity.')}
          </p>
          <div className="flex flex-col sm:flex-row gap-2 justify-center">
            {!isAuthenticated && (
              <Link
                href={getUriWithOrg(orgslug, '/login')}
                className="inline-flex items-center justify-center px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-semibold hover:bg-gray-800 transition-colors"
              >
                {t('auth.sign_in', 'Sign in')}
              </Link>
            )}
            <Link
              href={getUriWithOrg(orgslug, '') + `/course/${courseuuid}`}
              className="inline-flex items-center justify-center px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-semibold hover:bg-gray-200 transition-colors"
            >
              {t('course.back_to_course', 'Back to course')}
            </Link>
          </div>
        </div>
      </GeneralWrapperStyled>
    )
  }

  return (
    <>
      <CourseProvider courseuuid={course?.course_uuid} initialCourseStructure={course}>
        {/* Common ancestor of BOTH the task editors and the Submit button, which
            live in disjoint AssignmentSubmissionProvider subtrees. Lets Submit
            flush unsaved task answers before grading (avoids silent 0%). */}
        <AssignmentDirtyTasksProvider>
        <Suspense fallback={<LoadingFallback />}>
          <AIChatBotProvider>
            <Suspense fallback={null}>
              <AISidePanelContentWrapper>
            {isFocusMode ? (
              <AnimatePresence>
                <motion.div
                  initial={isInitialRender.current ? false : { opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.3 }}
                  className="fixed inset-0 bg-white"
                  style={{ zIndex: 'var(--z-overlay)' }}
                >
                  {/* Focus Mode Top Bar */}
                  <motion.div 
                    initial={isInitialRender.current ? false : { y: -100 }}
                    animate={{ y: 0 }}
                    exit={{ y: -100 }}
                    transition={{ duration: 0.3 }}
                    className="fixed top-0 start-0 end-0 bg-white/90 backdrop-blur-xl border-b border-gray-100"
                    style={{ zIndex: 'var(--z-modal-content)' }}
                  >
                    <div className="container mx-auto px-4 py-2">
                      <div className="flex items-center justify-between h-14">
                        {/* Progress Indicator - Moved to left */}
                        <motion.div 
                          initial={isInitialRender.current ? false : { opacity: 0, x: -20 * dx }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: 0.2 }}
                          className="flex items-center space-x-2"
                        >
                          <div className="relative w-8 h-8">
                            <svg className="w-full h-full transform -rotate-90">
                              <circle
                                cx="16"
                                cy="16"
                                r="14"
                                stroke="#e5e7eb"
                                strokeWidth="3"
                                fill="none"
                              />
                              <circle
                                cx="16"
                                cy="16"
                                r="14"
                                stroke="#10b981"
                                strokeWidth="3"
                                fill="none"
                                strokeLinecap="round"
                                strokeDasharray={2 * Math.PI * 14}
                                strokeDashoffset={2 * Math.PI * 14 * (1 - (trailData?.runs?.find((run: any) => run.course_uuid === course.course_uuid)?.steps?.filter((step: any) => step.complete)?.length || 0) / (course.chapters?.reduce((acc: number, chapter: any) => acc + chapter.activities.length, 0) || 1))}
                              />
                            </svg>
                            <div className="absolute inset-0 flex items-center justify-center">
                              <span className="text-xs font-bold text-gray-800">
                                {Math.round(((trailData?.runs?.find((run: any) => run.course_uuid === course.course_uuid)?.steps?.filter((step: any) => step.complete)?.length || 0) / (course.chapters?.reduce((acc: number, chapter: any) => acc + chapter.activities.length, 0) || 1)) * 100)}%
                              </span>
                            </div>
                          </div>
                          <div className="text-xs text-gray-600">
                            {trailData?.runs?.find((run: any) => run.course_uuid === course.course_uuid)?.steps?.filter((step: any) => step.complete)?.length || 0} {t('common.of')} {course.chapters?.reduce((acc: number, chapter: any) => acc + chapter.activities.length, 0) || 0}
                          </div>
                        </motion.div>
                        
                        {/* Center Course Info */}
                        <motion.div 
                          initial={isInitialRender.current ? false : { opacity: 0, y: -20 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: 0.1 }}
                          className="flex items-center space-x-4"
                        >
                          <div className="flex">
                            <Link
                              href={getUriWithOrg(orgslug, '') + `/course/${courseuuid}`}
                            >
                              <img
                                className="w-[60px] h-[34px] shrink-0 rounded-md drop-shadow-md object-cover"
                                src={course.thumbnail_image
                                  ? getCourseThumbnailMediaDirectory(
                                      org?.org_uuid,
                                      course.course_uuid,
                                      course.thumbnail_image
                                    )
                                  : '/empty_thumbnail.png'
                                }
                                onError={(e) => {
                                  if (!e.currentTarget.src.endsWith('/empty_thumbnail.png')) e.currentTarget.src = '/empty_thumbnail.png'
                                }}
                                alt=""
                              />
                            </Link>
                          </div>
                          <div className="flex flex-col -space-y-1">
                            <p className="font-bold text-gray-700 text-sm">{t('search.course')} </p>
                            <h1 className="font-bold text-gray-950 text-lg">
                              {course.name}
                            </h1>
                          </div>
                        </motion.div>

                        {/* Minimize and Chapters - Moved to right */}
                        <motion.div
                          initial={isInitialRender.current ? false : { opacity: 0, x: 20 * dx }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: 0.2 }}
                          className="flex items-center space-x-2"
                        >
                          {activity && (
                            <div className="hidden sm:block">
                              <ActivityShareDropdown
                                activityName={activity.name}
                                activityUrl={typeof window !== 'undefined' ? window.location.href : ''}
                                orgslug={orgslug}
                                courseUuid={course.course_uuid}
                                activityId={activity.activity_uuid ? activity.activity_uuid.replace('activity_', '') : activityid.replace('activity_', '')}
                                activityType={activity.activity_type}
                              />
                            </div>
                          )}
                          <ActivityChapterDropdown
                            course={course}
                            currentActivityId={activity ? (activity.activity_uuid ? activity.activity_uuid.replace('activity_', '') : activityid.replace('activity_', '')) : activityid.replace('activity_', '')}
                            orgslug={orgslug}
                            trailData={trailData}
                          />
                          <ShortcutHint label={t('activities.exit_focus_mode')} keys="escape">
                            <motion.button
                              whileHover={{ scale: 1.05 }}
                              whileTap={{ scale: 0.95 }}
                              onClick={() => setIsFocusMode(false)}
                              className="bg-white nice-shadow p-2 rounded-full cursor-pointer hover:bg-gray-50"
                              aria-label={t('activities.exit_focus_mode')}
                            >
                              <Minimize2 size={16} className="text-gray-700" />
                            </motion.button>
                          </ShortcutHint>
                        </motion.div>
                      </div>
                    </div>
                  </motion.div>

                  {/* Focus Mode Content */}
                  <div className="pt-16 pb-20 h-full overflow-auto">
                    <div className="container mx-auto px-4">
                      {activity && activity.published == true && (
                        <>
                          {activity.content.paid_access == false ? (
                            <PaidCourseActivityDisclaimer course={course} activity={activity} />
                          ) : (
                            <motion.div
                              initial={isInitialRender.current ? false : { scale: 0.95, opacity: 0 }}
                              animate={{ scale: 1, opacity: 1 }}
                              transition={{ delay: 0.3 }}
                              className={`${activity.activity_type === 'TYPE_SCORM' ? 'rounded-xl overflow-hidden' : (activity.activity_type === 'TYPE_VIDEO' || activity.activity_type === 'TYPE_LIVE_SESSION') ? '' : 'p-7 rounded-lg'} ${bgColor} mt-4`}
                            >
                              {/* Activity Types */}
                              <div className={activity.activity_type === 'TYPE_SCORM' ? 'overflow-hidden' : ''}>
                                {activityContent}
                              </div>
                            </motion.div>
                          )}
                        </>
                      )}
                    </div>
                  </div>

                  {/* Focus Mode Bottom Bar */}
                  {activity && activity.published == true && activity.content.paid_access != false && (
                    <motion.div 
                      initial={isInitialRender.current ? false : { y: 100 }}
                      animate={{ y: 0 }}
                      exit={{ y: 100 }}
                      transition={{ duration: 0.3 }}
                      className="fixed bottom-0 start-0 end-0 bg-white/90 backdrop-blur-xl border-t border-gray-100"
                      style={{ zIndex: 'var(--z-modal-content)' }}
                    >
                      <div className="container mx-auto px-4">
                        <div className="flex items-center justify-between h-16">
                          <div className="flex items-center space-x-2">
                            <button
                              onClick={() => navigateToActivity(prevActivity)}
                              className={`flex items-center space-x-1.5 p-2 rounded-md transition-all duration-200 cursor-pointer ${
                                prevActivity
                                  ? 'text-gray-700'
                                  : 'opacity-50 text-gray-400 cursor-not-allowed'
                              }`}
                              disabled={!prevActivity}
                              title={prevActivity ? `${t('common.previous')}: ${prevActivity.name}` : t('activities.no_previous_activity')}
                            >
                              <ChevronLeft size={20} className="text-gray-800 shrink-0" />
                              <Keys keys="k" tone="muted" className="hidden sm:inline-flex" />
                              <div className="flex flex-col items-start">
                                <span className="text-xs text-gray-500">{t('common.previous')}</span>
                                <span className="text-sm capitalize font-semibold text-start">
                                  {prevActivity ? prevActivity.name : t('activities.no_previous_activity')}
                                </span>
                              </div>
                            </button>
                          </div>
                          <div className="flex items-center space-x-2">
                            <ActivityActions
                              activity={activity}
                              activityid={activityid}
                              course={course}
                              orgslug={orgslug}
                              assignment={assignment}
                              showNavigation={false}
                              trailData={trailData}
                            />
                            <button
                              onClick={() => navigateToActivity(nextActivity)}
                              className={`flex items-center space-x-1.5 p-2 rounded-md transition-all duration-200 cursor-pointer ${
                                nextActivity || isLastActivity
                                  ? 'text-gray-700'
                                  : 'opacity-50 text-gray-400 cursor-not-allowed'
                              }`}
                              disabled={!nextActivity && !isLastActivity}
                              title={
                                nextActivity
                                  ? `${t('common.next')}: ${nextActivity.name}`
                                  : isLastActivity
                                    ? t('course.finish_course', 'Finish course')
                                    : t('activities.no_next_activity')
                              }
                            >
                              <div className="flex flex-col items-end">
                                <span className="text-xs text-gray-500">{t('common.next')}</span>
                                <span className="text-sm capitalize font-semibold text-end">
                                  {nextActivity
                                    ? nextActivity.name
                                    : isLastActivity
                                      ? t('course.finish_course', 'Finish course')
                                      : t('activities.no_next_activity')}
                                </span>
                              </div>
                              <Keys keys="j" tone="muted" className="hidden sm:inline-flex" />
                              <ChevronRight size={20} className="text-gray-800 shrink-0" />
                            </button>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </motion.div>
              </AnimatePresence>
            ) : (
              <GeneralWrapperStyled>
                {/* Original non-focus mode UI */}
                {activityid === 'end' ? (
                  <CourseEndView 
                    courseName={course.name}
                    orgslug={orgslug}
                    courseUuid={course.course_uuid}
                    thumbnailImage={course.thumbnail_image}
                    course={course}
                    trailData={trailData}
                  />
                ) : (
                  <div className="space-y-4 pt-0 relative">
                    {/* Phones: one back row to the course instead of the
                        breadcrumb trail and the course header below. */}
                    <Link
                      href={getUriWithOrg(orgslug, `/course/${courseuuid}`)}
                      className="sm:hidden lh-press -ms-1 flex items-center gap-2 min-h-[44px] pe-2 min-w-0"
                    >
                      <BackIcon size={20} className="shrink-0 text-gray-500 rtl:rotate-180" />
                      <img
                        className="w-[44px] h-[25px] shrink-0 rounded object-cover ring-1 ring-black/5"
                        src={course.thumbnail_image
                          ? getCourseThumbnailMediaDirectory(org?.org_uuid, course.course_uuid, course.thumbnail_image)
                          : '/empty_thumbnail.png'}
                        onError={(e) => {
                          if (!e.currentTarget.src.endsWith('/empty_thumbnail.png')) e.currentTarget.src = '/empty_thumbnail.png'
                        }}
                        alt=""
                      />
                      <span className="truncate text-sm font-semibold text-gray-700">{course.name}</span>
                    </Link>
                    <div className="hidden sm:block pt-2 pb-6">
                      <Breadcrumbs items={[
                        { label: t('courses.courses'), href: getUriWithOrg(orgslug, '/courses'), icon: <BookCopy size={14} /> },
                        { label: course.name, href: getUriWithOrg(orgslug, `/course/${courseuuid}`) },
                        { label: displayName }
                      ]} />
                    </div>
                    <div className="space-y-3 sm:space-y-4 activity-info-section relative" style={{ zIndex: 'var(--z-content)' }}>
                        <div className="hidden sm:flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
                          <div className="flex space-x-4 sm:space-x-6 items-center">
                            <div className="flex shrink-0">
                              <Link
                                href={getUriWithOrg(orgslug, '') + `/course/${courseuuid}`}
                              >
                                <img
                                  className="w-[60px] h-[34px] sm:w-[100px] sm:h-[57px] shrink-0 rounded-md drop-shadow-md object-cover"
                                  src={course.thumbnail_image
                                    ? getCourseThumbnailMediaDirectory(
                                        org?.org_uuid,
                                        course.course_uuid,
                                        course.thumbnail_image
                                      )
                                    : '/empty_thumbnail.png'
                                  }
                                  onError={(e) => {
                                    if (!e.currentTarget.src.endsWith('/empty_thumbnail.png')) e.currentTarget.src = '/empty_thumbnail.png'
                                  }}
                                  alt=""
                                />
                              </Link>
                            </div>
                            <div className="flex flex-col -space-y-1">
                              <p className="font-bold text-gray-700 text-xs sm:text-md">{t('search.course')} </p>
                              <h1 className="font-bold text-gray-950 text-lg sm:text-3xl">
                                {course.name}
                              </h1>
                            </div>
                          </div>
                          {activity && (
                            <div className="hidden sm:block">
                              <ActivityShareDropdown
                                activityName={activity.name}
                                activityUrl={typeof window !== 'undefined' ? window.location.href : ''}
                                orgslug={orgslug}
                                courseUuid={course.course_uuid}
                                activityId={activity.activity_uuid ? activity.activity_uuid.replace('activity_', '') : activityid.replace('activity_', '')}
                                activityType={activity.activity_type}
                              />
                            </div>
                          )}
                        </div>

                        <ActivityIndicators
                          course_uuid={courseuuid}
                          current_activity={activityid}
                          orgslug={orgslug}
                          course={course}
                          enableNavigation={true}
                          trailData={trailData}
                        />

                        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center w-full gap-3">
                          <div className="flex flex-1 items-center space-x-3 min-w-0">
                            <div className="flex flex-col -space-y-1 min-w-0">
                              <p className="font-bold text-gray-700 text-xs sm:text-md max-sm:font-semibold max-sm:text-gray-500 max-sm:text-[11px] max-sm:uppercase max-sm:tracking-wide">
                                {getChapterNameByActivityId(course, activity?.id) ?? chapterNameFromCourse}
                              </p>
                              <h1 className="font-bold text-gray-950 text-base sm:text-2xl max-sm:text-[22px] max-sm:leading-tight max-sm:pt-1">
                                {displayName}
                              </h1>
                              {/* Authors and Dates Section */}
                              <div className="flex flex-wrap items-center gap-3 mt-2">
                                {/* Avatars */}
                                {course.authors && course.authors.length > 0 && (
                                  <div className="flex -space-x-3">
                                    {course.authors.filter((a: any) => a.authorship_status === 'ACTIVE').slice(0, 3).map((author: any, idx: number) => (
                                      <div key={author.user.user_uuid} className="relative" style={{ zIndex: 10 - idx }}>
                                        <UserAvatar
                                          border="border-2"
                                          rounded="rounded-full"
                                          avatar_url={author.user.avatar_image ? getUserAvatarMediaDirectory(author.user.user_uuid, author.user.avatar_image) : ''}
                                          predefined_avatar={author.user.avatar_image ? undefined : 'empty'}
                                          width={26}
                                          showProfilePopup={true}
                                          userId={author.user.id}
                                        />
                                      </div>
                                    ))}
                                    {course.authors.filter((a: any) => a.authorship_status === 'ACTIVE').length > 3 && (
                                      <div className="flex items-center justify-center bg-neutral-100 text-neutral-600 font-medium rounded-full border-2 border-white shadow-sm w-9 h-9 text-xs z-0">
                                        +{course.authors.filter((a: any) => a.authorship_status === 'ACTIVE').length - 3}
                                      </div>
                                    )}
                                  </div>
                                )}
                                {/* Author names */}
                                {course.authors && course.authors.length > 0 && (
                                  <div className="text-xs text-gray-700 font-medium flex items-center gap-1">
                                    {course.authors.filter((a: any) => a.authorship_status === 'ACTIVE').length > 1 && (
                                      <span>{t('courses.co_created_by')} </span>
                                    )}
                                    {course.authors.filter((a: any) => a.authorship_status === 'ACTIVE').slice(0, 2).map((author: any, idx: number, arr: any[]) => (
                                      <span key={author.user.user_uuid}>
                                        {author.user.first_name && author.user.last_name
                                          ? `${author.user.first_name} ${author.user.last_name}`
                                          : `@${author.user.username}`}
                                        {idx === 0 && arr.length > 1 ? ' & ' : ''}
                                      </span>
                                    ))}
                                    {course.authors.filter((a: any) => a.authorship_status === 'ACTIVE').length > 2 && (
                                      <ToolTip
                                        content={
                                          <div className="p-2">
                                            {course.authors
                                              .filter((a: any) => a.authorship_status === 'ACTIVE')
                                              .slice(2)
                                              .map((author: any) => (
                                                <div key={author.user.user_uuid} className="text-white text-sm py-1">
                                                  {author.user.first_name && author.user.last_name
                                                    ? `${author.user.first_name} ${author.user.last_name}`
                                                    : `@${author.user.username}`}
                                                </div>
                                              ))}
                                          </div>
                                        }
                                      >
                                        <div className="bg-gray-100 hover:bg-gray-200 text-gray-600 px-2 py-0.5 rounded-md cursor-pointer text-xs font-medium transition-colors duration-200">
                                          +{course.authors.filter((a: any) => a.authorship_status === 'ACTIVE').length - 2}
                                        </div>
                                      </ToolTip>
                                    )}
                                  </div>
                                )}
                                {/* Dates */}
                                <div className="hidden sm:flex flex-wrap items-center text-xs text-gray-500 gap-1 sm:gap-2">
                                  <span>
                                    {t('courses.created_on')} {formatDate(course.creation_date, i18n.language, { dateStyle: undefined, year: 'numeric', month: 'long', day: 'numeric' })}
                                  </span>
                                  <span className="mx-1">•</span>
                                  <span>
                                    {t('courses.last_updated')} {getRelativeTime(new Date(course.update_date || course.creation_date))}
                                  </span>
                                </div>
                              </div>
                            </div>
                          </div>
                          <div className="hidden sm:flex space-x-2 items-center relative shrink-0" style={{ zIndex: 'var(--z-interactive)' }}>
                            {activity && activity.published == true && activity.content.paid_access != false && (
                              <AuthenticatedClientElement checkMethod="authentication">
                                {activity.activity_type != 'TYPE_ASSIGNMENT' && (
                                  <>
                                    <AIActivityAsk activity={activity} />
                                    <ActivityChapterDropdown
                                      course={course}
                                      currentActivityId={activity.activity_uuid ? activity.activity_uuid.replace('activity_', '') : activityid.replace('activity_', '')}
                                      orgslug={orgslug}
                                      trailData={trailData}
                                    />
                                    {contributorStatus === 'ACTIVE' && activity.activity_type == 'TYPE_DYNAMIC' && (
                                      <Link
                                        href={getUriWithOrg(orgslug, '') + `/course/${courseuuid}/activity/${activityid}/edit`}
                                        className="bg-emerald-600 rounded-full px-5 drop-shadow-md flex items-center space-x-2 p-2.5 text-white hover:cursor-pointer transition delay-150 duration-300 ease-in-out"
                                      >
                                        <Edit2 size={17} />
                                        <span className="text-xs font-bold">{t('courses.contribute')}</span>
                                      </Link>
                                    )}
                                  </>
                                )}
                              </AuthenticatedClientElement>
                            )}
                          </div>
                        </div>
                      </div>

                      {activityLoading || !activity ? (
                        <ActivityContentSkeleton activityType={displayActivityType} />
                      ) : activity.published == false ? (
                        <div className="p-7 rounded-lg bg-gray-800">
                          <div className="text-white">
                            <h1 className="font-bold text-2xl">
                              {t('activities.not_published_yet')}
                            </h1>
                          </div>
                        </div>
                      ) : activity.published == true ? (
                        <>
                          {activity.content.paid_access == false ? (
                            <PaidCourseActivityDisclaimer course={course} activity={activity} />
                          ) : (
                            // Video activities sit on a dark theater band (theater.css).
                            <div className={activity.activity_type === 'TYPE_VIDEO' ? 'lh-theater-band py-8 sm:py-12' : ''}>
                            {activity.activity_type === 'TYPE_VIDEO' && (
                              <button
                                onClick={() => setIsFocusMode(true)}
                                className="absolute top-0 end-0 -translate-y-1/2 hidden sm:flex bg-white nice-shadow p-2 rounded-full cursor-pointer transition-all duration-200 group overflow-hidden"
                                style={{ zIndex: 'var(--z-interactive)' }}
                                title={t('activities.focus_mode')}
                              >
                                <div className="flex items-center">
                                  <Maximize2 size={16} className="text-gray-700" />
                                  <span className="text-xs font-bold text-gray-700 opacity-0 group-hover:opacity-100 transition-all duration-200 w-0 group-hover:w-auto group-hover:ms-2 whitespace-nowrap">
                                    {t('activities.focus_mode')}
                                  </span>
                                </div>
                              </button>
                            )}
                            <div className="flex gap-6">
                              <div className={`flex-1 min-w-0 ${activity.activity_type === 'TYPE_SCORM' ? 'rounded-xl overflow-hidden' : activity.activity_type === 'TYPE_VIDEO' ? 'max-sm:-mx-4' : activity.activity_type === 'TYPE_LIVE_SESSION' ? '' : activity.activity_type === 'TYPE_ASSIGNMENT' ? 'pt-2 sm:pt-0' : activity.activity_type === 'TYPE_DYNAMIC' ? '-mx-4 sm:mx-0 px-4 py-5 sm:p-7 rounded-none sm:rounded-lg max-sm:shadow-none max-sm:outline-none max-sm:border-y max-sm:border-black/[0.05]' : activity.activity_type === 'TYPE_DOCUMENT' ? '-mx-4 sm:mx-0 px-3 py-4 sm:p-7 rounded-none sm:rounded-lg max-sm:bg-neutral-100! max-sm:shadow-none max-sm:outline-none' : 'p-3 sm:p-7 rounded-lg'} ${bgColor} relative isolate`} style={{ zIndex: 'var(--z-base)' }}>
                                {activity.activity_type !== 'TYPE_VIDEO' && (
                                <button
                                  onClick={() => setIsFocusMode(true)}
                                  className={`absolute ${activity.activity_type === 'TYPE_SCORM' ? 'top-2 end-2' : activity.activity_type === 'TYPE_ASSIGNMENT' ? '-top-5 -end-3' : 'top-4 end-4'} hidden sm:flex bg-white/80 hover:bg-white nice-shadow p-2 rounded-full cursor-pointer transition-all duration-200 group overflow-hidden pointer-events-auto`}
                                  style={{ zIndex: 'var(--z-interactive)' }}
                                  title={t('activities.focus_mode')}
                                >
                                  <div className="flex items-center">
                                    <Maximize2 size={16} className="text-gray-700" />
                                    <span className="text-xs font-bold text-gray-700 opacity-0 group-hover:opacity-100 transition-all duration-200 w-0 group-hover:w-auto group-hover:ms-2 whitespace-nowrap">
                                      {t('activities.focus_mode')}
                                    </span>
                                  </div>
                                </button>
                                )}
                                {activityContent}
                              </div>
                              <Suspense fallback={null}>
                                <AISidePanelInline activity={activity} />
                              </Suspense>
                            </div>
                            </div>
                          )}
                        </>
                      ) : null}

                      {/* Activity Actions below the content box. Phones get the
                          bottom bar instead; only one is mounted so the actions
                          (and an assignment's submit / grade dialogs) exist once. */}
                      {!isPhone && activity && activity.published == true && activity.content.paid_access != false && (
                        <div className="flex flex-row justify-between items-center mt-4 w-full">
                          <div className="order-1 sm:order-none">
                            <PreviousActivityButton
                              course={course}
                              currentActivityId={activity.id}
                              orgslug={orgslug}
                              dark={activity.activity_type === 'TYPE_VIDEO'}
                            />
                          </div>
                          <div className="flex items-center justify-between sm:justify-end space-x-2 order-2 sm:order-none">
                            <ActivityActions
                              activity={activity}
                              activityid={activityid}
                              course={course}
                              orgslug={orgslug}
                              assignment={assignment}
                              showNavigation={false}
                              trailData={trailData}
                              dark={activity.activity_type === 'TYPE_VIDEO'}
                            />
                            <NextActivityButton
                              course={course}
                              currentActivityId={activity.id}
                              orgslug={orgslug}
                              dark={activity.activity_type === 'TYPE_VIDEO'}
                            />
                          </div>
                        </div>
                      )}

                      {/* Fixed Activity Secondary Bar */}
                      {activity && activity.published == true && activity.content.paid_access != false && (
                        <FixedActivitySecondaryBar
                          course={course}
                          currentActivityId={activityid}
                          orgslug={orgslug}
                          activity={activity}
                          dark={activity.activity_type === 'TYPE_VIDEO'}
                        />
                      )}

                      {/* Phones: prev / outline / action / next within thumb reach. */}
                      {isPhone && activity && activity.published == true && activity.content.paid_access != false && (
                        <MobileActivityBar
                          course={course}
                          currentActivityId={activityid}
                          orgslug={orgslug}
                          trailData={trailData}
                          dark={activity.activity_type === 'TYPE_VIDEO'}
                        >
                          <ActivityActions
                            activity={activity}
                            activityid={activityid}
                            course={course}
                            orgslug={orgslug}
                            assignment={assignment}
                            showNavigation={false}
                            trailData={trailData}
                            dark={activity.activity_type === 'TYPE_VIDEO'}
                            compact
                          />
                        </MobileActivityBar>
                      )}

                      <div className="h-6 sm:h-[100px]"></div>
                    </div>
                )}
              </GeneralWrapperStyled>
            )}
              </AISidePanelContentWrapper>
            </Suspense>
          </AIChatBotProvider>
        </Suspense>
        </AssignmentDirtyTasksProvider>
      </CourseProvider>
    </>
  )
}

export function MarkStatus(props: {
  activity: any
  activityid: string
  course: any
  orgslug: string,
  trailData: any
  dark?: boolean
  /** Single-line pill for the phone activity bar; no first-run tooltips. */
  compact?: boolean
}) {
  const { t } = useTranslation()
  const router = useRouter()
  const session = useLHSession() as any;
  const org = useOrg() as any;
  const { isUserPartOfTheOrg } = useOrgMembership();
  const queryClient = useQueryClient();
  const { track } = useLHAnalytics('learner');
  const _isMobile = useMediaQuery('(max-width: 768px)')
  const [isLoading, setIsLoading] = React.useState(false);
  const [showMarkedTooltip, setShowMarkedTooltip] = React.useState(false);
  const [showUnmarkedTooltip, setShowUnmarkedTooltip] = React.useState(false);


  React.useEffect(() => {
    if (typeof window !== 'undefined') {
      const markedTooltipCount = localStorage.getItem('activity_marked_tooltip_count');
      const unmarkedTooltipCount = localStorage.getItem('activity_unmarked_tooltip_count');
      
      if (!markedTooltipCount || parseInt(markedTooltipCount) < 3) {
        setShowMarkedTooltip(true);
      }
      if (!unmarkedTooltipCount || parseInt(unmarkedTooltipCount) < 3) {
        setShowUnmarkedTooltip(true);
      }
    }
  }, []);

  const handleMarkedTooltipClose = () => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('activity_marked_tooltip_count', '3');
      setShowMarkedTooltip(false);
    }
  };

  const handleUnmarkedTooltipClose = () => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('activity_unmarked_tooltip_count', '3');
      setShowUnmarkedTooltip(false);
    }
  };

  const infoIcon = (
    <svg 
      viewBox="0 0 24 24" 
      fill="none" 
      stroke="currentColor" 
      strokeWidth="2" 
      strokeLinecap="round" 
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </svg>
  );

  const areAllActivitiesCompleted = () => {
    const run = props.trailData?.runs?.find(
      (run: any) => run.course_uuid === props.course.course_uuid
    );
    if (!run) return false;

    let totalActivities = 0;
    let completedActivities = 0;

    props.course.chapters.forEach((chapter: any) => {
      chapter.activities.forEach((activity: any) => {
        totalActivities++;
        const isCompleted = run.steps.find(
          (step: any) => step.activity_uuid === activity.activity_uuid && step.complete === true
        );
        if (isCompleted) {
          completedActivities++;
        }
      });
    });

    return completedActivities >= totalActivities - 1;
  };

  const findNextActivity = () => {
    const flat: any[] = [];
    let currentIndex = -1;
    props.course?.chapters?.forEach((chapter: any) => {
      chapter.activities?.forEach((activity: any) => {
        flat.push(activity);
        if (activity.id === props.activity?.id) {
          currentIndex = flat.length - 1;
        }
      });
    });
    return currentIndex >= 0 && currentIndex < flat.length - 1 ? flat[currentIndex + 1] : null;
  };

  // Completing an activity moves the learner to the next one, so warm its data
  // and route now; the navigation then renders from cache.
  const nextActivityUuid = findNextActivity()?.activity_uuid?.replace('activity_', '');
  const accessToken = session.data?.tokens?.access_token;
  useEffect(() => {
    if (!isUserPartOfTheOrg || !nextActivityUuid) return;
    const cleanCourseUuid = props.course.course_uuid.replace('course_', '');
    router.prefetch(getUriWithOrg(props.orgslug, '') + `/course/${cleanCourseUuid}/activity/${nextActivityUuid}`);
    queryClient.prefetchQuery(activityQueryOptions(nextActivityUuid, accessToken));
  }, [isUserPartOfTheOrg, nextActivityUuid, accessToken, props.course.course_uuid, props.orgslug, queryClient, router]);

  async function markActivityAsCompleteFront() {
    const trailKey = queryKeys.trail.org(org?.id);
    // A refetch already in flight would land after the optimistic write below
    // and briefly undo it.
    await queryClient.cancelQueries({ queryKey: trailKey });
    const previousTrail = queryClient.getQueryData(trailKey);
    try {
      const willCompleteAll = areAllActivitiesCompleted();
      const nextActivity = findNextActivity();
      const cleanCourseUuid = props.course.course_uuid.replace('course_', '');
      setIsLoading(true);

      // Show the activity as done right away; the server's trail replaces this
      // once the request settles.
      queryClient.setQueryData(trailKey, (trail: any) => trail && {
        ...trail,
        runs: trail.runs?.map((run: any) =>
          run.course?.course_uuid?.replace('course_', '') === cleanCourseUuid
            ? { ...run, steps: [...(run.steps || []), { activity_id: props.activity.id, course_id: run.course_id, complete: true }] }
            : run
        ),
      });

      const request = markActivityAsComplete(
        props.orgslug,
        props.course.course_uuid,
        props.activity.activity_uuid,
        session.data?.tokens?.access_token
      ).then((trail: any) => {
        // The response is the updated trail, so no refetch is needed.
        if (trail?.runs) queryClient.setQueryData(trailKey, trail);
      });

      // The end page shows the certificate, which the request creates, so only
      // that navigation waits for it. Moving on to the next activity does not.
      if (willCompleteAll || !nextActivity) {
        await request;
      } else {
        request.catch(() => {
          queryClient.setQueryData(trailKey, previousTrail);
          toast.error(t('activities.failed_mark_complete'));
        });
      }

      track(AnalyticsEvent.ActivityMarkedComplete, {
        activity_uuid: props.activity.activity_uuid,
        course_uuid: props.course.course_uuid,
        activity_type: props.activity.activity_type,
        will_complete_course: willCompleteAll,
        has_next_activity: !!nextActivity,
      });
      // North-star terminal event: the learner just finished the whole course.
      if (willCompleteAll) {
        track(AnalyticsEvent.CourseCompleted, {
          course_uuid: props.course.course_uuid,
        });
      }

      if (willCompleteAll || !nextActivity) {
        router.push(getUriWithOrg(props.orgslug, '') + `/course/${cleanCourseUuid}/activity/end`);
      } else {
        const nextUuid = nextActivity.activity_uuid?.replace('activity_', '');
        router.push(getUriWithOrg(props.orgslug, '') + `/course/${cleanCourseUuid}/activity/${nextUuid}`);
      }
    } catch (error) {
      console.error('Error marking activity as complete:', error);
      queryClient.setQueryData(trailKey, previousTrail);
      toast.error(t('activities.failed_mark_complete'));
    } finally {
      setIsLoading(false);
    }
  }

  async function unmarkActivityAsCompleteFront() {
    try {
      setIsLoading(true);
      
      const trail = await unmarkActivityAsComplete(
        props.orgslug,
        props.course.course_uuid,
        props.activity.activity_uuid,
        session.data?.tokens?.access_token
      );

      // The response is the updated trail, and course metadata carries no
      // progress, so neither needs a refetch.
      if (trail?.runs) {
        queryClient.setQueryData(queryKeys.trail.org(org?.id), trail);
      } else {
        await queryClient.invalidateQueries({ queryKey: queryKeys.trail.org(org?.id) });
      }
    } catch (_error) {
      toast.error(t('activities.failed_unmark_complete'));
    } finally {
      setIsLoading(false);
    }
  }

  const isActivityCompleted = () => {
    // Clean up course UUID by removing 'course_' prefix if it exists
    const cleanCourseUuid = props.course.course_uuid?.replace('course_', '');
    
    let run = props.trailData?.runs?.find(
      (run: any) => {
        const cleanRunCourseUuid = run.course?.course_uuid?.replace('course_', '');
        return cleanRunCourseUuid === cleanCourseUuid;
      }
    );

    if (run) {
      // Find the step that matches the current activity
      return run.steps.find(
        (step: any) => step.activity_id === props.activity.id && step.complete === true
      );
    }
    return false;
  }

  const completed = !!props.trailData && !!isActivityCompleted()
  // Unmarking stays behind its confirmation dialog, so `m` only ever marks.
  useShortcut(
    { id: 'activity.complete', keys: 'm', label: t('shortcuts.mark_complete'), group: 'page',
      run: () => { if (!isLoading) markActivityAsCompleteFront() } },
    !!props.trailData && isUserPartOfTheOrg && !completed,
  )

  // Don't render until we have trail data
  if (!props.trailData) {
    return null;
  }

  // Don't show progress tracking for non-members
  if (!isUserPartOfTheOrg) {
    return null;
  }

  if (props.compact) {
    const done = !!isActivityCompleted()
    const pill = 'lh-press flex h-11 items-center gap-2 rounded-full px-4 text-sm font-semibold whitespace-nowrap transition-colors'
    return done ? (
      <ConfirmationModal
        confirmationButtonText={t('activities.unmark_activity')}
        confirmationMessage={t('activities.unmark_activity_confirm')}
        dialogTitle={t('activities.unmark_activity_title')}
        dialogTrigger={
          <button
            type="button"
            className={`${pill} ${props.dark ? 'bg-teal-400/15 text-teal-300' : 'bg-teal-50 text-teal-700 ring-1 ring-inset ring-teal-200'}`}
          >
            <CheckCircle size={18} />
            {t('common.completed')}
          </button>
        }
        functionToExecute={unmarkActivityAsCompleteFront}
        status="warning"
      />
    ) : (
      <button
        type="button"
        onClick={!isLoading ? markActivityAsCompleteFront : undefined}
        disabled={isLoading}
        className={`${pill} bg-teal-600 text-white shadow-sm shadow-teal-900/20 ${isLoading ? 'opacity-80' : ''}`}
      >
        {isLoading ? <Loader2 size={18} className="animate-spin" /> : <Circle size={18} />}
        {isLoading ? t('activities.marking') : t('common.complete')}
      </button>
    )
  }

  return (
    <>
      {isActivityCompleted() ? (
        <div className="flex items-center space-x-2">
          <div className="relative">
            <ConfirmationModal
              confirmationButtonText={t('activities.unmark_activity')}
              confirmationMessage={t('activities.unmark_activity_confirm')}
              dialogTitle={t('activities.unmark_activity_title')}
              dialogTrigger={
                <div className="bg-teal-600 rounded-md px-4 nice-shadow flex flex-col p-2.5 text-white hover:cursor-pointer transition delay-150 duration-300 ease-in-out">
                  <span className="text-[10px] font-bold mb-1 uppercase">{t('common.status')}</span>
                  <div className="flex items-center space-x-2">
                    <svg 
                      width="17" 
                      height="17" 
                      viewBox="0 0 24 24" 
                      fill="none" 
                      stroke="currentColor" 
                      strokeWidth="2" 
                      strokeLinecap="round" 
                      strokeLinejoin="round"
                    >
                      <rect x="3" y="3" width="18" height="18" rx="2" />
                      <path d="M7 12l3 3 7-7" />
                    </svg>
                    <span className="text-xs font-bold">{t('common.complete')}</span>
                  </div>
                </div>
              }
              functionToExecute={unmarkActivityAsCompleteFront}
              status="warning"
            />
            {showMarkedTooltip && (
              <MiniInfoTooltip
                icon={infoIcon}
                message={t('activities.unmark_tooltip')}
                onClose={handleMarkedTooltipClose}
                iconColor="text-teal-600"
                iconSize={24}
                width="w-64"
              />
            )}
          </div>
        </div>
      ) : (
        <div className="flex items-center space-x-2">
          <div className="relative">
            <div
              className={`${isLoading ? 'opacity-90' : ''} rounded-md px-4 flex flex-col p-2.5 text-white hover:cursor-pointer transition-all duration-200 ${props.dark ? 'bg-white/10 ring-1 ring-white/10' : 'bg-gray-800 nice-shadow'} ${isLoading ? 'cursor-not-allowed' : props.dark ? 'hover:bg-white/15' : 'hover:bg-gray-700'}`}
              onClick={!isLoading ? markActivityAsCompleteFront : undefined}
            >
              <span className="text-[10px] font-bold mb-1 uppercase">{t('common.status')}</span>
              <div className="flex items-center space-x-2">
                {isLoading ? (
                  <div className="animate-spin">
                    <svg 
                      width="17" 
                      height="17" 
                      viewBox="0 0 24 24" 
                      fill="none" 
                      stroke="currentColor" 
                      strokeWidth="2" 
                      strokeLinecap="round" 
                      strokeLinejoin="round"
                    >
                      <path d="M21 12a9 9 0 11-6.219-8.56" />
                    </svg>
                  </div>
                ) : (
                  <svg 
                    width="17" 
                    height="17" 
                    viewBox="0 0 24 24" 
                    fill="none" 
                    stroke="currentColor" 
                    strokeWidth="2" 
                    strokeLinecap="round" 
                    strokeLinejoin="round"
                  >
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                  </svg>
                )}
                <span className="text-xs font-bold min-w-[90px]">{isLoading ? t('activities.marking') : t('activities.mark_as_complete')}</span>
                <Keys keys="m" tone="onDark" className="hidden sm:inline-flex" />
              </div>
            </div>
            {showUnmarkedTooltip && (
              <MiniInfoTooltip
                icon={infoIcon}
                message={t('activities.mark_tooltip')}
                onClose={handleUnmarkedTooltipClose}
                iconColor="text-gray-600"
                iconSize={24}
                width="w-64"
              />
            )}
          </div>
        </div>
      )}
    </>
  )
}

function NextActivityButton({ course, currentActivityId, orgslug, dark = false }: { course: any, currentActivityId: string, orgslug: string, dark?: boolean }) {
  const { t } = useTranslation();
  const router = useRouter();
  const _isMobile = useMediaQuery('(max-width: 768px)');

  const findNextActivity = () => {
    let allActivities: any[] = [];
    let currentIndex = -1;

    // Flatten all activities from all chapters
    course.chapters.forEach((chapter: any) => {
      chapter.activities.forEach((activity: any) => {
        const cleanActivityUuid = activity.activity_uuid?.replace('activity_', '');
        allActivities.push({
          ...activity,
          cleanUuid: cleanActivityUuid,
          chapterName: chapter.name
        });

        // Check if this is the current activity
        if (activity.id === currentActivityId) {
          currentIndex = allActivities.length - 1;
        }
      });
    });

    // Get next activity
    return currentIndex < allActivities.length - 1 ? allActivities[currentIndex + 1] : null;
  };

  const nextActivity = findNextActivity();

  // On the LAST activity, Next advances to the course-end screen (which holds
  // the certificate) instead of disappearing. Previously the only route there
  // was the trophy icon on the progress bar, which learners did not find, and
  // it was unreachable altogether for anyone who had already marked the final
  // activity complete on an earlier visit.
  const isLastActivity = !nextActivity;
  const cleanCourseUuid = course.course_uuid?.replace('course_', '');

  const navigateToActivity = () => {
    router.push(
      isLastActivity
        ? getUriWithOrg(orgslug, '') + `/course/${cleanCourseUuid}/activity/end`
        : getUriWithOrg(orgslug, '') + `/course/${cleanCourseUuid}/activity/${nextActivity.cleanUuid}`
    );
  };

  return (
    <div
      onClick={navigateToActivity}
      className={`rounded-md px-3 sm:px-4 flex flex-col p-2 sm:p-2.5 hover:cursor-pointer transition delay-150 duration-300 ease-in-out ${
        dark
          ? 'bg-white/10 text-white ring-1 ring-white/10 hover:bg-white/15'
          : 'bg-gray-200 shadow-[inset_0_2px_4px_rgba(0,0,0,0.05)] text-gray-600 hover:bg-gray-200'
      }`}
    >
      <span className={`text-[10px] font-bold mb-1 uppercase ${dark ? 'text-white/50' : 'text-gray-500'}`}>{t('common.next')}</span>
      <div className="flex items-center space-x-1">
        <span className="text-xs sm:text-sm font-semibold truncate max-w-[120px] sm:max-w-[200px]">
          {isLastActivity ? t('course.finish_course', 'Finish course') : nextActivity.name}
        </span>
        <ChevronRight size={17} className="shrink-0" />
      </div>
    </div>
  );
}

function PreviousActivityButton({ course, currentActivityId, orgslug, dark = false }: { course: any, currentActivityId: string, orgslug: string, dark?: boolean }) {
  const { t } = useTranslation();
  const router = useRouter();
  const _isMobile = useMediaQuery('(max-width: 768px)');

  const findPreviousActivity = () => {
    let allActivities: any[] = [];
    let currentIndex = -1;

    // Flatten all activities from all chapters
    course.chapters.forEach((chapter: any) => {
      chapter.activities.forEach((activity: any) => {
        const cleanActivityUuid = activity.activity_uuid?.replace('activity_', '');
        allActivities.push({
          ...activity,
          cleanUuid: cleanActivityUuid,
          chapterName: chapter.name
        });

        // Check if this is the current activity
        if (activity.id === currentActivityId) {
          currentIndex = allActivities.length - 1;
        }
      });
    });

    // Get previous activity
    return currentIndex > 0 ? allActivities[currentIndex - 1] : null;
  };

  const previousActivity = findPreviousActivity();

  if (!previousActivity) return null;

  const navigateToActivity = () => {
    const cleanCourseUuid = course.course_uuid?.replace('course_', '');
    router.push(getUriWithOrg(orgslug, '') + `/course/${cleanCourseUuid}/activity/${previousActivity.cleanUuid}`);
  };

  return (
    <div
      onClick={navigateToActivity}
      className={`rounded-md px-3 sm:px-4 flex flex-col p-2 sm:p-2.5 hover:cursor-pointer transition delay-150 duration-300 ease-in-out ${
        dark ? 'bg-white/5 text-white/85 ring-1 ring-white/10 hover:bg-white/10' : 'bg-white nice-shadow text-gray-600'
      }`}
    >
      <span className={`text-[10px] font-bold mb-1 uppercase ${dark ? 'text-white/50' : 'text-gray-500'}`}>{t('common.previous')}</span>
      <div className="flex items-center space-x-1">
        <ChevronLeft size={17} className="shrink-0" />
        <span className="text-xs sm:text-sm font-semibold truncate max-w-[120px] sm:max-w-[200px]">{previousActivity.name}</span>
      </div>
    </div>
  );
}

export default ActivityClient
