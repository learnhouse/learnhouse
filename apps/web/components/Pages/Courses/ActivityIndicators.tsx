'use client'
import { BookOpenCheck, Check, FileText, Layers, Video, ChevronLeft, ChevronRight, ChevronDown, Trophy } from 'lucide-react'
import React, { useMemo, memo, useState, useRef, useEffect, useCallback } from 'react'
import ToolTip from '@components/Objects/StyledElements/Tooltip/Tooltip'
import { getUriWithOrg } from '@services/config/config'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'

interface Props {
  course: any
  orgslug: string
  course_uuid: string
  current_activity?: string
  enableNavigation?: boolean
  trailData?: any
}

// Helper functions
function getActivityTypeLabel(activityType: string, t: any): string {
  switch (activityType) {
    case 'TYPE_VIDEO':
      return t('activities.video')
    case 'TYPE_DOCUMENT':
      return t('activities.document')
    case 'TYPE_DYNAMIC':
      return t('activities.interactive')
    case 'TYPE_ASSIGNMENT':
      return t('activities.assignment')
    default:
      return t('common.unknown')
  }
}

function getActivityTypeBadgeColor(activityType: string): string {
  switch (activityType) {
    case 'TYPE_VIDEO':
      return 'bg-blue-100 text-blue-700'
    case 'TYPE_DOCUMENT':
      return 'bg-purple-100 text-purple-700'
    case 'TYPE_DYNAMIC':
      return 'bg-green-100 text-green-700'
    case 'TYPE_ASSIGNMENT':
      return 'bg-orange-100 text-orange-700'
    default:
      return 'bg-gray-100 text-gray-700'
  }
}

// Memoized activity type icon component
const ActivityTypeIcon = memo(({ activityType }: { activityType: string }) => {
  switch (activityType) {
    case 'TYPE_VIDEO':
      return <Video size={16} className="text-gray-400" />
    case 'TYPE_DOCUMENT':
      return <FileText size={16} className="text-gray-400" />
    case 'TYPE_DYNAMIC':
      return <Layers size={16} className="text-gray-400" />
    case 'TYPE_ASSIGNMENT':
      return <BookOpenCheck size={16} className="text-gray-400" />
    default:
      return <FileText size={16} className="text-gray-400" />
  }
});

ActivityTypeIcon.displayName = 'ActivityTypeIcon';

// Memoized activity tooltip content
const ActivityTooltipContent = memo(({ 
  activity, 
  isDone, 
  isCurrent 
}: { 
  activity: any, 
  isDone: boolean, 
  isCurrent: boolean 
}) => {
  const { t } = useTranslation();
  return (
  <div className="bg-white rounded-lg nice-shadow py-3 px-4 min-w-[200px] animate-in fade-in duration-200">
    <div className="flex items-center gap-2">
      <ActivityTypeIcon activityType={activity.activity_type} />
      <span className="text-sm text-gray-700">{activity.name}</span>
      {isDone && (
        <span className="ms-auto text-gray-400">
          <Check size={14} />
        </span>
      )}
    </div>
    <div className="flex items-center gap-2 mt-2">
      <span className={`text-xs px-2 py-0.5 rounded-full ${getActivityTypeBadgeColor(activity.activity_type)}`}>
        {getActivityTypeLabel(activity.activity_type, t)}
      </span>
      <span className="text-xs text-gray-400">
        {isCurrent ? t('activities.current_activity') : isDone ? t('common.completed') : t('activities.not_started')}
      </span>
    </div>
  </div>
  );
});

ActivityTooltipContent.displayName = 'ActivityTooltipContent';

// Add new memoized component for chapter tooltip
const ChapterTooltipContent = memo(({ 
  chapter,
  chapterNumber,
  totalActivities,
  completedActivities 
}: { 
  chapter: any,
  chapterNumber: number,
  totalActivities: number,
  completedActivities: number
}) => {
  const { t } = useTranslation();
  return (
  <div className="bg-white rounded-lg nice-shadow py-3 px-4 min-w-[200px] animate-in fade-in duration-200">
    <div className="flex items-center gap-2">
      <span className="text-sm font-medium text-gray-900">{t('courses.chapter')} {chapterNumber}</span>
      <span className="text-xs bg-gray-100 px-2 py-0.5 rounded-full text-gray-600">
        {completedActivities}/{totalActivities} {t('common.completed')}
      </span>
    </div>
    <div className="mt-1">
      <span className="text-sm text-gray-700">{chapter.name}</span>
    </div>
  </div>
  );
});

ChapterTooltipContent.displayName = 'ChapterTooltipContent';

// Add certification badge component
const CertificationBadge = memo(({ 
  courseid,
  orgslug,
  isCompleted 
}: { 
  courseid: string,
  orgslug: string,
  isCompleted: boolean 
}) => {
  const { t } = useTranslation();
  return (
  <ToolTip
    sideOffset={8}
    unstyled
    content={
      <div className="bg-white rounded-lg nice-shadow py-3 px-4 min-w-[200px] animate-in fade-in duration-200">
        <div className="flex items-center gap-2">
          <Trophy size={16} className="text-yellow-500" />
          <span className="text-sm font-medium text-gray-900">
            {isCompleted ? t('courses.course_completed_exclamation') : t('courses.course_completion')}
          </span>
        </div>
        <div className="mt-1">
          <span className="text-sm text-gray-700">
            {isCompleted 
              ? t('certificate.view_certificate')
              : t('courses.unlock_certificate_message')
            }
          </span>
        </div>
      </div>
    }
  >
    <Link
      href={`${getUriWithOrg(orgslug, '')}/course/${courseid}/activity/end`}
      prefetch={false}
      className={`shrink-0 flex items-center cursor-pointer focus:outline-none transition-all ${
        isCompleted ? 'opacity-100' : 'opacity-40 cursor-not-allowed'
      }`}
    >
      <div className={`w-[20px] h-[20px] sm:w-[22px] sm:h-[22px] rounded-full flex items-center justify-center text-xs font-medium transition-all border-2 border-white ${
        isCompleted
          ? 'bg-yellow-500 text-white hover:bg-yellow-600'
          : 'bg-gray-200 text-gray-400'
      }`}>
        <Trophy size={10} />
      </div>
    </Link>
  </ToolTip>
)});

CertificationBadge.displayName = 'CertificationBadge';

// Mobile chapter selector dropdown
const MobileChapterSelector = memo(({
  chapters,
  currentChapterIndex,
  orgslug,
  courseid,
  isActivityDone,
  isActivityCurrent,
  t,
}: {
  chapters: any[]
  currentChapterIndex: number
  orgslug: string
  courseid: string
  isActivityDone: (activity: any) => boolean
  isActivityCurrent: (activity: any) => boolean
  t: any
}) => {
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const handleClose = useCallback(() => setIsOpen(false), [])

  useEffect(() => {
    if (!isOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        handleClose()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen, handleClose])

  return (
    <div ref={dropdownRef} className="relative">
      <button
        onClick={() => setIsOpen((v) => !v)}
        className="flex items-center gap-0.5 text-[10px] text-gray-500 font-medium hover:text-gray-700 transition-colors"
      >
        <span>{t('courses.chapter')} {currentChapterIndex + 1}/{chapters.length}</span>
        <ChevronDown size={10} className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div
          className="absolute top-full start-0 mt-2 bg-white rounded-lg nice-shadow py-1.5 min-w-[220px] max-h-[60vh] overflow-y-auto"
          style={{ zIndex: 'var(--z-dropdown)' }}
        >
          {chapters.map((chapter: any, chapterIdx: number) => {
            const completedInChapter = chapter.activities.filter((a: any) => isActivityDone(a)).length
            const isCurrentChapter = chapterIdx === currentChapterIndex

            return (
              <div key={chapter.id}>
                <div className={`px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide ${isCurrentChapter ? 'text-teal-600' : 'text-gray-400'}`}>
                  {t('courses.chapter')} {chapterIdx + 1} — {completedInChapter}/{chapter.activities.length}
                </div>
                {chapter.activities.map((activity: any) => {
                  const isDone = isActivityDone(activity)
                  const isCurrent = isActivityCurrent(activity)
                  const activityId = activity.activity_uuid.replace('activity_', '')

                  return (
                    <Link
                      key={activity.activity_uuid}
                      href={getUriWithOrg(orgslug, '') + `/course/${courseid}/activity/${activityId}`}
                      prefetch={false}
                      onClick={handleClose}
                      className={`flex items-center gap-2 px-3 py-2 text-xs transition-colors ${
                        isCurrent
                          ? 'bg-gray-50 text-gray-900 font-medium'
                          : 'text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      <div className={`w-[6px] h-[6px] rounded-full shrink-0 ${
                        isDone ? 'bg-teal-500' : isCurrent ? 'bg-gray-500 animate-pulse' : 'bg-zinc-200'
                      }`} />
                      <ActivityTypeIcon activityType={activity.activity_type} />
                      <span className="truncate">{activity.name}</span>
                      {isDone && <Check size={12} className="text-teal-500 ms-auto shrink-0" />}
                    </Link>
                  )
                })}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
});

MobileChapterSelector.displayName = 'MobileChapterSelector';

function ActivityIndicators(props: Props) {
  const { t } = useTranslation();
  const course = props.course
  const orgslug = props.orgslug
  const courseid = props.course_uuid.replace('course_', '')
  const enableNavigation = props.enableNavigation || false
  const router = useRouter()

  const done_activity_style = 'bg-teal-500 hover:bg-teal-600'
  const black_activity_style = 'bg-zinc-200/80 hover:bg-zinc-300'
  const current_activity_style = 'bg-gray-500 animate-pulse hover:bg-gray-600'

  // Flatten all activities for navigation and rendering
  const allActivities = useMemo(() => {
    return course.chapters.flatMap((chapter: any) =>
      chapter.activities.map((activity: any) => ({
        ...activity,
        chapterId: chapter.id
      }))
    )
  }, [course.chapters])

  // Find current activity index
  const currentActivityIndex = useMemo(() => {
    if (!props.current_activity) return -1
    return allActivities.findIndex((activity: any) =>
      activity.activity_uuid.replace('activity_', '') === props.current_activity
    )
  }, [allActivities, props.current_activity])

  // Memoize activity status checks
  const isActivityDone = useMemo(() => (activity: any) => {
    // Clean up course UUID by removing 'course_' prefix if it exists
    const cleanCourseUuid = course.course_uuid?.replace('course_', '');

    let run = props.trailData?.runs?.find(
      (run: any) => {
        const cleanRunCourseUuid = run.course?.course_uuid?.replace('course_', '');
        return cleanRunCourseUuid === cleanCourseUuid;
      }
    );

    if (run) {
      return run.steps.find(
        (step: any) => step.activity_id === activity.id && step.complete === true
      );
    }
    return false;
  }, [props.trailData, course.course_uuid]);

  const isActivityCurrent = useMemo(() => (activity: any) => {
    let activity_uuid = activity.activity_uuid.replace('activity_', '')
    if (props.current_activity && props.current_activity == activity_uuid) {
      return true
    }
    return false
  }, [props.current_activity]);

  const getActivityClass = useMemo(() => (activity: any) => {
    const isCurrent = isActivityCurrent(activity)
    if (isActivityDone(activity)) {
      return `${done_activity_style}`
    }
    if (isCurrent) {
      return `${current_activity_style}`
    }
    return `${black_activity_style}`
  }, [isActivityDone, isActivityCurrent]);

  // Keep the allActivities array for navigation purposes only
  const navigateToPrevious = () => {
    if (currentActivityIndex > 0) {
      const prevActivity = allActivities[currentActivityIndex - 1]
      const activityId = prevActivity.activity_uuid.replace('activity_', '')
      router.push(getUriWithOrg(orgslug, '') + `/course/${courseid}/activity/${activityId}`)
    }
  }

  const navigateToNext = () => {
    if (currentActivityIndex < allActivities.length - 1) {
      const nextActivity = allActivities[currentActivityIndex + 1]
      const activityId = nextActivity.activity_uuid.replace('activity_', '')
      router.push(getUriWithOrg(orgslug, '') + `/course/${courseid}/activity/${activityId}`)
    }
  }

  // Add function to count completed activities in a chapter
  const getChapterProgress = useMemo(() => (chapterActivities: any[]) => {
    return chapterActivities.reduce((acc, activity) => {
      return acc + (isActivityDone(activity) ? 1 : 0)
    }, 0)
  }, [isActivityDone]);

  // Check if all activities are completed
  const isCourseCompleted = useMemo(() => {
    const totalActivities = allActivities.length;
    const completedActivities = allActivities.filter((activity: any) => isActivityDone(activity)).length;
    return totalActivities > 0 && completedActivities === totalActivities;
  }, [allActivities, isActivityDone]);

  // Computed values for mobile compact view
  const completedCount = useMemo(() => {
    return allActivities.filter((activity: any) => isActivityDone(activity)).length;
  }, [allActivities, isActivityDone]);

  const totalCount = allActivities.length;
  const progressPercent = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

  // Find which chapter the current activity belongs to
  const currentChapterIndex = useMemo(() => {
    if (!props.current_activity) return 0
    for (let i = 0; i < course.chapters.length; i++) {
      const chapter = course.chapters[i]
      const found = chapter.activities.find((a: any) =>
        a.activity_uuid.replace('activity_', '') === props.current_activity
      )
      if (found) return i
    }
    return 0
  }, [course.chapters, props.current_activity]);

  return (
    <>
      {/* Mobile compact view */}
      <div className="flex sm:hidden items-center gap-2">
        {enableNavigation && (
          <button
            onClick={navigateToPrevious}
            disabled={currentActivityIndex <= 0}
            className="p-1.5 rounded-full bg-gray-50 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
            aria-label={t('activities.previous_activity')}
          >
            <ChevronLeft size={16} className="text-gray-500" />
          </button>
        )}

        <div className="flex-1 flex flex-col gap-1.5 min-w-0 relative">
          <div className="flex items-center justify-between text-[10px] text-gray-500 font-medium px-0.5">
            <MobileChapterSelector
              chapters={course.chapters}
              currentChapterIndex={currentChapterIndex}
              orgslug={orgslug}
              courseid={courseid}
              isActivityDone={isActivityDone}
              isActivityCurrent={isActivityCurrent}
              t={t}
            />
            <span>{completedCount}/{totalCount}</span>
          </div>
          <div className="w-full bg-zinc-200/80 rounded-full h-[6px] overflow-hidden">
            <div
              className="h-full bg-teal-500 rounded-full transition-all duration-300"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>

        <CertificationBadge
          courseid={courseid}
          orgslug={orgslug}
          isCompleted={isCourseCompleted}
        />

        {enableNavigation && (
          <button
            onClick={navigateToNext}
            disabled={currentActivityIndex >= allActivities.length - 1}
            className="p-1.5 rounded-full bg-gray-50 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
            aria-label={t('activities.next_activity')}
          >
            <ChevronRight size={16} className="text-gray-500" />
          </button>
        )}
      </div>

      {/* Desktop full view */}
      <div className="hidden sm:flex items-center gap-4">
        {enableNavigation && (
          <button
            onClick={navigateToPrevious}
            disabled={currentActivityIndex <= 0}
            className="p-1 rounded-full hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
            aria-label={t('activities.previous_activity')}
          >
            <ChevronLeft size={18} className="text-gray-600" />
          </button>
        )}

        <div className="flex items-center w-full min-w-0 overflow-x-auto scrollbar-hide gap-2">
          {course.chapters.map((chapter: any, chapterIndex: number) => {
            const completedActivities = getChapterProgress(chapter.activities);
            const isChapterComplete = completedActivities === chapter.activities.length;
            const firstActivity = chapter.activities[0];
            const firstActivityId = firstActivity?.activity_uuid?.replace('activity_', '');
            const chapterLinkHref =
              firstActivityId
                ? getUriWithOrg(orgslug, '') + `/course/${courseid}/activity/${firstActivityId}`
                : undefined;

            return (
              <div key={chapter.id} className="flex-1 flex items-center min-w-0">
                {/* Chapter circle — glued to the left of the bar */}
                <ToolTip
                  sideOffset={8}
                  unstyled
                  content={
                    <ChapterTooltipContent
                      chapter={chapter}
                      chapterNumber={chapterIndex + 1}
                      totalActivities={chapter.activities.length}
                      completedActivities={completedActivities}
                    />
                  }
                >
                  {chapterLinkHref ? (
                    <Link href={chapterLinkHref} prefetch={false} className="relative z-10 shrink-0 flex items-center cursor-pointer focus:outline-none">
                      <div className={`w-[22px] h-[22px] rounded-full flex items-center justify-center text-[10px] font-bold transition-all border-2 border-white ${
                        isChapterComplete
                          ? 'bg-teal-500 text-white'
                          : 'bg-gray-200 text-gray-500'
                      }`}>
                        {chapterIndex + 1}
                      </div>
                    </Link>
                  ) : (
                    <div className="relative z-10 shrink-0 flex items-center cursor-not-allowed">
                      <div className={`w-[22px] h-[22px] rounded-full flex items-center justify-center text-[10px] font-bold transition-all border-2 border-white ${
                        isChapterComplete
                          ? 'bg-teal-500 text-white'
                          : 'bg-gray-200 text-gray-500'
                      }`}>
                        {chapterIndex + 1}
                      </div>
                    </div>
                  )}
                </ToolTip>

                {/* Activity segments — glued to circle, flush together */}
                <div className="flex-1 flex items-center min-w-0 -ms-[4px]">
                  {chapter.activities.map((activity: any, activityIndex: number) => {
                    const isDone = isActivityDone(activity)
                    const isCurrent = isActivityCurrent(activity)
                    const isLast = activityIndex === chapter.activities.length - 1
                    return (
                      <ToolTip
                        sideOffset={8}
                        unstyled
                        content={
                          <ActivityTooltipContent
                            activity={activity}
                            isDone={isDone}
                            isCurrent={isCurrent}
                          />
                        }
                        key={activity.activity_uuid}
                      >
                        <Link
                          prefetch={false}
                          href={
                            getUriWithOrg(orgslug, '') +
                            `/course/${courseid}/activity/${activity.activity_uuid.replace(
                              'activity_',
                              ''
                            )}`
                          }
                          className={`${isCurrent ? 'flex-2' : 'flex-1'} min-w-[12px] ${!isLast ? 'border-e-[1.5px] border-white' : ''}`}
                        >
                          <div
                            className={`h-[7px] ${getActivityClass(activity)} ${isLast ? 'rounded-e-full' : ''} transition-all hover:brightness-110`}
                          ></div>
                        </Link>
                      </ToolTip>
                    )
                  })}
                </div>
              </div>
            )
          })}

          {/* Certification Badge */}
          <CertificationBadge
            courseid={courseid}
            orgslug={orgslug}
            isCompleted={isCourseCompleted}
          />
        </div>

        {enableNavigation && (
          <button
            onClick={navigateToNext}
            disabled={currentActivityIndex >= allActivities.length - 1}
            className="p-1 rounded-full hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
            aria-label={t('activities.next_activity')}
          >
            <ChevronRight size={18} className="text-gray-600" />
          </button>
        )}
      </div>
    </>
  )
}

export default memo(ActivityIndicators)
