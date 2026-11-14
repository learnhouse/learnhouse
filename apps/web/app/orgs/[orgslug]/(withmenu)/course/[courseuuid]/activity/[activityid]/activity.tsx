'use client'
import Link from 'next/link'
import { getUriWithOrg } from '@services/config/config'
import { BookOpenCheck, CheckCircle, Circle, ChevronRight, MessageSquare, UserRoundPen, Loader2, Trophy, Sparkles, XCircle, Lock, RotateCcw, Infinity as InfinityIcon } from 'lucide-react'
import { AIChip } from '@components/Objects/AI/AIBrand'
import DripGate from '@components/Objects/Courses/DripGate'
import dynamic from 'next/dynamic'
import { markActivityAsComplete, unmarkActivityAsComplete } from '@services/courses/activity'
import { usePathname, useRouter } from 'next/navigation'
import AuthenticatedClientElement from '@components/Security/AuthenticatedClientElement'
import { getActivityHlsThumbnailsUrl, getCourseThumbnailMediaDirectory, getUserAvatarMediaDirectory } from '@services/media/media'
import './theater.css'
import { useOrg, useOrgMembership } from '@components/Contexts/OrgContext'
import { CourseProvider } from '@components/Contexts/CourseContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useShortcut } from '@/lib/shortcuts/ShortcutsContext'
import { Keys } from '@components/Objects/Shortcuts/Kbd'
import React, { useEffect, useRef, useMemo, lazy, Suspense } from 'react'
import { flushSync, preconnect } from 'react-dom'
import { getAssignmentFromActivityUUID, getFinalGrade, retryAssignmentSubmission, submitAssignmentForGrading } from '@services/courses/assignments'
import { AssignmentProvider } from '@components/Contexts/Assignments/AssignmentContext'
import { AssignmentsTaskProvider } from '@components/Contexts/Assignments/AssignmentsTaskContext'
import AssignmentSubmissionProvider, { useAssignmentSubmission } from '@components/Contexts/Assignments/AssignmentSubmissionContext'
import { AssignmentDirtyTasksProvider, useAssignmentDirtyTasks } from '@components/Contexts/Assignments/AssignmentDirtyTasksContext'
import toast from 'react-hot-toast'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { useTrail } from '@/hooks/queries/useTrail'
import { useCourseMeta } from '@/hooks/queries/useCourses'
import { activityQueryOptions, useActivity } from '@/hooks/queries/useActivity'
import { useContentLanguage } from '@/hooks/useContentLanguage'
import { ContentLanguageSwitcher, TranslationFallbackNotice, contentLangProps } from '@components/Objects/Courses/ContentLanguage/ContentLanguage'
import { courseDefaultLocale, servedLocale, showsTranslationFallback } from '@/lib/contentLanguage'
import { prefetchRouteFull } from '@/lib/navigation/prefetchRoute'
import CourseAccessError from '@components/Objects/Courses/CourseAccessError/CourseAccessError'
import ConfirmationModal from '@components/Objects/StyledElements/ConfirmationModal/ConfirmationModal'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import { useMediaQuery, useWindowSize } from 'usehooks-ts'
import PaidCourseActivityDisclaimer from '@ee/components/Payments/PaidCourseActivityDisclaimer'
import { useContributorStatus } from '../../../../../../../../hooks/useContributorStatus'
import ToolTip from '@components/Objects/StyledElements/Tooltip/Tooltip'
import ActivityChapterDropdown from '@components/Pages/Activity/ActivityChapterDropdown'
import ActivityShareDropdown from '@components/Pages/Activity/ActivityShareDropdown'
import FixedActivitySecondaryBar from '@components/Pages/Activity/FixedActivitySecondaryBar'
import { ActivityNavBar, NavDivider, NavProgressHint, NavStepButton, navControlClass } from '@components/Pages/Activity/ActivityNavBar'
import { ASSIGNMENT_SUBMIT_EVENT } from '@components/Objects/Activities/Assignment/assignmentUI'
import MobileActivityBar from '@components/Pages/Activity/MobileActivityBar'
import CourseEndView from '@components/Pages/Activity/CourseEndView'
import { Breadcrumbs } from '@components/Objects/Breadcrumbs/Breadcrumbs'
import { BookCopy, ChevronLeft as BackIcon } from 'lucide-react'
import { ArrowsOut, CheckCircle as PhCheckCircle, CircleNotch, PencilSimple } from '@phosphor-icons/react'
import { readFocusPref, useFocusPref, writeFocusPref } from '@components/Pages/Activity/focusModePref'
import CompanyContextChip from '@ee/components/Companies/CompanyContextChip'
import { FocusTopBar, useChromeIdle, useFocusSwipe } from './FocusChrome'
import { buttonClass } from '@components/Dashboard/Shared/DashKit/DashKit'
import GeneralWrapperStyled from '@components/Objects/StyledElements/Wrappers/GeneralWrapper'
import ActivityIndicators from '@components/Pages/Courses/ActivityIndicators'
import UserAvatar from '@components/Objects/UserAvatar'
import { useTranslation } from 'react-i18next'
import { useDirection } from '@hooks/useDirection'
import { formatDate } from '@/lib/format'
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics'
import NotesButton from '@components/Objects/Activities/Notes/NotesButton'
import NotesHost from '@components/Objects/Activities/Notes/NotesHost'

const ReactConfetti = dynamic(() => import('react-confetti'), { ssr: false })

// Lazy load heavy components
const Canva = lazy(() => import('@components/Objects/Activities/DynamicCanva/DynamicCanva'))
const loadVideoActivity = () => import('@components/Objects/Activities/Video/Video')
const VideoActivity = lazy(loadVideoActivity)
const DocumentPdfActivity = lazy(() => import('@components/Objects/Activities/DocumentPdf/DocumentPdf'))
const AssignmentStudentActivity = lazy(() => import('@components/Objects/Activities/Assignment/AssignmentStudentActivity'))
// Deadline rule shared with the learner activity view (and mirroring the
// server's _is_assignment_past_due) so the submit/retry affordances agree with
// what the API will actually accept. Static import: it's a pure function, and
// gating render on the lazy chunk would flash the wrong control.
import { isAssignmentPastDue } from '@components/Objects/Activities/Assignment/AssignmentStudentActivity'
import { coursePath } from '@/lib/seo/paths'
const AIActivityAsk = lazy(() => import('@components/Objects/Activities/AI/AIActivityAsk'))
const AISidePanelContentWrapper = lazy(() => import('@components/Objects/Activities/AI/AIActivityAsk').then(mod => ({ default: mod.AISidePanelContentWrapper })))
const AISidePanelInline = lazy(() => import('@components/Objects/Activities/AI/AIActivityAsk').then(mod => ({ default: mod.AISidePanelInline })))
const AIChatBotProvider = lazy(() => import('@components/Contexts/AI/AIChatBotContext'))
const ScormActivity = lazy(() => import('@ee/components/Activities/ScormActivity'))
const MarkdownActivity = lazy(() => import('@components/Objects/Activities/Markdown/MarkdownActivity'))
const EmbedActivity = lazy(() => import('@components/Objects/Activities/Embed/EmbedActivity'))
const ResourceActivity = lazy(() => import('@components/Objects/Activities/Resource/ResourceActivity'))
const LiveSessionActivity = lazy(() => import('@ee/components/LiveSessions/LiveSessionActivity'))
const PlayActivity = lazy(() => import('@ee/components/Plays/course/PlayActivity'))

// Loading fallback component
const LoadingFallback = () => (
  <div className="flex items-center justify-center h-64">
    <div className="relative w-6 h-6">
      <div className="absolute top-0 start-0 w-full h-full border-2 border-gray-100 rounded-full"></div>
      <div className="absolute top-0 start-0 w-full h-full border-2 border-gray-400 rounded-full animate-spin border-t-transparent"></div>
    </div>
  </div>
);

/**
 * The activity's box in focus mode: a theater-sized stage for video, a calm
 * centred card at a reading width for lessons, wider for documents and SCORM.
 * Phones run cards edge to edge.
 */
function focusStageClass(type?: string): string {
  const card = 'bg-white rounded-2xl nice-shadow max-sm:-mx-4 max-sm:w-auto max-sm:rounded-none max-sm:shadow-none max-sm:border-y max-sm:border-black/[0.05]'
  switch (type) {
    case 'TYPE_VIDEO':
      return 'lh-focus-stage-video max-sm:-mx-4 max-sm:w-auto'
    case 'TYPE_DOCUMENT':
      return `max-w-6xl px-3 py-4 sm:p-6 ${card}`
    case 'TYPE_SCORM':
      return `max-w-7xl overflow-hidden ${card}`
    case 'TYPE_ASSIGNMENT':
      return 'max-w-4xl'
    case 'TYPE_LIVE_SESSION':
      return 'max-w-5xl'
    case 'TYPE_PLAY':
      // The play draws its own card.
      return 'max-w-4xl'
    default:
      return `max-w-6xl px-4 py-6 sm:px-10 sm:py-10 ${card}`
  }
}

/** The player's frame while its code loads: 16:9, dark, a resting play badge. */
function VideoPlayerSkeleton() {
  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-[20px] bg-[#0d0d0e] ring-1 ring-white/[0.06] max-sm:rounded-none max-sm:ring-0">
      <div className="absolute inset-0 animate-pulse bg-gradient-to-br from-white/[0.04] via-transparent to-white/[0.03] motion-reduce:animate-none" />
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="size-16 rounded-full bg-white/[0.08] ring-1 ring-white/10 sm:size-20" />
      </div>
      <div className="absolute inset-x-4 bottom-4 h-1 rounded-full bg-white/[0.08] sm:inset-x-6 sm:bottom-6" />
    </div>
  )
}

function ActivityContentSkeleton({ activityType }: { activityType?: string }) {
  const isVideo = activityType === 'TYPE_VIDEO' || activityType === 'TYPE_SCORM'
  const isDocument = activityType === 'TYPE_DOCUMENT'

  if (activityType === 'TYPE_VIDEO') {
    // Same box as the loaded page: the dark theater band around a 16:9 player.
    return (
      <div className="lh-theater-band py-8 sm:py-12">
        <div className="max-sm:-mx-4">
          <VideoPlayerSkeleton />
        </div>
      </div>
    )
  }

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
    <div className={`lh-nav-center flex items-center gap-2 empty:hidden ${compact ? 'w-full min-w-0' : ''}`}>
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
                <AssignmentTools
                  assignment={assignment}
                  activity={activity}
                  activityid={activityid}
                  course={course}
                  orgslug={orgslug}
                  dark={dark}
                  compact={compact}
                />
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
  const { isRTL } = useDirection()
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

  // Content language (?lang=, remembered choice, UI, browser): course names
  // and the activity come in the first published translation, else the original.
  const contentLang = useContentLanguage()
  const langOpts = { lang: contentLang.lang || undefined, enabled: contentLang.ready }
  const { data: course, isLoading: courseQueryLoading, error: courseError } = useCourseMeta(courseuuid, langOpts)
  // "end" is the course-end screen, not an activity: asking the API for it
  // only ever answered 404 (useActivity skips an empty uuid).
  const { data: activity, isLoading: activityQueryLoading } = useActivity(activityid === 'end' ? '' : activityid, langOpts)
  const courseLoading = courseQueryLoading || (!contentLang.ready && !course)
  const activityLoading = activityQueryLoading || (!contentLang.ready && !activity && activityid !== 'end')
  const courseContentLang = course?.locale || course?.default_locale ? servedLocale(course) : undefined
  // lang/dir for the activity content: the language it is actually in (the
  // original when its translation isn't published). Without it, content in a
  // right-to-left interface inherits the page direction.
  const activityContentLocale = activity?.locale || (activity?.translation_fallback && course ? courseDefaultLocale(course) : courseContentLang)
  const activityContentAttrs = activityContentLocale ? contentLangProps(activityContentLocale) : {}
  const fallbackNotice = showsTranslationFallback(activity, course)
  const session = useLHSession() as any;
  const pathname = usePathname()
  const access_token = session?.data?.tokens?.access_token;
  const [bgColor, setBgColor] = React.useState('bg-white nice-shadow')
  const [assignment, setAssignment] = React.useState(null) as any;
  const [_markStatusButtonActive, setMarkStatusButtonActive] = React.useState(false);
  // Focus mode: one tree for both layouts, so toggling it restyles the page
  // around the activity instead of remounting it (a playing video keeps
  // playing). Phones keep their own preference (focusModePref.ts). The
  // course-end screen has no lesson to focus on.
  const isPhone = useMediaQuery('(max-width: 767px)');
  const focusPref = useFocusPref(isPhone);
  const isFocusMode = focusPref && activityid !== 'end';
  const setIsFocusMode = React.useCallback((next: boolean | ((_v: boolean) => boolean)) => {
    const value = typeof next === 'function' ? next(readFocusPref(isPhone)) : next
    const apply = () => writeFocusPref(isPhone, value)
    // A cross-fade between the two layouts where the browser can do it, and
    // an instant switch for reduced motion.
    const doc = document as Document & { startViewTransition?: (_cb: () => void) => unknown }
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (doc.startViewTransition && !reduce) doc.startViewTransition(() => flushSync(apply))
    else apply()
  }, [isPhone]);
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

  // Previous / next are one click (or j / k) away: warm both pages and their
  // activity data, so stepping through a course never waits on the network.
  // The activity page's payload holds no data, so a full prefetch can't go
  // stale; the activity itself goes through React Query like any other read.
  const prevUuid: string | undefined = prevActivity?.cleanUuid
  const nextUuid: string | undefined = nextActivity?.cleanUuid
  const courseCleanUuid: string | undefined = course?.course_uuid?.replace('course_', '')
  useEffect(() => {
    if (!courseCleanUuid) return
    for (const uuid of [nextUuid, prevUuid]) {
      if (!uuid) continue
      prefetchRouteFull(router, getUriWithOrg(orgslug, '') + `/course/${courseCleanUuid}/activity/${uuid}`)
      _queryClient.prefetchQuery(activityQueryOptions(uuid, access_token, contentLang.lang || undefined))
    }
  }, [courseCleanUuid, nextUuid, prevUuid, orgslug, access_token, router, _queryClient, contentLang.lang])

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
          <Suspense fallback={<VideoPlayerSkeleton />}>
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
              <AssignmentProvider assignment_uuid={assignment?.assignment_uuid} lang={contentLang.lang || undefined}>
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
      case 'TYPE_PLAY':
        return (
          <Suspense fallback={<LoadingFallback />}>
            <PlayActivity activity={activity} course={course} orgslug={orgslug} />
          </Suspense>
        );
      default:
        return null;
    }
  }, [activity, course, assignment, orgslug, contentLang.lang]);

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
      run: () => router.push(getUriWithOrg(orgslug, coursePath({ slug: course?.slug, course_uuid: courseuuid }))) },
    !!course,
  )

  // Focus mode owns the screen: the page behind it stops scrolling, and
  // leaving puts the page back where it was.
  const scrollBeforeFocus = useRef(0)
  useEffect(() => {
    if (!isFocusMode) return
    scrollBeforeFocus.current = window.scrollY
    document.documentElement.classList.add('lh-focus-open')
    return () => {
      document.documentElement.classList.remove('lh-focus-open')
      const y = scrollBeforeFocus.current
      requestAnimationFrame(() => window.scrollTo({ top: y }))
    }
  }, [isFocusMode])

  // Each lesson opens at the top of the focus view.
  const focusShellRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (isFocusMode) focusShellRef.current?.scrollTo({ top: 0 })
  }, [activityid, isFocusMode])

  // Esc leaves focus mode even while the player has keyboard focus (the
  // player keeps its other keys to itself), unless it's in fullscreen.
  useEffect(() => {
    if (!isFocusMode) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || document.fullscreenElement) return
      const target = e.target instanceof Element ? e.target : null
      if (!target?.closest('.learnhouse-player') || target.closest('[role="dialog"], [role="menu"]')) return
      setIsFocusMode(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isFocusMode, setIsFocusMode])

  const upcomingType: string | undefined = allActivities[currentIndex]?.activity_type
  const focusDark = isFocusMode && (activity?.activity_type ?? upcomingType) === 'TYPE_VIDEO'
  const chromeIdle = useChromeIdle(focusDark)
  const swipeHandlers = useFocusSwipe({
    enabled: isFocusMode,
    isRTL,
    onNext: () => navigateToActivity(nextActivity),
    onPrev: () => { if (prevActivity) navigateToActivity(prevActivity) },
  })

  // A video lesson: fetch the player's code while the activity itself loads,
  // and open the connection its media will stream from.
  useEffect(() => {
    if (upcomingType !== 'TYPE_VIDEO') return
    void loadVideoActivity()
    try {
      const origin = new URL(getActivityHlsThumbnailsUrl('o', 'c', 'a', 's'), window.location.href).origin
      if (origin !== window.location.origin) preconnect(origin, { crossOrigin: 'use-credentials' })
    } catch {
      /* malformed config: nothing to warm */
    }
  }, [upcomingType])

  // The next lesson is a video: warm its code and its storyboard (the poster
  // frame), never the video itself.
  const orgUuid: string | undefined = org?.org_uuid
  const courseUuidFull: string | undefined = course?.course_uuid
  const nextVideoSprite: string | null = useMemo(() => {
    const hls = nextActivity?.activity_type === 'TYPE_VIDEO' ? nextActivity?.extra_metadata?.hls : null
    if (!hls || hls.status !== 'ready' || !hls.thumbnails?.url || !orgUuid || !courseUuidFull) return null
    return getActivityHlsThumbnailsUrl(orgUuid, courseUuidFull, nextActivity.activity_uuid, hls.thumbnails.url)
  }, [nextActivity, orgUuid, courseUuidFull])
  const nextIsVideo = nextActivity?.activity_type === 'TYPE_VIDEO'
  useEffect(() => {
    if (!nextIsVideo) return
    const idle = (window as any).requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 1500))
    const cancel = (window as any).cancelIdleCallback ?? clearTimeout
    const handle = idle(() => {
      void loadVideoActivity()
      if (nextVideoSprite) {
        const img = new Image()
        img.fetchPriority = 'low'
        img.src = nextVideoSprite
      }
    })
    return () => cancel(handle)
  }, [nextIsVideo, nextVideoSprite])


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
    else if (activity.activity_type == 'TYPE_VIDEO' || activity.activity_type == 'TYPE_LIVE_SESSION' || activity.activity_type == 'TYPE_PLAY') {
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
  const displayName = activity?.name ?? activityNameFromCourse
  const displayActivityType = allActivities[currentIndex]?.activity_type

  if (activity?.is_locked && activity?.drip_reason) {
    return (
      <DripGate
        activityName={displayName}
        dripReason={activity.drip_reason}
        dripUnlockAt={activity.drip_unlock_at}
        courseHref={getUriWithOrg(orgslug, coursePath({ slug: course?.slug, course_uuid: courseuuid }))}
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
                className="lh-t-btn inline-flex items-center justify-center px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-semibold hover:bg-gray-800 transition-colors"
              >
                {t('auth.sign_in', 'Sign in')}
              </Link>
            )}
            <Link
              href={getUriWithOrg(orgslug, coursePath({ slug: course?.slug, course_uuid: courseuuid }))}
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
      <CourseProvider courseuuid={course?.course_uuid} initialCourseStructure={course} lang={contentLang.lang || undefined}>
        {/* Common ancestor of BOTH the task editors and the Submit button, which
            live in disjoint AssignmentSubmissionProvider subtrees. Lets Submit
            flush unsaved task answers before grading (avoids silent 0%). */}
        <AssignmentDirtyTasksProvider>
        <Suspense fallback={<LoadingFallback />}>
          <AIChatBotProvider>
            <Suspense fallback={null}>
              <AISidePanelContentWrapper>
            {/* One tree for both layouts. In focus mode this wrapper becomes a
                fixed full-screen layer with its own scroll; everything inside
                keeps its place, so the activity (a playing video included)
                is restyled rather than remounted. */}
            <div
              ref={focusShellRef}
              data-focus={isFocusMode ? (focusDark ? 'dark' : 'light') : undefined}
              className={isFocusMode
                ? `lh-focus fixed inset-0 overflow-y-auto overflow-x-hidden overscroll-contain ${focusDark ? 'bg-[#0b0b0c] text-white [color-scheme:dark]' : 'bg-[#f7f7f6]'}`
                : 'max-w-(--breakpoint-2xl) mx-auto px-4 sm:px-6 lg:px-8 py-5 tracking-tight relative'}
              style={{ zIndex: isFocusMode ? 'var(--z-overlay)' : 'var(--z-content)' }}
              {...swipeHandlers}
            >
                {isFocusMode && (
                  <FocusTopBar
                    course={course}
                    orgUuid={org?.org_uuid}
                    orgslug={orgslug}
                    courseuuid={courseuuid}
                    activityName={displayName}
                    activityId={activityid}
                    trailData={trailData}
                    dark={focusDark}
                    idle={chromeIdle}
                    onExit={() => setIsFocusMode(false)}
                    actions={!isPhone && activity && activity.published == true && activity.content.paid_access != false ? (
                      <div className="hidden md:flex items-center gap-2">
                        {activity.activity_type != 'TYPE_ASSIGNMENT' && (
                          <AuthenticatedClientElement checkMethod="authentication">
                            <Suspense fallback={null}>
                              <AIActivityAsk activity={activity} />
                            </Suspense>
                          </AuthenticatedClientElement>
                        )}
                        <AuthenticatedClientElement checkMethod="authentication">
                          <NotesButton activityUuid={activity.activity_uuid} dark={focusDark} />
                        </AuthenticatedClientElement>
                        <div className={focusDark ? 'lh-focus-dark-dropdown' : ''}>
                          <ActivityChapterDropdown
                            course={course}
                            currentActivityId={activity.activity_uuid ? activity.activity_uuid.replace('activity_', '') : activityid.replace('activity_', '')}
                            orgslug={orgslug}
                            trailData={trailData}
                          />
                        </div>
                      </div>
                    ) : null}
                  />
                )}
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
                  <div className={isFocusMode
                    ? `lh-focus-body relative mx-auto w-full max-w-(--breakpoint-2xl) px-4 sm:px-8 ${focusDark ? 'pt-4 sm:pt-6' : 'pt-5 sm:pt-8'}`
                    : 'space-y-4 pt-0 relative'}>
                    {!isFocusMode && (<>
                    {/* Phones: one back row to the course instead of the
                        breadcrumb trail and the course header below, with
                        the way into focus mode at its end. */}
                    <div className="sm:hidden flex items-center gap-1 min-w-0">
                    <Link
                      href={getUriWithOrg(orgslug, coursePath({ slug: course?.slug, course_uuid: courseuuid }))}
                      className="lh-press -ms-1 flex flex-1 items-center gap-2 min-h-[44px] pe-2 min-w-0"
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
                      <span className="truncate text-sm font-semibold text-gray-700" lang={courseContentLang} dir="auto">{course.name}</span>
                    </Link>
                    <CompanyContextChip orgslug={orgslug} compact />
                    <ContentLanguageSwitcher course={course} onChange={contentLang.setLanguage} size="sm" className="shrink-0" />
                    {activity && activity.published == true && activity.content.paid_access != false && (
                      <AuthenticatedClientElement checkMethod="authentication">
                        <NotesButton activityUuid={activity.activity_uuid} variant="icon" />
                      </AuthenticatedClientElement>
                    )}
                    {activity && activity.published == true && activity.content.paid_access != false && (
                      <button
                        type="button"
                        onClick={() => setIsFocusMode(true)}
                        className="lh-press ms-auto grid size-11 shrink-0 place-items-center rounded-full text-gray-500 active:bg-black/5"
                        title={t('activities.focus_mode')}
                        aria-label={t('activities.focus_mode')}
                      >
                        <ArrowsOut size={19} weight="bold" />
                      </button>
                    )}
                    </div>
                    <div className="hidden sm:flex items-center gap-3 pt-2 pb-6 min-w-0">
                      <CompanyContextChip orgslug={orgslug} />
                      <Breadcrumbs items={[
                        { label: t('courses.courses'), href: getUriWithOrg(orgslug, '/courses'), icon: <BookCopy size={14} /> },
                        { label: course.name, href: getUriWithOrg(orgslug, coursePath({ slug: course?.slug, course_uuid: courseuuid })) },
                        { label: displayName }
                      ]} />
                    </div>
                    <div className="space-y-3 sm:space-y-4 activity-info-section relative" style={{ zIndex: 'var(--z-content)' }}>
                        <div className="hidden sm:flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
                          <div className="flex space-x-4 sm:space-x-6 items-center">
                            <div className="flex shrink-0">
                              <Link
                                href={getUriWithOrg(orgslug, coursePath({ slug: course?.slug, course_uuid: courseuuid }))}
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
                              {/* The heading keeps the page's direction (so it aligns with the
                                  page); only the inner text is bidi-isolated, so a right-to-left
                                  title no longer drifts to the middle. Arabic glyphs sit taller:
                                  pt-1 keeps them clear of the label above. */}
                              <h1 className="font-bold text-gray-950 text-lg sm:text-3xl text-start has-[span:dir(rtl)]:pt-1">
                                <span lang={courseContentLang} dir="auto">{course.name}</span>
                              </h1>
                            </div>
                          </div>
                          {activity && (
                            <div className="hidden sm:flex items-center gap-2">
                              <ContentLanguageSwitcher course={course} onChange={contentLang.setLanguage} />
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
                              {/* The chapter is named in the progress strip above. */}
                              <h1 className="font-bold text-gray-950 text-base sm:text-2xl max-sm:text-[22px] max-sm:leading-tight max-sm:pt-1 text-start">
                                <span lang={activity?.locale || courseContentLang} dir="auto">{displayName}</span>
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
                                    {/* The chapter outline lives in the progress strip above. */}
                                    <AIActivityAsk activity={activity} />
                                    {/* Private notes on this lesson (n). */}
                                    <NotesButton activityUuid={activity.activity_uuid} />
                                    {contributorStatus === 'ACTIVE' && activity.activity_type == 'TYPE_DYNAMIC' && (
                                      <Link
                                        href={getUriWithOrg(orgslug, '') + `/course/${courseuuid}/activity/${activityid}/edit`}
                                        className={buttonClass('secondary', 'md')}
                                      >
                                        <PencilSimple size={14} />
                                        {t('courses.contribute')}
                                      </Link>
                                    )}
                                  </>
                                )}
                              </AuthenticatedClientElement>
                            )}
                          </div>
                        </div>
                      </div>
                    </>)}

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
                          {fallbackNotice && <TranslationFallbackNotice locale={servedLocale(course)} className="mb-3" />}
                          {activity.content.paid_access == false ? (
                            <PaidCourseActivityDisclaimer course={course} activity={activity} />
                          ) : (
                            // Video activities sit on a dark theater band (theater.css).
                            <div className={activity.activity_type === 'TYPE_VIDEO' ? (isFocusMode ? 'lh-focus-stage relative' : 'lh-theater-band py-8 sm:py-12') : (isFocusMode ? 'lh-focus-stage relative' : '')}>
                            {activity.activity_type === 'TYPE_VIDEO' && !isFocusMode && (
                              <button
                                type="button"
                                onClick={() => setIsFocusMode(true)}
                                className={`absolute top-0 end-0 -translate-y-1/2 max-sm:hidden ${buttonClass('secondary', 'icon')}`}
                                style={{ zIndex: 'var(--z-interactive)' }}
                                title={t('activities.focus_mode')}
                                aria-label={t('activities.focus_mode')}
                              >
                                <ArrowsOut size={14} />
                              </button>
                            )}
                            <div className="flex gap-6">
                              <div className={isFocusMode ? `lh-vt-stage flex-1 min-w-0 relative isolate mx-auto w-full ${focusStageClass(activity.activity_type)}` : `lh-vt-stage flex-1 min-w-0 ${activity.activity_type === 'TYPE_SCORM' ? 'rounded-xl overflow-hidden' : activity.activity_type === 'TYPE_VIDEO' ? 'max-sm:-mx-4' : activity.activity_type === 'TYPE_LIVE_SESSION' || activity.activity_type === 'TYPE_PLAY' ? '' : activity.activity_type === 'TYPE_ASSIGNMENT' ? 'pt-2 sm:pt-0' : activity.activity_type === 'TYPE_DYNAMIC' ? '-mx-4 sm:mx-0 px-4 py-5 sm:p-7 rounded-none sm:rounded-lg max-sm:shadow-none max-sm:outline-none max-sm:border-y max-sm:border-black/[0.05]' : activity.activity_type === 'TYPE_DOCUMENT' ? '-mx-4 sm:mx-0 px-3 py-4 sm:p-7 rounded-none sm:rounded-lg max-sm:bg-neutral-100! max-sm:shadow-none max-sm:outline-none' : 'p-3 sm:p-7 rounded-lg'} ${bgColor} relative isolate`} style={{ zIndex: 'var(--z-base)' }}>
                                {activity.activity_type !== 'TYPE_VIDEO' && !isFocusMode && (
                                <button
                                  type="button"
                                  onClick={() => setIsFocusMode(true)}
                                  className={`absolute ${activity.activity_type === 'TYPE_SCORM' ? 'top-2 end-2' : activity.activity_type === 'TYPE_ASSIGNMENT' || activity.activity_type === 'TYPE_PLAY' ? '-top-4 -end-2' : 'top-3 end-3'} max-sm:hidden pointer-events-auto ${buttonClass('secondary', 'icon')}`}
                                  style={{ zIndex: 'var(--z-interactive)' }}
                                  title={t('activities.focus_mode')}
                                  aria-label={t('activities.focus_mode')}
                                >
                                  <ArrowsOut size={14} />
                                </button>
                                )}
                                {/* lang/dir of the language the content is in (dir only for RTL). */}
                                <div className="contents" {...activityContentAttrs}>
                                  {activityContent}
                                </div>
                              </div>
                              <Suspense fallback={null}>
                                <AISidePanelInline activity={activity} />
                              </Suspense>
                              <AuthenticatedClientElement checkMethod="authentication">
                                <NotesHost activity={activity} shortcutsReady={shortcutsReady} />
                              </AuthenticatedClientElement>
                            </div>
                            </div>
                          )}
                        </>
                      ) : null}

                      {/* Activity Actions below the content box. Phones get the
                          bottom bar instead; only one is mounted so the actions
                          (and an assignment's submit / grade dialogs) exist once. */}
                      {!isPhone && activity && activity.published == true && activity.content.paid_access != false && (
                        <div className={isFocusMode
                          ? `lh-focus-dock fixed inset-x-0 bottom-0 flex justify-center px-4 pointer-events-none transition-opacity duration-500 motion-reduce:transition-none ${chromeIdle ? 'opacity-0' : 'opacity-100'}`
                          : 'flex justify-center mt-6 w-full'}
                          style={isFocusMode ? { zIndex: 'var(--z-modal-content)', paddingBottom: 'max(16px, var(--lh-safe-bottom))' } : undefined}
                        >
                          {/* One slim bar: previous · the activity's control · next. */}
                          <ActivityNavBar dark={activity.activity_type === 'TYPE_VIDEO'} className="pointer-events-auto">
                            <PreviousActivityButton
                              course={course}
                              currentActivityId={activity.id}
                              orgslug={orgslug}
                              dark={activity.activity_type === 'TYPE_VIDEO'}
                            />
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
                            {allActivities.length >= 4 && currentIndex >= 0 && (
                              <NavProgressHint
                                current={currentIndex + 1}
                                total={allActivities.length}
                                dark={activity.activity_type === 'TYPE_VIDEO'}
                              />
                            )}
                            <NavDivider dark={activity.activity_type === 'TYPE_VIDEO'} />
                            <NextActivityButton
                              course={course}
                              currentActivityId={activity.id}
                              orgslug={orgslug}
                              dark={activity.activity_type === 'TYPE_VIDEO'}
                            />
                          </ActivityNavBar>
                        </div>
                      )}

                      {/* Fixed Activity Secondary Bar */}
                      {!isFocusMode && activity && activity.published == true && activity.content.paid_access != false && (
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

                      <div className={isFocusMode ? 'h-28 max-md:h-24' : 'h-6 sm:h-[100px]'}></div>
                    </div>
                )}
            </div>
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
  // Same language list the page reads with, so the warmed entry is the one
  // the next lesson actually uses (a lang-less prefetch was a second fetch).
  const nextContentLang = useContentLanguage();
  const nextLang = nextContentLang.lang || undefined;
  const _isMobile = useMediaQuery('(max-width: 768px)')
  const [isLoading, setIsLoading] = React.useState(false);

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
    if (!isUserPartOfTheOrg || !nextActivityUuid || !nextContentLang.ready) return;
    const cleanCourseUuid = props.course.course_uuid.replace('course_', '');
    prefetchRouteFull(router, getUriWithOrg(props.orgslug, '') + `/course/${cleanCourseUuid}/activity/${nextActivityUuid}`);
    queryClient.prefetchQuery(activityQueryOptions(nextActivityUuid, accessToken, nextLang));
  }, [isUserPartOfTheOrg, nextActivityUuid, accessToken, nextLang, nextContentLang.ready, props.course.course_uuid, props.orgslug, queryClient, router]);

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
    const trailKey = queryKeys.trail.org(org?.id);
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
        queryClient.setQueryData(trailKey, trail);
      } else {
        await queryClient.invalidateQueries({ queryKey: trailKey });
      }
      // No confirmation dialog: undoing is one click away in the toast. Undo
      // marks it done again in place (no jump to the next activity).
      toast(
        (tt) => (
          <span className="flex items-center gap-3 text-sm">
            {t('activities.nav.marked_not_done', 'Marked as not done')}
            <button
              type="button"
              className="font-semibold text-neutral-900 underline underline-offset-2"
              onClick={async () => {
                toast.dismiss(tt.id);
                try {
                  const next = await markActivityAsComplete(
                    props.orgslug,
                    props.course.course_uuid,
                    props.activity.activity_uuid,
                    session.data?.tokens?.access_token
                  );
                  if (next?.runs) queryClient.setQueryData(trailKey, next);
                  else await queryClient.invalidateQueries({ queryKey: trailKey });
                } catch {
                  toast.error(t('activities.failed_mark_complete'));
                }
              }}
            >
              {t('activities.nav.undo', 'Undo')}
            </button>
          </span>
        ),
        { duration: 5000 }
      );
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
  // A play activity is completed by passing the play, never by hand, unless
  // the API says the play can't run (then it can't block the course).
  const isPlay = props.activity?.activity_type === 'TYPE_PLAY' && props.activity?.play_available !== false
  // `m` only ever marks; undoing is a deliberate click on the Completed pill.
  useShortcut(
    { id: 'activity.complete', keys: 'm', label: t('shortcuts.mark_complete'), group: 'page',
      run: () => { if (!isLoading) markActivityAsCompleteFront() } },
    !!props.trailData && isUserPartOfTheOrg && !completed && !isPlay,
  )

  // Don't render until we have trail data
  if (!props.trailData) {
    return null;
  }

  // Don't show progress tracking for non-members
  if (!isUserPartOfTheOrg) {
    return null;
  }

  if (isPlay) {
    return <PlayCompletionStatus completed={completed} dark={props.dark} compact={props.compact} />
  }

  // One clear control: an outline "Mark as complete" (M), then a soft success
  // pill once done; clicking the pill undoes it (with an Undo toast).
  const opts = { dark: props.dark, compact: props.compact }
  return completed ? (
    <button
      type="button"
      role="checkbox"
      aria-checked="true"
      onClick={!isLoading ? unmarkActivityAsCompleteFront : undefined}
      disabled={isLoading}
      title={t('activities.nav.undo_hint', 'Completed. Click to mark as not done')}
      className={navControlClass('done', opts)}
    >
      {isLoading ? <CircleNotch size={17} className="animate-spin" /> : <PhCheckCircle size={17} weight="fill" className="lh-t-accent shrink-0" />}
      {t('common.completed')}
    </button>
  ) : (
    <button
      type="button"
      role="checkbox"
      aria-checked="false"
      aria-keyshortcuts="m"
      onClick={!isLoading ? markActivityAsCompleteFront : undefined}
      disabled={isLoading}
      className={navControlClass('todo', opts)}
    >
      {isLoading ? (
        <CircleNotch size={17} className="animate-spin shrink-0" />
      ) : (
        <PhCheckCircle size={17} className={`shrink-0 transition-colors ${props.dark ? 'text-white/50 group-hover:text-white' : 'text-neutral-400 group-hover:text-neutral-700'}`} />
      )}
      {isLoading ? t('activities.marking') : t('activities.mark_as_complete')}
      {!props.compact && <Keys keys="m" tone={props.dark ? 'onDark' : 'muted'} className="ms-0.5" />}
    </button>
  )
}

function NextActivityButton({ course, currentActivityId, orgslug, dark = false }: { course: any, currentActivityId: string, orgslug: string, dark?: boolean }) {
  const router = useRouter();

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
    <NavStepButton
      direction="next"
      title={isLastActivity ? '' : nextActivity.name}
      finish={isLastActivity}
      onClick={navigateToActivity}
      dark={dark}
    />
  );
}

function PreviousActivityButton({ course, currentActivityId, orgslug, dark = false }: { course: any, currentActivityId: string, orgslug: string, dark?: boolean }) {
  const router = useRouter();

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
    <>
      <NavStepButton direction="prev" title={previousActivity.name} onClick={navigateToActivity} dark={dark} />
      <NavDivider dark={dark} />
    </>
  );
}

function AssignmentTools(props: {
  activity: any
  activityid: string
  course: any
  orgslug: string
  assignment: any
  dark?: boolean
  compact?: boolean
}) {
  const { t } = useTranslation();
  const opts = { dark: props.dark, compact: props.compact }
  const submission = useAssignmentSubmission() as any
  const session = useLHSession() as any;
  const org = useOrg() as any;
  const queryClient = useQueryClient();
  const dirtyTasks = useAssignmentDirtyTasks();
  const [gradeData, setGradeData] = React.useState<any>(null);
  const [isGradeModalOpen, setIsGradeModalOpen] = React.useState(false);
  const { width: windowWidth, height: windowHeight } = useWindowSize();
  // Ensures the auto-open-on-mount logic only fires once per page view,
  // so the modal doesn't pop back open every time gradeData refreshes.
  const hasAutoOpenedRef = React.useRef(false);

  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const submitForGradingUI = async () => {
    if (props.assignment) {
      if (isSubmitting) return
      setIsSubmitting(true)
      try {
        // Persist any answers the learner selected but didn't manually save, so
        // grading never runs against an empty/stale answer sheet. Abort if a save
        // fails rather than silently finalizing a 0%.
        const flushed = await dirtyTasks.flushAll()
        if (!flushed) {
          toast.error(t('assignments.failed_submit_assignment'))
          return
        }
        const res = await submitAssignmentForGrading(
          props.assignment?.assignment_uuid,
          session.data?.tokens?.access_token
        )
        if (res.success) {
          toast.success(t('assignments.assignment_submitted_success'))
          queryClient.invalidateQueries({ queryKey: queryKeys.assignments.submission(props.assignment?.assignment_uuid) })
          queryClient.invalidateQueries({ queryKey: queryKeys.assignments.taskSubmission(props.assignment?.assignment_uuid) })
          // Submitting may auto-grade the assignment (GRADED), which makes the
          // answer key eligible to be revealed (show_correct_answers). The task
          // definitions were fetched pre-grade with the key stripped, so refetch
          // them; otherwise the reveal renders every option as "incorrect".
          queryClient.invalidateQueries({ queryKey: queryKeys.assignments.tasks(props.assignment?.assignment_uuid) })
          // Handing in can also unlock the model answer (solution_reveal =
          // ON_SUBMISSION). The corrigé rides on the assignment payload and was
          // fetched with it stripped, so refetch that too; otherwise the
          // learner has to reload the page to see what they just earned.
          queryClient.invalidateQueries({ queryKey: queryKeys.assignments.detail(props.assignment?.assignment_uuid) })
          // The learner's own assignment list (the trail's "due this week"
          // and assignments section) reads status from the same submission.
          queryClient.invalidateQueries({ queryKey: queryKeys.assignments.mine(org?.id) })
        }
        else {
          toast.error(t('assignments.failed_submit_assignment'))
        }
      } finally {
        setIsSubmitting(false)
      }
    }
  }

  const [isRetrying, setIsRetrying] = React.useState(false);
  const retrySubmissionUI = async () => {
    if (!props.assignment || isRetrying) return;
    setIsRetrying(true);
    try {
      const res = await retryAssignmentSubmission(
        props.assignment?.assignment_uuid,
        session.data?.tokens?.access_token
      );
      if (res.success) {
        toast.success(t('assignments.retry_assignment_success'));
        // The retry wiped every per-task submission server-side. Clear the
        // cached batch IMMEDIATELY (before the refetch lands) so the task
        // editors (which remount on the incremented attempt number) hydrate
        // from an empty state and don't briefly re-adopt the previous attempt's
        // answers as their saved baseline (which would submit empty -> 0%).
        queryClient.setQueryData(queryKeys.assignments.taskSubmission(props.assignment?.assignment_uuid), {});
        // Pull the fresh per-task batch + the user submission so the task
        // editors snap back to an empty state without a hard reload.
        queryClient.invalidateQueries({ queryKey: queryKeys.assignments.submission(props.assignment?.assignment_uuid) });
        queryClient.invalidateQueries({ queryKey: queryKeys.assignments.taskSubmission(props.assignment?.assignment_uuid) });
        // The submission is back to PENDING, so the answer key must be stripped
        // again; refetch the task definitions so a revealed key from the graded
        // attempt isn't left visible during the retry.
        queryClient.invalidateQueries({ queryKey: queryKeys.assignments.tasks(props.assignment?.assignment_uuid) });
        // A retry puts the submission back to PENDING, which re-locks the model
        // answer server-side. Refetch so the learner isn't left reading the
        // corrigé they are no longer entitled to for this attempt.
        queryClient.invalidateQueries({ queryKey: queryKeys.assignments.detail(props.assignment?.assignment_uuid) });
        queryClient.invalidateQueries({ queryKey: queryKeys.assignments.mine(org?.id) });
        setGradeData(null);
        setIsGradeModalOpen(false);
        // Re-arm the auto-open on this fresh attempt so the next graded
        // result still pops the celebration / detail modal.
        hasAutoOpenedRef.current = false;
      } else {
        toast.error(t('assignments.retry_assignment_failed'));
      }
    } finally {
      setIsRetrying(false);
    }
  };

  const getGradingBasedOnMethod = async () => {
    const res = await getFinalGrade(
      session.data?.user?.id,
      props.assignment?.assignment_uuid,
      session.data?.tokens?.access_token
    );
    if (res.success) {
      // The backend returns a rich grade object: display_grade, points_summary,
      // percentage_display, passed, overall_feedback, etc. We just render it,
      // no client-side math.
      setGradeData(res.data);
    }
  };

  useEffect(() => {
    if ( submission && submission.length > 0 && submission[0].submission_status === 'GRADED') {
      getGradingBasedOnMethod();
    }
  }
    , [submission, props.assignment])

  // Auto-open the grade details modal when the student lands on a GRADED
  // assignment that was auto-graded. We only do this once per mount so it
  // doesn't reopen every time SWR re-hydrates the grade data in the
  // background.
  useEffect(() => {
    if (hasAutoOpenedRef.current) return;
    if (!gradeData) return;
    if (!submission || submission.length === 0) return;
    if (submission[0].submission_status !== 'GRADED') return;
    if (!props.assignment?.auto_grading) return;
    hasAutoOpenedRef.current = true;
    setIsGradeModalOpen(true);
  }, [gradeData, submission, props.assignment]);

  // No submission yet, OR the row exists in PENDING / NOT_SUBMITTED because
  // the student previously hit "Try again" and the retry endpoint reset the
  // row in place. In both cases the next action is the same: submit for
  // grading. The submit endpoint upserts on PENDING so a fresh submission
  // here reuses the existing row and preserves the attempt counter.
  const isAwaitingSubmission =
    !submission ||
    submission.length === 0 ||
    submission[0].submission_status === 'PENDING' ||
    submission[0].submission_status === 'NOT_SUBMITTED';
  // A formative assignment is handed in, not "submitted for grading"; nothing
  // downstream will ever mark it, so every label here says so.
  const isUngradedAssignment = !!props.assignment?.ungraded;
  const attemptNumber = submission?.[0]?.attempt_number ?? 1;
  const isRetryAttempt = isAwaitingSubmission && submission?.length > 0 && attemptNumber > 1;

  if (isAwaitingSubmission) {
    // Past the deadline the server 403s every write, including the flush that
    // "Submit for grading" performs. Offering the button anyway produced a
    // generic failure toast with no explanation of why.
    if (isAssignmentPastDue(props.assignment?.due_date)) {
      return (
        <span role="status" className={navControlClass('danger', opts)}>
          <BookOpenCheck size={16} className="shrink-0" />
          {t('assignments.past_due', { defaultValue: 'Deadline passed' })}
        </span>
      )
    }

    // While the submit runs the trigger itself reports it: saving every pending
    // answer and grading server-side takes seconds on a long assignment, and
    // the bar is what the learner is looking at.
    if (isSubmitting) {
      return (
        <span role="status" aria-busy="true" className={navControlClass('neutral', opts)}>
          <Loader2 size={16} className="animate-spin shrink-0" />
          {t('assignments.submitting', { defaultValue: 'Submitting…' })}
        </span>
      )
    }

    return (
      <ConfirmationModal
        confirmationButtonText={t('assignments.submit_assignment')}
        pendingButtonText={t('assignments.submitting', { defaultValue: 'Submitting…' })}
        confirmationMessage={
          isUngradedAssignment
            ? t('assignments.hand_in_confirm', {
                defaultValue:
                  'Your work will be handed in to your teacher. It is not graded.',
              })
            : t('assignments.submit_assignment_confirm')
        }
        dialogTitle={
          isUngradedAssignment
            ? t('assignments.hand_in_title', { defaultValue: 'Hand in your work' })
            : t('assignments.submit_assignment_title')
        }
        dialogTrigger={
          // Completion is automatic here: handing in is the action, not a toggle.
          <button type="button" className={navControlClass('primary', opts)}>
            <BookOpenCheck size={16} className="shrink-0" />
            {isUngradedAssignment
              ? t('assignments.hand_in', { defaultValue: 'Hand in my work' })
              : t('assignments.submit_for_grading')}
            {isRetryAttempt && (
              <span className="text-xs font-medium opacity-60">
                {t('assignments.attempt_count', { current: attemptNumber })}
              </span>
            )}
          </button>
        }
        functionToExecute={submitForGradingUI}
        status="info"
        openOnEvent={ASSIGNMENT_SUBMIT_EVENT}
      />
    )
  }

  if (submission[0].submission_status === 'SUBMITTED') {
    // Formative assignments never leave SUBMITTED (there is no grading queue
    // behind them), so "Grading in progress" would be a lie that never resolves.
    if (isUngradedAssignment) {
      const allowRetries = !!props.assignment?.allow_retries;
      const maxRetries = Number(props.assignment?.max_retries || 0);
      const currentAttempt = Number(submission?.[0]?.attempt_number || 1);
      const canRetry =
        allowRetries &&
        !isAssignmentPastDue(props.assignment?.due_date) &&
        (maxRetries === 0 || currentAttempt < maxRetries);

      return (
        <div className={`flex items-center gap-2 ${props.compact ? 'w-full' : ''}`}>
          <span role="status" className={navControlClass('done', opts)}>
            <CheckCircle size={16} className="lh-t-accent shrink-0" />
            {t('assignments.handed_in', { defaultValue: 'Handed in' })}
          </span>
          {canRetry && (
            <ConfirmationModal
              confirmationButtonText={t('assignments.retry_assignment')}
              // The generic warning talks about replacing a grade; here the
              // consequence is that the corrigé re-locks until the next hand-in.
              confirmationMessage={t('assignments.retry_assignment_confirm_ungraded', {
                defaultValue:
                  'Your current hand-in will be reset so you can start over, and the model answer locks again until you hand in the next attempt.',
              })}
              dialogTitle={t('assignments.retry_assignment_title')}
              dialogTrigger={
                <button
                  type="button"
                  disabled={isRetrying}
                  className={`${navControlClass('todo', opts)} ${props.compact ? 'w-auto! shrink-0' : ''}`}
                >
                  <RotateCcw size={14} className="shrink-0" />
                  {t('assignments.retry_assignment')}
                </button>
              }
              functionToExecute={retrySubmissionUI}
              status="warning"
            />
          )}
        </div>
      )
    }

    return (
      <span role="status" className={navControlClass('warn', opts)}>
        <UserRoundPen size={16} className="shrink-0" />
        {t('assignments.grading_in_progress')}
      </span>
    )
  }

  if (submission[0].submission_status === 'GRADED') {
    // Fallback string if the server response hasn't hydrated yet or is old.
    const displayGrade = gradeData?.display_grade
      ?? (gradeData ? `${gradeData.grade}/${gradeData.max_grade}` : '...');
    const pointsSummary = gradeData?.points_summary;
    const percentageDisplay = gradeData?.percentage_display;
    const passed = gradeData?.passed;
    const feedback = gradeData?.overall_feedback;
    const tasks = gradeData?.tasks as any[] | undefined;
    const isPassing = passed !== false;

    // Retry availability mirrors the backend's eligibility check: teacher
    // opted in (allow_retries) and attempt counter hasn't reached the cap
    // (max_retries=0 means unlimited). We compute it client-side too so the
    // "Try again" button is only rendered when it would actually succeed.
    const allowRetries = !!props.assignment?.allow_retries;
    const maxRetries = Number(props.assignment?.max_retries || 0);
    const currentAttempt = Number(submission?.[0]?.attempt_number || 1);
    const attemptsRemaining = maxRetries
      ? Math.max(0, maxRetries - currentAttempt)
      : null;
    // Past the deadline the server refuses a retry, and rightly so: retry wipes
    // the answers, grade and certificate, and every resubmit path is deadline
    // gated, so a retry here would destroy graded work with no way back. Mirror
    // that client-side rather than offering a button that 403s.
    const retryPastDue = isAssignmentPastDue(props.assignment?.due_date);
    const canRetry =
      allowRetries && !retryPastDue && (maxRetries === 0 || currentAttempt < maxRetries);

    return (
      <>
        {/* The grade, as the bar's status pill; opens the details. */}
        <button
          type="button"
          onClick={() => setIsGradeModalOpen(true)}
          className={navControlClass(isPassing ? 'done' : 'danger', opts)}
        >
          <CheckCircle size={16} className={`shrink-0 ${isPassing ? 'lh-t-accent' : ''}`} />
          {t('assignments.graded')}
          <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-bold tabular-nums ${
            props.dark ? 'bg-white/10' : 'bg-white/80 ring-1 ring-inset ring-black/[0.06]'
          }`}>
            {displayGrade}
          </span>
          {allowRetries && currentAttempt > 1 && (
            <span className="text-[11px] font-medium opacity-60">
              {maxRetries
                ? t('assignments.attempt_count_bounded', { current: currentAttempt, max: maxRetries })
                : t('assignments.attempt_count', { current: currentAttempt })}
            </span>
          )}
          <ChevronRight size={14} className="shrink-0 opacity-60 rtl:rotate-180" />
        </button>

        {/* Confetti for passing students. Fires once each time the modal
            opens because react-confetti with recycle={false} plays through
            and the conditional remount restarts it. */}
        {isGradeModalOpen && isPassing && gradeData && (
          <div className="fixed inset-0 pointer-events-none z-[300]">
            <ReactConfetti
              width={windowWidth}
              height={windowHeight}
              numberOfPieces={220}
              recycle={false}
              gravity={0.18}
              tweenDuration={6000}
              colors={['#10b981', '#14b8a6', '#06b6d4', '#fbbf24', '#f59e0b', '#ec4899']}
            />
          </div>
        )}

        {/* Detail modal: opens on click and auto-opens once when the
            assignment is auto-graded so students see their result right
            away. */}
        <Modal
          isDialogOpen={isGradeModalOpen}
          onOpenChange={(open: boolean) => setIsGradeModalOpen(open)}
          minWidth="sm"
          noPadding
          dialogContent={
            <div className="flex flex-col">
              {/* Hero */}
              <div className={`relative px-6 pt-8 pb-7 overflow-hidden ${
                isPassing
                  ? 'bg-gradient-to-br from-emerald-50 via-teal-50 to-cyan-50'
                  : 'bg-gradient-to-br from-rose-50 via-orange-50 to-amber-50'
              }`}>
                {/* Decorative blobs */}
                <div className={`absolute -top-12 -end-12 w-44 h-44 rounded-full blur-3xl opacity-40 ${
                  isPassing ? 'bg-emerald-300' : 'bg-rose-300'
                }`} />
                <div className={`absolute -bottom-16 -start-12 w-44 h-44 rounded-full blur-3xl opacity-40 ${
                  isPassing ? 'bg-cyan-300' : 'bg-amber-300'
                }`} />

                <div className="relative flex flex-col items-center text-center space-y-3">
                  <div className={`relative w-[72px] h-[72px] rounded-full flex items-center justify-center nice-shadow bg-white`}>
                    {isPassing ? (
                      <Trophy size={34} className="text-emerald-600" strokeWidth={2.2} />
                    ) : (
                      <XCircle size={36} className="text-rose-600" strokeWidth={2.2} />
                    )}
                    {isPassing && (
                      <>
                        <Sparkles size={16} className="absolute -top-1 -end-1 text-amber-500 drop-shadow" />
                        <Sparkles size={12} className="absolute -bottom-1 -start-1 text-amber-400 drop-shadow" />
                      </>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <p className={`text-[10px] font-bold uppercase tracking-[0.18em] ${
                      isPassing ? 'text-emerald-700' : 'text-rose-700'
                    }`}>
                      {isPassing
                        ? t('dashboard.assignments.submissions.preview.passing')
                        : t('dashboard.assignments.submissions.preview.not_passing')}
                    </p>
                    <h2 className="text-5xl font-black text-gray-900 tracking-tight leading-none">
                      {displayGrade}
                    </h2>
                    {(pointsSummary || percentageDisplay) && (
                      <p className="text-sm text-gray-500 font-medium pt-1">
                        {[percentageDisplay, pointsSummary].filter(Boolean).join(' · ')}
                      </p>
                    )}
                    {gradeData?.ai_graded && (
                      <div className="flex justify-center pt-1">
                        <AIChip tone="soft" title={t('assignments.ai_graded_hint')}>
                          {t('assignments.ai_graded_badge')}
                        </AIChip>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Body */}
              <div className="px-6 pt-5 pb-6 space-y-5">
                {tasks && tasks.length > 0 && (
                  <div className="space-y-2.5">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                      {t('assignments.task_breakdown')}
                    </p>
                    <div className="space-y-1.5">
                      {tasks.map((tb: any) => {
                        const pct = Math.max(0, Math.min(100, tb.percentage || 0));
                        // Use the server's per-task verdict. Hardcoding 60 here
                        // contradicted the real threshold (50 for most grading
                        // types, or the teacher's own pass_threshold_percentage),
                        // so a task at 50% rendered as failing in this modal while
                        // the hero above it said "Passing" and the page behind it
                        // showed a green "Task passed" card.
                        const passedTask = tb.submitted && (
                          typeof tb.passed === 'boolean' ? tb.passed : pct >= 60
                        );
                        return (
                          <div
                            key={tb.assignment_task_uuid}
                            className="relative overflow-hidden rounded-lg bg-gray-50 px-3 py-2.5"
                          >
                            {tb.submitted && (
                              <div
                                className={`absolute inset-y-0 start-0 transition-all ${
                                  passedTask ? 'bg-emerald-100/70' : 'bg-rose-100/70'
                                }`}
                                style={{ width: `${pct}%` }}
                              />
                            )}
                            <div className="relative flex items-center justify-between gap-3">
                              <span className="text-sm text-gray-700 truncate" title={tb.description || `Task ${tb.index}`}>
                                <span className="font-bold text-gray-400 me-1.5">{tb.index}.</span>
                                {tb.description || `Task ${tb.index}`}
                              </span>
                              <span className={`text-xs font-bold flex-none ${
                                !tb.submitted
                                  ? 'text-gray-400'
                                  : passedTask
                                    ? 'text-emerald-700'
                                    : 'text-rose-700'
                              }`}>
                                {tb.submitted ? tb.percentage_display : 'n/a'}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {feedback && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-400">
                      <MessageSquare size={11} />
                      <span>{t('dashboard.assignments.submissions.feedback.label')}</span>
                    </div>
                    <div className="p-3 rounded-lg bg-gray-50 border border-gray-100">
                      <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
                        {feedback}
                      </p>
                    </div>
                  </div>
                )}

                {!tasks?.length && !feedback && (
                  <p className="text-sm text-gray-400 text-center py-4">
                    {t('assignments.no_grade_details')}
                  </p>
                )}

                {allowRetries && (
                  <div className="pt-2">
                    {canRetry ? (
                      <div className="rounded-xl border border-fuchsia-100 bg-gradient-to-br from-fuchsia-50 via-pink-50 to-rose-50 p-4">
                        <div className="flex items-start gap-3">
                          <div className="w-9 h-9 rounded-full bg-white nice-shadow flex items-center justify-center text-fuchsia-600 shrink-0">
                            <RotateCcw size={16} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-bold text-gray-900">
                              {t('assignments.retry_assignment_title')}
                            </p>
                            <p className="text-xs text-gray-600 mt-1 leading-snug">
                              {t('assignments.retry_assignment_confirm')}
                            </p>
                            <p className="text-[11px] text-fuchsia-700 mt-2 font-semibold flex items-center gap-1.5">
                              {maxRetries === 0 ? (
                                <>
                                  <InfinityIcon size={11} />
                                  <span>
                                    {t('assignments.attempt_count', { current: currentAttempt })}
                                  </span>
                                </>
                              ) : attemptsRemaining === 1 ? (
                                <span>{t('assignments.retry_assignment_last')}</span>
                              ) : (
                                <span>
                                  {t('assignments.retry_assignment_remaining', { count: attemptsRemaining })}
                                </span>
                              )}
                            </p>
                          </div>
                        </div>
                        <ConfirmationModal
                          confirmationButtonText={t('assignments.retry_assignment')}
                          confirmationMessage={t('assignments.retry_assignment_confirm')}
                          dialogTitle={t('assignments.retry_assignment_title')}
                          dialogTrigger={
                            <button
                              type="button"
                              disabled={isRetrying}
                              className="lh-t-btn mt-3 w-full inline-flex items-center justify-center gap-1.5 h-9 px-4 rounded-lg bg-gray-900 hover:bg-gray-800 disabled:opacity-50 text-white text-sm font-semibold transition-colors"
                            >
                              <RotateCcw size={14} />
                              {t('assignments.retry_assignment')}
                            </button>
                          }
                          functionToExecute={retrySubmissionUI}
                          status="warning"
                        />
                      </div>
                    ) : (
                      <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                        <div className="flex items-center gap-2">
                          <RotateCcw size={14} className="text-gray-400 shrink-0" />
                          <p className="text-xs text-gray-500 font-medium">
                            {t('assignments.retry_no_attempts_left')} ·{' '}
                            {t('assignments.attempt_count_bounded', {
                              current: currentAttempt,
                              max: maxRetries,
                            })}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          }
        />
      </>
    )
  }

  // Default return in case none of the conditions are met
  return null
}

export default ActivityClient

/** Read-only status for a play activity: passing the play completes it. */
function PlayCompletionStatus({ completed, dark, compact }: { completed: boolean; dark?: boolean; compact?: boolean }) {
  const { t } = useTranslation()
  const text = completed
    ? t('common.completed')
    : compact
      ? t('play_activity.learner.status_pending_short', 'Pass to complete')
      : t('play_activity.learner.status_pending', 'Pass the play to complete')
  return (
    <span role="status" className={navControlClass(completed ? 'done' : 'neutral', { dark, compact })}>
      {completed ? <PhCheckCircle size={17} weight="fill" className="lh-t-accent shrink-0" /> : <Circle size={16} className="shrink-0" />}
      {text}
    </span>
  )
}
