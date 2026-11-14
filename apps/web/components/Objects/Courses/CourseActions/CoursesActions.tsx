import React, { useEffect, useRef, useState } from 'react'
import { removeCourse, startCourse } from '@services/courses/activity'
import { revalidateTags, asArray } from '@services/utils/ts/requests'
import { useRouter } from 'next/navigation'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getUriWithOrg } from '@services/config/config'
import { getOffersByResource } from '@ee/services/payments/offers'
import { getResourcePaywall } from '@ee/services/payments/access'
import { ArrowRight, BookOpen, CheckCircle, Hourglass, Medal, PencilSimpleLine, Play, SignOut, UserPlus } from '@phosphor-icons/react'
import { Button, buttonClass, Chip } from '@components/Dashboard/Shared/DashKit/DashKit'
import { useCourseCertification } from '@components/Hooks/useCourseCertification'
import { OfferCard } from '@ee/components/Payments/OfferCard'
import CourseTeamOffer, { useTeamSeatOffers } from '@ee/components/Companies/CourseTeamOffer'
import { useShortcut } from '@/lib/shortcuts/ShortcutsContext'
import { Keys } from '@components/Objects/Shortcuts/Kbd'
import { applyForContributor } from '@services/courses/courses'
import toast from 'react-hot-toast'
import { useContributorStatus } from '../../../../hooks/useContributorStatus'
import CourseProgress from '../CourseProgress/CourseProgress'
import { useOrg, useOrgMembership } from '@components/Contexts/OrgContext'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { prefetchRouteFull } from '@/lib/navigation/prefetchRoute'
import { activityQueryOptions } from '@/hooks/queries/useActivity'
import { useContentLanguage } from '@/hooks/useContentLanguage'
import { useTranslation } from 'react-i18next'
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics'

interface CourseRun {
  status: string
  course_id: string
  steps: Array<{
    activity_id: string
    complete: boolean
  }>
}

interface Course {
  id: string
  course_uuid: string
  trail?: {
    runs: CourseRun[]
  }
  chapters?: Array<{
    name: string
    activities: Array<{
      activity_uuid: string
      name: string
      activity_type: string
    }>
  }>
  open_to_contributors?: boolean
}

const CARD = 'lh-t-card bg-white rounded-2xl nice-shadow p-5'

interface CourseActionsProps {
  courseuuid: string
  orgslug: string
  course: Course & {
    org_id: number
  }
  trailData?: any
}

function CoursesActions({ courseuuid, orgslug, course, trailData }: CourseActionsProps) {
  const { t } = useTranslation()
  const router = useRouter()
  const session = useLHSession() as any
  const [isActionLoading, setIsActionLoading] = useState(false)
  const [isContributeLoading, setIsContributeLoading] = useState(false)
  const { contributorStatus, refetch } = useContributorStatus(courseuuid)
  const [isProgressOpen, setIsProgressOpen] = useState(false)
  const org = useOrg() as any
  const { isUserPartOfTheOrg } = useOrgMembership()
  const queryClient = useQueryClient()
  const { track } = useLHAnalytics('learner')
  const { isEnabled: showCertificate } = useCourseCertification(course?.course_uuid)
  // Phones: the start / continue button docks to the bottom edge once the
  // actions box has scrolled away, so the next step is always under the thumb.
  const boxRef = useRef<HTMLDivElement | null>(null)
  const [boxVisible, setBoxVisible] = useState(true)
  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const observer = new IntersectionObserver(([entry]) => setBoxVisible(entry.isIntersecting))
    observer.observe(el)
    return () => observer.disconnect()
  })

  // Clean up course UUID by removing 'course_' prefix if it exists
  const cleanCourseUuid = course.course_uuid?.replace('course_', '');
  const resourceUuid = cleanCourseUuid ? `course_${cleanCourseUuid}` : null;

  const isStarted = trailData?.runs?.find(
    (run: any) => {
      const cleanRunCourseUuid = run.course?.course_uuid?.replace('course_', '');
      return cleanRunCourseUuid === cleanCourseUuid;
    }
  ) ?? false;

  // `s` starts the course, or resumes it at the first lesson not yet done.
  const resumeCourse = () => {
    const run = isStarted || null
    const doneIds = new Set<number>(
      (run?.steps ?? []).filter((step: any) => step.complete).map((step: any) => step.activity_id),
    )
    const flat: any[] = (course.chapters ?? []).flatMap((chapter: any) => chapter.activities ?? [])
    const target = flat.find((activity: any) => !doneIds.has(activity.id)) ?? flat[0]
    if (!target) return
    router.push(
      getUriWithOrg(orgslug, '') +
        `/course/${cleanCourseUuid}/activity/${target.activity_uuid.replace('activity_', '')}`,
    )
  }
  // The start / continue button leads to one lesson: warm that page and its
  // data while the learner reads the course page, so the click is instant.
  const warmTarget: string | undefined = (() => {
    if (!session.data?.user || !isUserPartOfTheOrg) return undefined
    const doneIds = new Set<number>(
      ((isStarted || null)?.steps ?? []).filter((step: any) => step.complete).map((step: any) => step.activity_id),
    )
    const flat: any[] = (course.chapters ?? []).flatMap((chapter: any) => chapter.activities ?? [])
    const target = flat.find((activity: any) => !doneIds.has(activity.id)) ?? flat[0]
    return target?.activity_uuid?.replace('activity_', '')
  })()
  const warmToken = session.data?.tokens?.access_token
  const { lang: contentLang, ready: contentLangReady } = useContentLanguage()
  useEffect(() => {
    if (!warmTarget || !cleanCourseUuid || !contentLangReady) return
    prefetchRouteFull(router, getUriWithOrg(orgslug, '') + `/course/${cleanCourseUuid}/activity/${warmTarget}`)
    queryClient.prefetchQuery(activityQueryOptions(warmTarget, warmToken, contentLang || undefined))
  }, [warmTarget, cleanCourseUuid, orgslug, warmToken, router, queryClient, contentLang, contentLangReady])

  useShortcut(
    {
      id: 'course.start',
      keys: 's',
      label: isStarted ? t('shortcuts.continue_course') : t('shortcuts.start_course'),
      group: 'page',
      run: () => {
        if (isStarted) resumeCourse()
        else if (!isActionLoading) handleCourseAction()
      },
    },
    !!session.data?.user && isUserPartOfTheOrg && !!course?.chapters,
  )

  // Public endpoint: no auth needed, works for unauthenticated visitors too
  const { data: offersResult, isLoading } = useQuery({
    queryKey: ['offers', 'by-resource', org?.id, resourceUuid],
    queryFn: () => getOffersByResource(org.id, resourceUuid!),
    enabled: !!org && !!resourceUuid,
    staleTime: 60_000,
  });
  const linkedOffers: any[] = asArray(offersResult);
  // Team plans (EE company seats) that sell this course: a course sold only to
  // teams has no listed offer but is still paid.
  const teamOffers = useTeamSeatOffers(org?.id, resourceUuid ?? undefined)
  const isSold = linkedOffers.length > 0 || teamOffers.length > 0

  // Whether this viewer already has paid access (bought it, was granted it, or
  // manages it). Starting the course is a separate step from buying it.
  const accessToken = session.data?.tokens?.access_token
  const { data: paywallResult } = useQuery({
    queryKey: ['payments', org?.id, 'paywall', resourceUuid, !!accessToken],
    queryFn: () => getResourcePaywall(org.id, resourceUuid!, accessToken),
    enabled: !!org && !!resourceUuid && !!accessToken && isSold,
    staleTime: 30_000,
  });
  const hasPaidAccess = !!paywallResult?.success && paywallResult.data?.locked === false;

  const handleCourseAction = async () => {
    if (!session.data?.user) {
      track(AnalyticsEvent.CourseSignupPrompted, {
        reason: 'unauthenticated',
        intended_action: isStarted ? 'leave_course' : 'start_course',
      })
      router.push(getUriWithOrg(orgslug, '/signup'))
      return
    }

    // Check if user is part of the organization
    if (!isUserPartOfTheOrg) {
      router.push(getUriWithOrg(orgslug, '/signup'))
      return
    }

    setIsActionLoading(true)
    const loadingToast = toast.loading(
      isStarted ? t('courses.leave_course') + '...' : t('courses.start_course') + '...'
    )

    try {
      if (isStarted) {
        await removeCourse('course_' + courseuuid, orgslug, session.data?.tokens?.access_token)
        if (org?.id) queryClient.invalidateQueries({ queryKey: queryKeys.trail.org(org.id) })
        track(AnalyticsEvent.CourseLeft, { course_uuid: cleanCourseUuid })
        toast.success(t('courses.leave_course_success'), { id: loadingToast })
      } else {
        await startCourse('course_' + courseuuid, orgslug, session.data?.tokens?.access_token)
        if (org?.id) queryClient.invalidateQueries({ queryKey: queryKeys.trail.org(org.id) })
        track(AnalyticsEvent.CourseStarted, {
          course_uuid: cleanCourseUuid,
          total_activities: course.chapters?.reduce((acc: number, chapter: any) => acc + chapter.activities.length, 0) || 0,
          has_offers: linkedOffers.length > 0,
        })
        toast.success(t('courses.start_course_success'), { id: loadingToast })

        // Get the first activity from the first chapter
        const firstChapter = course.chapters?.[0]
        const firstActivity = firstChapter?.activities?.[0]

        if (firstActivity) {
          // Redirect to the first activity
          router.push(
            getUriWithOrg(orgslug, '') +
            `/course/${courseuuid}/activity/${firstActivity.activity_uuid.replace('activity_', '')}`
          )
        }
      }
    } catch (error) {
      console.error('Failed to perform course action:', error)
      toast.error(
        isStarted
          ? t('courses.leave_course_error')
          : t('courses.start_course_error'),
        { id: loadingToast }
      )
    } finally {
      setIsActionLoading(false)
    }
  }

  const handleApplyToContribute = async () => {
    if (!session.data?.user) {
      router.push(getUriWithOrg(orgslug, '/signup'))
      return
    }

    setIsContributeLoading(true)
    const loadingToast = toast.loading(t('courses.submitting_contributor_application'))

    try {
      const data = {
        message: "I would like to contribute to this course."
      }

      await applyForContributor('course_' + courseuuid, data, session.data?.tokens?.access_token)
      await revalidateTags(['courses'], orgslug)
      await refetch()
      track(AnalyticsEvent.ContributorApplicationSubmitted, { course_uuid: cleanCourseUuid })
      toast.success(t('courses.contributor_application_success'), { id: loadingToast })
    } catch (error) {
      console.error('Failed to apply as contributor:', error)
      toast.error(t('courses.contributor_application_error'), { id: loadingToast })
    } finally {
      setIsContributeLoading(false)
    }
  }

  const totalActivities = course.chapters?.reduce((acc: number, chapter: any) => acc + (chapter.activities?.length ?? 0), 0) || 0
  const chapterCount = course.chapters?.length ?? 0
  const run = isStarted || null
  const completedActivities = (run?.steps ?? []).filter((step: any) => step.complete).length
  const progressPercentage = totalActivities > 0 ? Math.round((completedActivities / totalActivities) * 100) : 0
  const isCourseCompleted = totalActivities > 0 && completedActivities >= totalActivities

  const openProgress = () => {
    track(AnalyticsEvent.CourseProgressViewed, {
      course_uuid: cleanCourseUuid,
      completed_activities: completedActivities,
      total_activities: totalActivities,
      progress_percentage: progressPercentage,
    })
    setIsProgressOpen(true)
  }

  // Contributor status as a small chip, or a quiet "apply" button.
  const renderContributor = () => {
    if (contributorStatus === 'INACTIVE' || course.open_to_contributors !== true) return null
    if (!session.data?.user) {
      return (
        <Button
          size="sm"
          variant="ghost"
          icon={<PencilSimpleLine size={13} />}
          onClick={() => router.push(getUriWithOrg(orgslug, '/signup'))}
          aria-label={t('auth.sign_up_to_contribute')}
        >
          {t('auth.authenticate_to_contribute')}
        </Button>
      )
    }
    if (contributorStatus === 'ACTIVE') {
      return <Chip tone="emerald" icon={<PencilSimpleLine size={12} />}>{t('courses.you_are_contributor')}</Chip>
    }
    if (contributorStatus === 'PENDING') {
      return <Chip tone="amber" icon={<Hourglass size={12} />}>{t('courses.contributor_application_pending')}</Chip>
    }
    return (
      <Button
        size="sm"
        variant="ghost"
        icon={<PencilSimpleLine size={13} />}
        loading={isContributeLoading}
        onClick={handleApplyToContribute}
        aria-label={t('courses.apply_to_contribute')}
      >
        {t('courses.apply_to_contribute')}
      </Button>
    )
  }

  // Progress, or what the course holds before starting.
  const renderProgress = () =>
    isStarted ? (
      <button
        type="button"
        onClick={openProgress}
        aria-label={t('courses.view_course_progress', { completed: completedActivities, total: totalActivities })}
        className="w-full text-start rounded-xl -m-1 p-1 hover:bg-neutral-50 transition-colors"
      >
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-sm font-semibold text-neutral-900">{t('courses.course_progress')}</span>
          <span className="text-sm font-semibold tabular-nums text-neutral-900">{progressPercentage}%</span>
        </div>
        <div className="mt-2 h-2 rounded-full bg-neutral-100 overflow-hidden">
          <div className="lh-t-progress h-full rounded-full bg-teal-500 transition-[width] duration-500" style={{ width: `${progressPercentage}%` }} />
        </div>
        <p className="mt-1.5 text-xs text-neutral-500 tabular-nums">
          {t('courses.completed_of', { completed: completedActivities, total: totalActivities })}
        </p>
      </button>
    ) : (
      <div className="flex items-start gap-3">
        <span className="w-9 h-9 shrink-0 rounded-xl bg-neutral-100 text-neutral-500 flex items-center justify-center">
          <BookOpen size={18} />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-neutral-900">{t('courses.ready_to_begin')}</p>
          <p className="text-xs text-neutral-500">
            {t('learner.course.contents', {
              defaultValue: '{{chapters}} chapters · {{activities}} activities',
              chapters: chapterCount,
              activities: totalActivities,
            })}
          </p>
        </div>
      </div>
    )

  const certificateHint = showCertificate ? (
    <div className="flex items-center gap-2 text-xs text-neutral-500">
      <Medal size={15} className={isCourseCompleted ? 'text-amber-500' : 'text-neutral-400'} />
      {isCourseCompleted
        ? t('courses.course_completed_exclamation')
        : t('learner.course.certificate_hint', 'Finish every activity to earn a certificate.')}
    </div>
  ) : null

  const leaveButton = (
    <Button
      size="sm"
      variant="danger-ghost"
      icon={<SignOut size={13} className="rtl:rotate-180" />}
      onClick={handleCourseAction}
      loading={isActionLoading}
      aria-label={t('courses.leave_course')}
    >
      {t('courses.leave_course')}
    </Button>
  )

  if (isLoading) {
    return <div className="animate-pulse h-40 bg-white rounded-2xl nice-shadow" />
  }

  // Show join organization prompt for authenticated users who are not part of the org
  if (session.data?.user && !isUserPartOfTheOrg) {
    return (
      <div className={CARD}>
        <div className="flex items-start gap-3">
          <span className="w-9 h-9 shrink-0 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
            <UserPlus size={18} />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-neutral-900">{t('courses.join_org_required')}</p>
            <p className="mt-0.5 text-xs text-neutral-500">{t('courses.join_org_required_description')}</p>
          </div>
        </div>
        <a href={getUriWithOrg(orgslug, '/signup')} className={buttonClass('primary', 'lg', 'w-full mt-4')}>
          <UserPlus size={15} />
          {t('courses.join_organization')}
        </a>
      </div>
    )
  }

  if (isSold && !(hasPaidAccess && !isStarted)) {
    // User already enrolled / started: show "you own this" notice + continue
    // (not for someone who started it before it was sold and has no access).
    if (isStarted && (hasPaidAccess || !accessToken || !paywallResult?.success)) {
      return (
        <div className={CARD}>
          <Chip tone="emerald" icon={<CheckCircle size={12} weight="fill" />}>{t('courses.you_own_this_course')}</Chip>
          <p className="mt-2 text-xs text-neutral-500">{t('courses.you_own_this_course_description')}</p>
          <div className="mt-4">{renderProgress()}</div>
          <Button variant="primary" size="lg" className="w-full mt-4" onClick={resumeCourse} icon={<Play size={14} weight="fill" />}>
            {t('shortcuts.continue_course')}
            <Keys keys="s" tone="onDark" className="max-sm:hidden ms-1" />
          </Button>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            {renderContributor()}
            {leaveButton}
          </div>
          <CourseProgress course={course} orgslug={orgslug} isOpen={isProgressOpen} onClose={() => setIsProgressOpen(false)} trailData={trailData} />
        </div>
      )
    }

    // Not enrolled: show all available offers
    return (
      <div className="space-y-3">
        {linkedOffers.length > 1 && (
          <p className="text-xs text-neutral-400 font-medium px-1">
            {t('learner.course.offer_count', { defaultValue: '{{count}} options available', count: linkedOffers.length })}
          </p>
        )}
        {linkedOffers.map((offer: any) => (
          <OfferCard key={offer.offer_id} offer={offer} orgslug={orgslug} />
        ))}
        {resourceUuid && <CourseTeamOffer orgId={org.id} orgslug={orgslug} resourceUuid={resourceUuid} alone={linkedOffers.length === 0} />}
        <div className="flex flex-wrap gap-2">{renderContributor()}</div>
      </div>
    )
  }

  return (
    <div ref={boxRef} className={CARD}>
      {totalActivities > 0 && (
        <div
          aria-hidden={boxVisible}
          className={`md:hidden fixed inset-x-0 px-4 pt-6 pb-3 bg-gradient-to-t from-white via-white/90 to-transparent transition-all duration-300 ease-out ${
            boxVisible ? 'pointer-events-none translate-y-4 opacity-0' : 'translate-y-0 opacity-100'
          }`}
          style={{ bottom: 'var(--lh-mobile-nav-h)', zIndex: 'var(--z-sticky)' }}
        >
          <button
            type="button"
            tabIndex={boxVisible ? -1 : 0}
            onClick={() => (isStarted ? resumeCourse() : handleCourseAction())}
            disabled={isActionLoading}
            className="lh-t-btn lh-press flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-neutral-900 text-[15px] font-semibold text-white shadow-lg shadow-black/15"
          >
            {isStarted ? t('shortcuts.continue_course') : t('courses.start_course')}
            <ArrowRight size={18} className="rtl:rotate-180" />
          </button>
        </div>
      )}

      {renderProgress()}

      {/* Start, or continue where the learner left off. Leaving is secondary. */}
      {isStarted ? (
        <Button variant="primary" size="lg" className="w-full mt-4" onClick={resumeCourse} icon={<Play size={14} weight="fill" />}>
          {t('shortcuts.continue_course')}
          <Keys keys="s" tone="onDark" className="max-sm:hidden ms-1" />
        </Button>
      ) : (
        <Button
          variant="primary"
          size="lg"
          className="w-full mt-4"
          onClick={handleCourseAction}
          loading={isActionLoading}
          aria-label={t('courses.start_course')}
          icon={!isActionLoading ? <Play size={14} weight="fill" /> : undefined}
        >
          {t('courses.start_course')}
          <Keys keys="s" tone="onDark" className="max-sm:hidden ms-1" />
        </Button>
      )}

      {(certificateHint || isStarted || course.open_to_contributors) && (
        <div className="mt-4 pt-4 border-t border-neutral-100 space-y-3">
          {certificateHint}
          <div className="flex flex-wrap items-center justify-between gap-2">
            {renderContributor()}
            {isStarted && leaveButton}
          </div>
        </div>
      )}

      {/* Course Progress Modal */}
      <CourseProgress
        course={course}
        orgslug={orgslug}
        isOpen={isProgressOpen}
        onClose={() => setIsProgressOpen(false)}
        trailData={trailData}
      />
    </div>
  )
}

export default CoursesActions
