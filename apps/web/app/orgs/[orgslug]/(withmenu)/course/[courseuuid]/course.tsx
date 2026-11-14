'use client'
import Link from 'next/link'
import React, { useEffect, useState, Suspense } from 'react'
import { getUriWithOrg } from '@services/config/config'
import { getCourseMetadata } from '@services/courses/courses'
import { useTrail } from '@/hooks/queries/useTrail'
import ActivityIndicators from '@components/Pages/Courses/ActivityIndicators'
import { useRouter } from 'next/navigation'
import GeneralWrapperStyled from '@components/Objects/StyledElements/Wrappers/GeneralWrapper'
import {
  getCourseThumbnailMediaDirectory,
} from '@services/media/media'
import { ArrowSquareOut, Books, CalendarPlus, CaretDown, CaretRight, Check, CheckCircle, Circle, ClockCounterClockwise, Diamond, Eye, ImageSquare, LockSimple, Stack, VideoCamera } from '@phosphor-icons/react'
import { buttonClass, Chip, formatRelative } from '@components/Dashboard/Shared/DashKit/DashKit'
import { ActivityTypeGlyph } from '@components/Pages/Courses/CourseOutlineList'
import { getMyCourseAccess } from '@ee/services/payments/access'
import { useOrg } from '@components/Contexts/OrgContext'
import { CourseProvider } from '@components/Contexts/CourseContext'
import CoursesActions from '@components/Objects/Courses/CourseActions/CoursesActions'
import CourseAuthors from '@components/Objects/Courses/CourseAuthors/CourseAuthors'
import CoursePaths from '@components/Objects/Courses/CoursePaths/CoursePaths'
import LinkifiedText from '@components/Objects/StyledElements/LinkifiedText/LinkifiedText'
import { Breadcrumbs } from '@components/Objects/Breadcrumbs/Breadcrumbs'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { prefetchRouteFull } from '@/lib/navigation/prefetchRoute'
import { activityQueryOptions } from '@/hooks/queries/useActivity'
import { useTranslation } from 'react-i18next'
import { ChapterEmoji } from '@components/Objects/Courses/ChapterEmoji/ChapterEmoji'
import CourseCommunitySection from '@components/Objects/Communities/CourseCommunitySection'
import CourseShare from '@components/Objects/Courses/CourseShare/CourseShare'
import { ShareCourseInMessagesButton } from '@components/Messaging/EntryButtons'
import CourseAccessError from '@components/Objects/Courses/CourseAccessError/CourseAccessError'
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics'
import { useShortcut } from '@/lib/shortcuts/ShortcutsContext'
import { Keys } from '@components/Objects/Shortcuts/Kbd'
import DripBadge, { DripIcon, DripUntilBadge, useDripLabel } from '@components/Objects/Courses/DripBadge'
import { buildIcs } from '@/lib/drip'
import ThumbnailImage from '@components/Objects/Thumbnails/ThumbnailImage'
import { useContentLanguage } from '@/hooks/useContentLanguage'
import { ContentLanguageSwitcher, contentLangProps } from '@components/Objects/Courses/ContentLanguage/ContentLanguage'
import { servedLocale } from '@/lib/contentLanguage'

const CourseClient = (props: any) => {
  const { t, i18n } = useTranslation()
  const [learnings, setLearnings] = useState<any>([])
  const [expandedChapters, setExpandedChapters] = useState<{[key: string]: boolean}>({})
  const [activeThumbnailType, setActiveThumbnailType] = useState<'image' | 'video'>('image')
  const courseuuid = props.courseuuid
  const orgslug = props.orgslug
  const initialCourse = props.course
  const serverError = props.serverError
  const org = useOrg() as any
  const _router = useRouter()
  const session = useLHSession() as any;
  const access_token = session?.data?.tokens?.access_token;
  const queryClient = useQueryClient()
  // Which lessons are sold and not bought yet, and which are free previews.
  const { data: paidAccessRes } = useQuery({
    queryKey: [...queryKeys.payments.myCourseAccess(org?.id, `course_${courseuuid}`), !!access_token],
    queryFn: () => getMyCourseAccess(org.id, `course_${courseuuid}`, access_token),
    enabled: !!(org?.id && courseuuid),
    staleTime: 30_000,
    retry: false,
  })
  const paidState: Record<string, string> = paidAccessRes?.success && paidAccessRes.data?.sold ? paidAccessRes.data.activities : {}

  // Content language: ?lang=, remembered choice, UI language, browser. The
  // API serves the first published translation and falls back to the default.
  const contentLang = useContentLanguage()
  const { data: clientCourseData, error: courseError, isLoading: courseQueryLoading } = useQuery({
    queryKey: queryKeys.courses.meta(courseuuid, contentLang.lang || undefined),
    queryFn: () => getCourseMetadata(courseuuid, {}, access_token, { slim: true, lang: contentLang.lang || undefined }),
    enabled: !!courseuuid && !serverError && contentLang.ready,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    // Switching language keeps the page on screen while the other version loads.
    placeholderData: keepPreviousData,
  });
  const courseLoading = courseQueryLoading || (!contentLang.ready && !clientCourseData)

  const course = initialCourse || clientCourseData;
  // The language the course texts are in (lang/dir of the content, not the
  // chrome). Only when the API says (courses without a declared language keep today's markup).
  const contentAttrs = course?.locale || course?.default_locale ? contentLangProps(servedLocale(course)) : {}

  const { track } = useLHAnalytics('learner')

  // Keyboard: `e` opens every chapter, or folds them all once they are open.
  const chapters: any[] = course?.chapters ?? []
  const dripLabel = useDripLabel()
  // First chapter the drip schedule still holds back, for the "next up" banner.
  const nextDrip = chapters.find((chapter: any) => chapter.drip_locked && chapter.drip_reason !== 'closed')
  // Releases with a known date, for the "Add to calendar" download.
  const datedReleases = chapters.filter((chapter: any) => chapter.drip_locked && chapter.drip_unlock_at)
  const downloadReleaseCalendar = () => {
    const courseUrl = typeof window !== 'undefined' ? window.location.href.split('#')[0] : undefined
    const ics = buildIcs(
      course?.name ?? '',
      datedReleases.map((chapter: any) => ({
        uid: chapter.chapter_uuid,
        title: t('course.drip.calendar_event', { defaultValue: '{{chapter}} opens · {{course}}', chapter: chapter.name, course: course?.name }),
        start: new Date(chapter.drip_unlock_at),
        url: courseUrl,
      }))
    )
    const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `${(course?.name ?? 'course').replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase()}-schedule.ics`
    a.click()
    URL.revokeObjectURL(url)
  }
  const allChaptersExpanded = chapters.length > 0 && chapters.every(
    (chapter: any, idx: number) => expandedChapters[chapter.chapter_uuid] ?? idx === 0,
  )
  const setAllChapters = (open: boolean) =>
    setExpandedChapters(Object.fromEntries(chapters.map((chapter: any) => [chapter.chapter_uuid, open])))
  useShortcut(
    { id: 'course.chapters', keys: 'e', group: 'page',
      label: allChaptersExpanded ? t('shortcuts.collapse_chapters') : t('shortcuts.expand_chapters'),
      run: () => setAllChapters(!allChaptersExpanded) },
    chapters.length > 0,
  )

  // Track course view
  const courseId = course?.id
  const courseUuidForTracking = course?.course_uuid
  useEffect(() => {
    if (courseId && courseUuidForTracking) {
      track(AnalyticsEvent.CourseViewed, {
        course_uuid: courseUuidForTracking,
      })
    }
  }, [courseId, courseUuidForTracking, track])

  // Fetch trail data; shared cache with useTrail hook used elsewhere
  const { data: trailData } = useTrail(org?.id);

  // Must be before any early returns (React rules of hooks)
  useEffect(() => {
    if (!course) return

    getLearningTags(course)

    if (course?.chapters) {
      const totalActivities = course.chapters.reduce((sum: number, chapter: any) => sum + (chapter.activities?.length || 0), 0)
      const defaultExpanded: {[key: string]: boolean} = {}
      course.chapters.forEach((chapter: any, idx: number) => {
        defaultExpanded[chapter.chapter_uuid] = idx === 0 ? true : totalActivities <= 5
      })
      setExpandedChapters(defaultExpanded)
    }
  }, [course])

  // Show loading state if fetching course data client-side
  if (!initialCourse && !serverError && courseLoading) {
    return (
      <GeneralWrapperStyled>
        <div className="animate-pulse">
          {/* Breadcrumb placeholder */}
          <div className="pb-4 flex items-center gap-2">
            <div className="h-3 bg-gray-200 rounded w-16" />
            <div className="h-3 bg-gray-200 rounded w-2" />
            <div className="h-3 bg-gray-200 rounded w-32" />
          </div>

          {/* Course title + share row */}
          <div className="pb-2 flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
            <div className="h-9 bg-gray-200 rounded w-2/3" />
            <div className="h-8 bg-gray-200 rounded-lg w-24" />
          </div>

          {/* Main content: left 3/4 + right 1/4 sidebar */}
          <div className="flex flex-col md:flex-row gap-8 pt-2">
            {/* Left column */}
            <div className="w-full md:w-3/4 space-y-4">
              {/* Thumbnail */}
              <div className="bg-gray-200 rounded-lg w-full h-[200px] md:h-[400px]" />
              {/* About text block */}
              <div className="space-y-2 py-2">
                <div className="h-3 bg-gray-200 rounded w-full" />
                <div className="h-3 bg-gray-200 rounded w-5/6" />
                <div className="h-3 bg-gray-200 rounded w-4/6" />
                <div className="h-3 bg-gray-200 rounded w-full" />
                <div className="h-3 bg-gray-200 rounded w-3/4" />
              </div>
            </div>

            {/* Right sidebar */}
            <div className="w-full md:w-1/4 space-y-4">
              {/* Actions box */}
              <div className="bg-gray-200 rounded-lg h-40" />
              {/* Authors box */}
              <div className="bg-gray-200 rounded-lg h-24" />
            </div>
          </div>

          {/* Chapter list */}
          <div className="w-full my-5 mb-10">
            <div className="h-7 bg-gray-200 rounded w-40 mb-5" />
            <div className="bg-white shadow-md shadow-gray-300/25 outline outline-1 outline-neutral-200/40 rounded-lg overflow-hidden">
              {Array.from({ length: 3 }).map((_, chIdx) => (
                <div key={chIdx}>
                  {/* Chapter header */}
                  <div className="flex items-center gap-3 py-4 px-4 bg-neutral-50 outline outline-1 outline-neutral-200/40">
                    <div className="h-5 w-5 bg-gray-200 rounded-full flex-shrink-0" />
                    <div className="h-5 bg-gray-200 rounded w-5 flex-shrink-0" />
                    <div className="h-5 bg-gray-200 rounded w-1/3" />
                  </div>
                  {/* Activity rows: only expand first chapter */}
                  {chIdx === 0 && Array.from({ length: 3 }).map((_, aIdx) => (
                    <div key={aIdx} className="flex items-center gap-3 px-4 py-4 border-t border-neutral-100">
                      <div className="h-4 w-4 bg-gray-200 rounded flex-shrink-0" />
                      <div className="flex-1 space-y-1.5">
                        <div className="h-4 bg-gray-200 rounded w-1/2" />
                        <div className="h-3 bg-gray-200 rounded w-20" />
                      </div>
                      <div className="h-4 w-4 bg-gray-200 rounded flex-shrink-0" />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </GeneralWrapperStyled>
    )
  }

  // Determine the active error (server-side or client-side)
  const activeError = serverError || courseError

  // Show error if course fetch failed
  if (!course && activeError) {
    return <CourseAccessError error={activeError} orgslug={orgslug} />
  }

  function getLearningTags(courseData: any) {
    if (!courseData?.learnings) {
      setLearnings([])
      return
    }

    try {
      // Try to parse as JSON (new format)
      const parsedLearnings = JSON.parse(courseData.learnings)
      if (Array.isArray(parsedLearnings)) {
        // New format: array of learning items with text and emoji
        setLearnings(parsedLearnings)
        return
      }
    } catch (_e) {
      // Not valid JSON, continue to legacy format handling
    }

    // Legacy format: comma-separated string (changed from pipe-separated)
    const learningItems = courseData.learnings.split(',').map((text: string) => ({
      id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(),
      text: text.trim(), // Trim whitespace that might be present after commas
      emoji: '📝' // Default emoji for legacy items
    }))

    setLearnings(learningItems)
  }

  const getActivityTypeLabel = (activityType: string, activitySubType?: string) => {
    if (activitySubType === 'SUBTYPE_DYNAMIC_MARKDOWN') return t('activities.markdown')
    if (activitySubType === 'SUBTYPE_DYNAMIC_EMBED') return t('activities.embed')
    switch (activityType) {
      case 'TYPE_VIDEO':
        return t('activities.video')
      case 'TYPE_DOCUMENT':
        return t('activities.document')
      case 'TYPE_DYNAMIC':
        return t('activities.page')
      case 'TYPE_ASSIGNMENT':
        return t('activities.assignment')
      case 'TYPE_SCORM':
        return t('activities.scorm')
      case 'TYPE_LIVE_SESSION':
        return t('activities.live_session')
      case 'TYPE_PLAY':
        return t('activities.play', 'Play')
      case 'TYPE_CUSTOM':
        return t('activities.custom')
      default:
        return t('activities.learning_material')
    }
  }

  const isActivityDone = (activity: any) => {
    if (!course?.course_uuid || !trailData?.runs || !Array.isArray(trailData.runs)) {
      return false
    }
    const cleanCourseUuid = course.course_uuid.replace('course_', '')
    const run = trailData.runs.find((run: any) => {
      const cleanRunCourseUuid = run.course?.course_uuid?.replace('course_', '')
      return cleanRunCourseUuid === cleanCourseUuid
    })
    if (!run || !Array.isArray(run.steps)) return false
    return !!run.steps.find((step: any) => step.activity_id == activity.id)
  }

  const isActivityCurrent = (activity: any) => {
    if (!activity?.activity_uuid) return false
    const activity_uuid = activity.activity_uuid.replace('activity_', '')
    return props.current_activity === activity_uuid
  }

  const handleActivityMouseEnter = (activity: any) => {
    if (!activity?.activity_uuid) return
    const cleanUuid = activity.activity_uuid.replace('activity_', '')
    // The page too, not only its data: the activity route is client-rendered,
    // so with both warm the click shows the lesson at once.
    prefetchRouteFull(_router, getUriWithOrg(orgslug, '') + `/course/${courseuuid}/activity/${cleanUuid}`)
    queryClient.prefetchQuery(activityQueryOptions(cleanUuid, access_token, contentLang.lang || undefined))
  }

  // Course structured data is emitted on the server by the `@seo` slot.

  const totalActivityCount = chapters.reduce((sum: number, ch: any) => sum + (ch.activities?.length ?? 0), 0)
  const courseRun = (() => {
    const cleanCourseUuid = course?.course_uuid?.replace('course_', '')
    return (Array.isArray(trailData?.runs) ? trailData.runs : []).find(
      (run: any) => run.course?.course_uuid?.replace('course_', '') === cleanCourseUuid
    )
  })()
  const displayLearnings = (Array.isArray(learnings) ? learnings : []).filter((l: any) => {
    const text = typeof l === 'string' ? l : l?.text
    return text && text.trim() !== '' && text !== 'null'
  })
  const updatedLabel = course ? formatRelative(course.update_date || course.creation_date, i18n.language || 'en') : null

  // Thumbnail, or the course video when that is what the teacher set. "Both"
  // keeps the image / video switch.
  const renderMedia = () => {
    const showVideo = course.thumbnail_type === 'video' || (course.thumbnail_type === 'both' && activeThumbnailType === 'video')
    const toggle =
      course.thumbnail_type === 'both' ? (
        <div className="absolute top-2 end-2 z-10 flex gap-1 rounded-lg bg-black/25 backdrop-blur-sm p-1">
          {(['image', 'video'] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              onClick={() => setActiveThumbnailType(kind)}
              aria-pressed={activeThumbnailType === kind}
              className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold transition-colors ${
                activeThumbnailType === kind ? 'bg-white/90 text-neutral-900' : 'text-white/85 hover:bg-white/10'
              }`}
            >
              {kind === 'image' ? <ImageSquare size={12} /> : <VideoCamera size={12} />}
              {kind === 'image' ? t('courses.image') : t('activities.video')}
            </button>
          ))}
        </div>
      ) : null
    return (
      <div className="relative w-full aspect-video md:aspect-auto md:h-[400px] overflow-hidden rounded-2xl bg-neutral-100 nice-shadow max-sm:-mx-4 max-sm:w-auto max-sm:rounded-none">
        {showVideo && course.thumbnail_video ? (
          <video
            src={getCourseThumbnailMediaDirectory(org?.org_uuid, course?.course_uuid, course?.thumbnail_video)}
            className="absolute inset-0 w-full h-full bg-black object-cover"
            controls
            autoPlay
            muted
            preload="metadata"
            playsInline
          />
        ) : (
          <ThumbnailImage
            src={course.thumbnail_image ? getCourseThumbnailMediaDirectory(org?.org_uuid, course?.course_uuid, course?.thumbnail_image) : null}
            fetchPriority="high"
            loading="eager"
            alt=""
            className="absolute inset-0 w-full h-full"
          />
        )}
        {toggle}
      </div>
    )
  }

  const activityStatus = (activity: any, chapter: any) => {
    const locked = !!activity.is_locked
    const dripped = locked && !!chapter.drip_locked
    if (dripped) return <DripIcon reason={chapter.drip_reason} size={16} />
    if (locked) return <LockSimple size={16} className="text-neutral-400" aria-label={t('course.locked', 'Locked')} />
    if (isActivityDone(activity)) return <CheckCircle size={18} weight="fill" className="text-teal-500" aria-label={t('common.completed')} />
    return <Circle size={18} className="text-neutral-300" aria-hidden="true" />
  }

  return (
    <>
      {!course || !org ? null : (
        <>
          <GeneralWrapperStyled>
            <div className="hidden sm:block pb-5">
              <Breadcrumbs items={[
                { label: t('courses.courses'), href: getUriWithOrg(orgslug, '/courses'), icon: <Books size={14} /> },
                { label: course.name }
              ]} />
            </div>

            {/* Title and share, as before. */}
            <div className="pb-4 flex flex-col md:flex-row justify-between items-start md:items-end gap-3">
              <div className="min-w-0">
                <h1 className="text-3xl max-sm:text-[26px] max-sm:leading-tight font-bold tracking-tight text-neutral-900" dir="auto" lang={contentAttrs.lang}>
                  {course.name}
                </h1>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-neutral-500">
                  <span className="inline-flex items-center gap-1.5">
                    <Stack size={15} className="text-neutral-400" />
                    {t('learner.course.contents', {
                      defaultValue: '{{chapters}} chapters · {{activities}} activities',
                      chapters: chapters.length,
                      activities: totalActivityCount,
                    })}
                  </span>
                  {updatedLabel && (
                    <span className="inline-flex items-center gap-1.5">
                      <ClockCounterClockwise size={15} className="text-neutral-400" />
                      {t('learner.course.updated', { defaultValue: 'Updated {{when}}', when: updatedLabel })}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 min-w-0">
                <ContentLanguageSwitcher course={course} onChange={contentLang.setLanguage} />
                <ShareCourseInMessagesButton orgslug={orgslug} courseUuid={`course_${courseuuid}`} />
                <CourseShare
                  courseUuid={course.course_uuid}
                  courseName={course.name}
                  courseUrl={getUriWithOrg(orgslug, `/course/${courseuuid}`)}
                />
              </div>
            </div>

            <div className="flex flex-col md:flex-row gap-6 md:gap-8">
              {/* Main column: the big thumbnail, progress if started, then the description. */}
              <div className="w-full md:w-3/4 min-w-0 space-y-5">
                {renderMedia()}
                {courseRun && (
                  <div className="bg-white rounded-2xl nice-shadow px-4 py-3">
                    <ActivityIndicators course_uuid={course.course_uuid} orgslug={orgslug} course={course} trailData={trailData} />
                  </div>
                )}
                {course.about && (
                  <div {...contentAttrs}>
                    <LinkifiedText
                      text={course.about}
                      className="whitespace-pre-line break-words leading-relaxed text-neutral-700 text-pretty"
                    />
                  </div>
                )}
              </div>

              {/* Side column: start / continue, paths, authors and updates. */}
              <aside className="w-full md:w-1/4 min-w-0 space-y-4">
                <CoursesActions courseuuid={courseuuid} orgslug={orgslug} course={course} trailData={trailData} />
                <CoursePaths courseUuid={course.course_uuid} orgslug={orgslug} />
                <div className="bg-white rounded-2xl nice-shadow p-4">
                  <p className="text-xs font-semibold text-neutral-400 mb-3">{t('courses.authors_and_updates')}</p>
                  <CourseProvider courseuuid={course.course_uuid} lang={contentLang.lang || undefined}>
                    <CourseAuthors authors={course.authors} />
                  </CourseProvider>
                </div>
              </aside>
            </div>

            <div className="mt-10 space-y-10">
                {displayLearnings.length > 0 && (
                  <section aria-labelledby="course-learnings">
                    <h2 id="course-learnings" className="text-lg font-bold text-neutral-900">{t('courses.what_you_will_learn')}</h2>
                    <ul {...contentAttrs} className="mt-3 grid sm:grid-cols-2 gap-x-6 gap-y-3 bg-white rounded-2xl nice-shadow p-5">
                      {displayLearnings.map((learning: any) => {
                        const learningText = typeof learning === 'string' ? learning : learning.text
                        const learningId = typeof learning === 'string' ? learning : learning.id || learning.text
                        return (
                          <li key={learningId} className="flex items-start gap-2.5 text-sm text-neutral-700">
                            <Check size={16} weight="bold" className="mt-0.5 shrink-0 text-teal-500" aria-hidden="true" />
                            <span className="min-w-0">
                              {learningText}
                              {learning.link && (
                                <a
                                  href={learning.link}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="ms-1 inline-flex align-middle text-neutral-400 hover:text-neutral-900"
                                >
                                  <span className="sr-only">{learningText}</span>
                                  <ArrowSquareOut size={13} />
                                </a>
                              )}
                            </span>
                          </li>
                        )
                      })}
                    </ul>
                  </section>
                )}

                {/* Lessons */}
                <section aria-labelledby="course-lessons">
                  <div className="flex items-end justify-between gap-3">
                    <div>
                      <h2 id="course-lessons" className="text-lg font-bold text-neutral-900">{t('courses.course_lessons')}</h2>
                      <p className="text-sm text-neutral-500">
                        {t('learner.course.contents', {
                          defaultValue: '{{chapters}} chapters · {{activities}} activities',
                          chapters: chapters.length,
                          activities: totalActivityCount,
                        })}
                      </p>
                    </div>
                    {chapters.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setAllChapters(!allChaptersExpanded)}
                        className={buttonClass('ghost', 'md')}
                      >
                        {allChaptersExpanded ? t('shortcuts.collapse_chapters') : t('shortcuts.expand_chapters')}
                        <Keys keys="e" tone="muted" className="max-sm:hidden" />
                      </button>
                    )}
                  </div>

                  {nextDrip && (
                    <div
                      data-testid="drip-banner"
                      className="mt-3 flex items-center gap-3 rounded-2xl bg-amber-50 ring-1 ring-inset ring-amber-200/70 px-4 py-3 text-sm text-amber-800"
                    >
                      <div className="w-8 h-8 rounded-lg bg-white ring-1 ring-inset ring-amber-200 text-amber-600 flex items-center justify-center shrink-0">
                        <DripIcon reason={nextDrip.drip_reason} size={16} />
                      </div>
                      <div className="min-w-0 grow">
                        <div className="font-semibold">{t('course.drip.banner_title', 'New chapters are released over time')}</div>
                        <div className="text-amber-700/90 truncate">
                          {t('course.drip.banner_next', {
                            defaultValue: 'Next up: {{name}}. {{when}}',
                            name: nextDrip.name,
                            when: [dripLabel(nextDrip).label, dripLabel(nextDrip).detail].filter(Boolean).join(' · '),
                          })}
                        </div>
                      </div>
                      {datedReleases.length > 0 && (
                        <button type="button" data-testid="drip-calendar" onClick={downloadReleaseCalendar} className={buttonClass('secondary', 'sm', 'shrink-0')}>
                          <CalendarPlus size={13} />
                          <span className="hidden sm:inline">{t('course.drip.add_to_calendar', 'Add to calendar')}</span>
                        </button>
                      )}
                    </div>
                  )}

                  <div className="mt-3 bg-white rounded-2xl nice-shadow divide-y divide-neutral-100 overflow-hidden">
                    {chapters.map((chapter: any, idx: number) => {
                      const isExpanded = expandedChapters[chapter.chapter_uuid] ?? idx === 0
                      const activities: any[] = Array.isArray(chapter.activities) ? chapter.activities : []
                      const done = activities.filter((a: any) => isActivityDone(a)).length
                      const panelId = `chapter-panel-${idx}`
                      return (
                        <div key={chapter.chapter_uuid || `chapter-${chapter.name}`}>
                          <button
                            type="button"
                            aria-expanded={isExpanded}
                            aria-controls={panelId}
                            onClick={() => setExpandedChapters((prev) => ({ ...prev, [chapter.chapter_uuid]: !isExpanded }))}
                            className="w-full flex items-center gap-3 px-4 sm:px-5 py-4 text-start hover:bg-neutral-50/70 transition-colors"
                          >
                            <span
                              className={`w-7 h-7 shrink-0 rounded-full flex items-center justify-center text-xs font-bold tabular-nums ${
                                activities.length > 0 && done === activities.length ? 'lh-t-solid bg-teal-500 text-white' : 'bg-neutral-100 text-neutral-600'
                              }`}
                            >
                              {activities.length > 0 && done === activities.length ? <Check size={13} weight="bold" /> : idx + 1}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                <h3 className="text-[15px] font-semibold text-neutral-900 truncate min-w-0" lang={contentAttrs.lang} dir="auto">
                                  <ChapterEmoji chapter={chapter} />
                                  {chapter.name}
                                </h3>
                                {chapter.drip_locked ? (
                                  <DripBadge drip_reason={chapter.drip_reason} drip_unlock_at={chapter.drip_unlock_at} drip_closes_at={chapter.drip_closes_at} />
                                ) : chapter.drip_closes_at && !chapter.is_locked ? (
                                  <DripUntilBadge closesAt={chapter.drip_closes_at} />
                                ) : chapter.is_locked ? (
                                  <Chip tone="rose" icon={<LockSimple size={11} />}>{t('course.locked', 'Locked')}</Chip>
                                ) : null}
                              </span>
                              <span className="block text-xs text-neutral-500 tabular-nums">
                                {courseRun
                                  ? t('learner.course.chapter_progress', { defaultValue: '{{done}} of {{total}} done', done, total: activities.length })
                                  : `${activities.length} ${t('activities.activities')}`}
                              </span>
                            </span>
                            <CaretDown size={14} className={`shrink-0 text-neutral-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                          </button>
                          {isExpanded && (
                            <ul id={panelId} className="pb-2 px-2 sm:px-3">
                              {activities.map((activity: any) => {
                                const locked = !!activity.is_locked
                                const dripped = locked && !!chapter.drip_locked
                                const current = isActivityCurrent(activity)
                                const row = (
                                  <span className="flex items-center gap-3">
                                    <span className="w-5 flex justify-center shrink-0">{activityStatus(activity, chapter)}</span>
                                    <span className="min-w-0 flex-1">
                                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                        <span className={`text-sm font-medium ${locked ? 'text-neutral-400' : 'text-neutral-800'}`} lang={activity.locale || contentAttrs.lang} dir="auto">{activity.name}</span>
                                        {locked && !dripped && <Chip tone="rose" icon={<LockSimple size={11} />}>{t('course.locked', 'Locked')}</Chip>}
                                        {!locked && paidState[activity.activity_uuid] === 'locked' && (
                                          <Chip tone="amber" icon={<Diamond size={11} />}>{t('payments.paid_lesson', 'Paid')}</Chip>
                                        )}
                                        {!locked && paidState[activity.activity_uuid] === 'free_preview' && (
                                          <Chip tone="emerald" icon={<Eye size={11} />}>{t('payments.free_preview', 'Free preview')}</Chip>
                                        )}
                                        {!locked && current && <Chip tone="sky">{t('activities.current')}</Chip>}
                                      </span>
                                      <span className="mt-0.5 flex items-center gap-1 text-xs text-neutral-400">
                                        <ActivityTypeGlyph activity={activity} size={12} />
                                        {getActivityTypeLabel(activity.activity_type, activity.activity_sub_type)}
                                      </span>
                                    </span>
                                    {!locked && <CaretRight size={14} className="shrink-0 text-neutral-300 group-hover:text-neutral-500 rtl:rotate-180" />}
                                  </span>
                                )
                                return (
                                  <li key={activity.activity_uuid}>
                                    {locked ? (
                                      <div
                                        className="block rounded-xl px-3 py-2.5 cursor-not-allowed select-none"
                                        title={dripped ? dripLabel(chapter).label : t('course.activity_locked_hint', 'Sign in or join the right user group to unlock this.')}
                                      >
                                        {row}
                                      </div>
                                    ) : (
                                      <Link
                                        href={getUriWithOrg(orgslug, '') + `/course/${courseuuid}/activity/${activity.activity_uuid.replace('activity_', '')}`}
                                        prefetch={false}
                                        aria-current={current ? 'page' : undefined}
                                        className="group block rounded-xl px-3 py-2.5 hover:bg-neutral-50 transition-colors"
                                        onMouseEnter={() => handleActivityMouseEnter(activity)}
                                      >
                                        {row}
                                      </Link>
                                    )}
                                  </li>
                                )
                              })}
                            </ul>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </section>

                <Suspense fallback={<div className="animate-pulse h-48 bg-neutral-100 rounded-2xl" />}>
                  <CourseCommunitySection courseUuid={course.course_uuid} orgslug={orgslug} />
                </Suspense>
            </div>
          </GeneralWrapperStyled>

          {/* Room for the start / continue button docked on phones. */}
          <div className="md:hidden h-16" />
        </>
      )}
    </>
  )
}

export default CourseClient