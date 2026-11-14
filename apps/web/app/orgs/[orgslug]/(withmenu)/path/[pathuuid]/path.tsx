'use client'

import React, { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import {
  ArrowRight,
  Check,
  CheckCircle,
  Circuitry,
  Flag,
  FlagCheckered,
  GitFork,
  Lock,
  LockSimple,
  Medal,
  PencilSimpleLine,
  SignOut,
} from '@phosphor-icons/react'
import toast from 'react-hot-toast'
import GeneralWrapperStyled from '@components/Objects/StyledElements/Wrappers/GeneralWrapper'
import FeatureGate from '@components/Dashboard/Shared/FeatureGate/FeatureGate'
import { Breadcrumbs } from '@components/Objects/Breadcrumbs/Breadcrumbs'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import AuthenticatedClientElement from '@components/Security/AuthenticatedClientElement'
import CertificatePreview from '@components/Dashboard/Pages/Course/EditCourseCertification/CertificatePreview'
import { courseCardThumbnail } from '@components/Objects/Thumbnails/CourseCard'
import ThumbnailImage from '@components/Objects/Thumbnails/ThumbnailImage'
import { Chip, buttonClass } from '@components/Dashboard/Shared/DashKit/DashKit'
import { PathProgressBar, PathTrack, TRACK_STRIP, nextCourse as findNext, pathShape } from '@components/Objects/Paths/PathTrack'
import { getUriWithOrg } from '@services/config/config'
import { getPathThumbnailMediaDirectory } from '@services/media/media'
import { enrollInPath, leavePath, Path, PathCourseItem, removePathPrefix } from '@services/paths/paths'
import { getErrorMessage } from '@services/utils/ts/errorMessage'
import { queryKeys } from '@/lib/query/keys'
import { usePath } from '@/hooks/queries/usePaths'
import { useTrackView, AnalyticsEvent } from '@services/analytics'
import { coursePath } from '@/lib/seo/paths'

const CARD = 'bg-white nice-shadow rounded-2xl'

export default function PathClient({ orgslug, pathuuid }: { orgslug: string; pathuuid: string }) {
  const { t } = useTranslation()
  const { data: path, isLoading, isError } = usePath(`path_${pathuuid}`)

  return (
    <FeatureGate feature="paths" orgslug={orgslug} context="public">
      <GeneralWrapperStyled>
        {isLoading && <PathSkeleton />}
        {isError && (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <Circuitry className="w-10 h-10 text-neutral-300 mb-3" />
            <h1 className="text-xl font-bold text-neutral-700">{t('paths.not_found')}</h1>
            <Link href={getUriWithOrg(orgslug, '/paths')} className="mt-4 text-sm font-medium text-neutral-500 hover:text-neutral-900">
              {t('paths.back_to_paths')}
            </Link>
          </div>
        )}
        {path && <PathView path={path} orgslug={orgslug} />}
      </GeneralWrapperStyled>
    </FeatureGate>
  )
}

function courseHref(orgslug: string, item: PathCourseItem) {
  return getUriWithOrg(orgslug, coursePath({ slug: item.course?.slug, course_uuid: item.course_uuid }))
}

function PathView({ path, orgslug }: { path: Path; orgslug: string }) {
  const { t } = useTranslation()
  const org = useOrg() as any
  const session = useLHSession() as any
  const signedIn = session?.status === 'authenticated'

  useTrackView(AnalyticsEvent.PathViewed, { path_uuid: path.path_uuid }, true, 'learner')

  const progress = path.progress
  const enrolled = !!progress?.enrolled
  const completed = !!progress?.completed
  const next = findNext(path, path.courses)
  const shape = pathShape(path, path.courses)
  const cover = path.thumbnail_image
    ? getPathThumbnailMediaDirectory(org?.org_uuid, path.path_uuid, path.thumbnail_image)
    : null
  const about = path.about && path.about.trim() !== (path.description || '').trim() ? path.about : ''

  const cta = usePathCta(path, orgslug, next, signedIn)
  // The bottom bar on phones hides while the CTA in the progress card is on screen.
  const ctaRef = useRef<HTMLDivElement>(null)
  const [ctaVisible, setCtaVisible] = useState(true)
  useEffect(() => {
    const el = ctaRef.current
    if (!el) return
    const io = new IntersectionObserver(([entry]) => setCtaVisible(entry.isIntersecting))
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return (
    <div className="pb-28 lg:pb-10">
      <div className="pb-4">
        <Breadcrumbs
          items={[
            { label: t('paths.title'), href: getUriWithOrg(orgslug, '/paths'), icon: <Circuitry size={14} /> },
            { label: path.name },
          ]}
        />
      </div>

      {/* Hero: cover beside the title, then the whole route at a glance */}
      <section className={`${CARD} overflow-hidden`}>
        <div className="p-4 sm:p-6 flex flex-col md:flex-row gap-5 md:gap-6">
          <ThumbnailImage
            src={cover}
            fetchPriority="high"
            loading="eager"
            className="w-full md:w-72 lg:w-80 aspect-video rounded-xl ring-1 ring-black/5 shrink-0 object-cover"
          />
          <div className="min-w-0 flex-1 flex flex-col gap-3">
            <div className="flex items-start justify-between gap-3">
              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-400 pt-1">
                <Circuitry size={13} weight="bold" />
                {t('paths.detail.eyebrow')}
              </span>
              <AuthenticatedClientElement action="update" ressourceType="courses" checkMethod="roles" orgId={path.org_id}>
                <Link
                  href={getUriWithOrg(orgslug, `/dash/paths/path/${removePathPrefix(path.path_uuid)}/courses`)}
                  className={buttonClass('secondary', 'sm', 'shrink-0')}
                >
                  <PencilSimpleLine size={13} />
                  {t('paths.detail.edit_path')}
                </Link>
              </AuthenticatedClientElement>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-neutral-900 leading-tight" dir="auto">
              {path.name}
            </h1>
            {path.description && (
              <p className="text-sm sm:text-[15px] text-neutral-600 leading-relaxed text-pretty" dir="auto">
                {path.description}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-1.5 mt-auto pt-1">
              {enrolled &&
                (completed ? (
                  <Chip tone="emerald" icon={<CheckCircle size={12} weight="fill" />}>
                    {t('paths.completed')}
                  </Chip>
                ) : (
                  <Chip tone="sky">{t('paths.in_progress')}</Chip>
                ))}
              <Chip tone="neutral">{path.level ? t(`paths.levels.${path.level}`) : t('paths.levels.all')}</Chip>
              {path.sequential && (
                <Chip tone="neutral" icon={<LockSimple size={12} />}>
                  {t('paths.guided_order')}
                </Chip>
              )}
              {path.certificate_enabled && (
                <Chip tone="amber" icon={<Medal size={12} weight="fill" />}>
                  {t('paths.certificate_included')}
                </Chip>
              )}
              {shape.electives > 0 && shape.electivesNeeded > 0 && (
                <Chip tone="violet" icon={<GitFork size={12} />}>
                  {t('paths.cards.pick_electives', { count: shape.electivesNeeded, total: shape.electives })}
                </Chip>
              )}
            </div>
          </div>
        </div>
        {path.courses.length > 0 && (
          <div className={`px-4 sm:px-6 py-4 border-t border-neutral-100 ${TRACK_STRIP}`}>
            <PathTrack path={path} courses={path.courses} maxNodes={12} />
          </div>
        )}
      </section>

      <div className="mt-6 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-6 items-start">
        {/* Sidebar first on phones so the progress and CTA come right after the hero */}
        <aside className="lg:order-2 lg:sticky lg:top-[calc(6rem+var(--lh-company-bar-h,0px))] space-y-4">
          <ProgressCard path={path} shape={shape} cta={cta} ctaRef={ctaRef} />
          {path.certificate_enabled && <CertificateCard path={path} orgslug={orgslug} />}
        </aside>

        <div className="lg:order-1 min-w-0 space-y-6">
          {about && (
            <section className={`${CARD} p-5 sm:p-6`}>
              <h2 className="text-base font-bold text-neutral-900 mb-2">{t('paths.detail.about')}</h2>
              <p className="text-sm text-neutral-600 whitespace-pre-line break-words leading-relaxed text-pretty" dir="auto">
                {about}
              </p>
            </section>
          )}
          <Journey path={path} orgslug={orgslug} next={next} />
        </div>
      </div>

      {/* Phone CTA bar, above the bottom navigation */}
      {cta.node && (
        <div
          className={`lg:hidden fixed inset-x-0 px-4 pt-6 pb-3 bg-gradient-to-t from-white via-white/90 to-transparent transition-all duration-300 ease-out ${
            ctaVisible ? 'pointer-events-none translate-y-4 opacity-0' : 'translate-y-0 opacity-100'
          }`}
          style={{ bottom: 'var(--lh-mobile-nav-h)', zIndex: 'var(--z-sticky)' }}
          aria-hidden={ctaVisible}
        >
          {cta.node(true)}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Journey: the vertical track, one card per course
// ---------------------------------------------------------------------------

function TrackColumn({ node, line, done }: { node: React.ReactNode; line: boolean; done?: boolean }) {
  return (
    <div className="flex flex-col items-center w-10 shrink-0">
      {node}
      {line && (
        <div
          aria-hidden
          className={`flex-1 w-0 min-h-4 border-s-2 ${done ? 'border-solid border-emerald-500' : 'border-dashed border-neutral-300'}`}
        />
      )}
    </div>
  )
}

function Journey({ path, orgslug, next }: { path: Path; orgslug: string; next?: PathCourseItem }) {
  const { t, i18n } = useTranslation()
  const org = useOrg() as any
  const progress = path.progress
  const enrolled = !!progress?.enrolled
  const completed = !!progress?.completed
  const shape = pathShape(path, path.courses)
  const startedOn = progress?.enrolled_at ? new Date(progress.enrolled_at.replace(' ', 'T')) : null
  const startedLabel =
    startedOn && !isNaN(startedOn.getTime())
      ? startedOn.toLocaleDateString(i18n.language, { day: 'numeric', month: 'short', year: 'numeric' })
      : null

  return (
    <section>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div>
          <h2 className="text-lg sm:text-xl font-bold tracking-tight text-neutral-900">{t('paths.detail.journey')}</h2>
          <p className="text-sm text-neutral-500">{t('paths.course_count', { count: shape.total })}</p>
        </div>
        {shape.total > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <Chip tone="sky" icon={<span className="w-2 h-2 rounded-full bg-sky-500" />}>
              {t('paths.dashboard.journey.required_count', { count: shape.required })}
            </Chip>
            {shape.electives > 0 && (
              <Chip tone="violet" icon={<span className="w-2 h-2 rounded-full outline-1 outline-dashed outline-violet-500 bg-white" />}>
                {t('paths.dashboard.journey.elective_count', { count: shape.electives })}
              </Chip>
            )}
          </div>
        )}
      </div>

      {shape.electives > 0 && (
        <div className="mb-5 flex items-start gap-3 rounded-2xl bg-violet-50/70 ring-1 ring-inset ring-violet-200/70 px-4 py-3">
          <span className="w-8 h-8 rounded-xl bg-white text-violet-600 ring-1 ring-violet-200 flex items-center justify-center shrink-0">
            <GitFork size={15} />
          </span>
          <div className="min-w-0 text-sm">
            <p className="font-semibold text-violet-900">
              {shape.electivesNeeded > 0
                ? t('paths.electives_rule', { count: shape.electivesNeeded, total: shape.electives })
                : t('paths.dashboard.journey.elective_count', { count: shape.electives })}
            </p>
            <p className="text-violet-800/80 text-xs mt-0.5">
              {shape.electivesNeeded > 0
                ? t('paths.detail.electives_hint', { count: shape.electivesNeeded })
                : t('paths.detail.electives_optional')}
            </p>
          </div>
        </div>
      )}

      {path.courses.length === 0 ? (
        <div className={`${CARD} p-8 text-center text-sm text-neutral-500`}>{t('paths.no_courses_yet')}</div>
      ) : (
        <ol aria-label={t('paths.courses_in_path')}>
          {/* Start */}
          <li className="flex gap-3 sm:gap-4">
            <TrackColumn
              line
              done={enrolled && !!path.courses[0]?.completed}
              node={
                <span
                  className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 shadow-sm text-white ${
                    enrolled ? 'bg-emerald-500' : 'bg-neutral-900'
                  }`}
                >
                  <Flag size={16} weight="fill" />
                </span>
              }
            />
            <div className="pt-1.5 pb-6 min-w-0">
              <p className="text-xs font-bold uppercase tracking-wider text-neutral-500">{t('paths.dashboard.journey.start')}</p>
              <p className="text-xs text-neutral-400 mt-0.5">
                {enrolled && startedLabel ? t('paths.detail.started_on', { date: startedLabel }) : t('paths.start_hint')}
              </p>
            </div>
          </li>

          {path.courses.map((item, index) => (
            <JourneyStep
              key={item.course_uuid}
              item={item}
              index={index}
              orgslug={orgslug}
              orgUuid={org?.org_uuid}
              enrolled={enrolled}
              isNext={next?.course_uuid === item.course_uuid}
              lineDone={enrolled && !!item.completed && (index + 1 < path.courses.length ? !!path.courses[index + 1].completed : completed)}
            />
          ))}

          {/* Finish */}
          <li className="flex gap-3 sm:gap-4">
            <TrackColumn
              line={false}
              node={
                <span
                  className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                    path.certificate_enabled
                      ? completed
                        ? 'bg-amber-400 text-white shadow-sm'
                        : 'bg-amber-50 text-amber-600 ring-1 ring-amber-200'
                      : completed
                        ? 'bg-emerald-500 text-white shadow-sm'
                        : 'bg-white text-neutral-500 ring-1 ring-neutral-200'
                  }`}
                >
                  {path.certificate_enabled ? <Medal size={17} weight="fill" /> : <FlagCheckered size={16} weight="fill" />}
                </span>
              }
            />
            <div className="pt-1.5 min-w-0">
              <p className="text-xs font-bold uppercase tracking-wider text-neutral-500">{t('paths.dashboard.journey.finish')}</p>
              <p className="text-xs text-neutral-400 mt-0.5">
                {completed
                  ? t('paths.detail.finished')
                  : path.certificate_enabled
                    ? t('paths.certificate_explainer')
                    : t('paths.detail.finish_hint')}
              </p>
              {completed && progress?.certificate_uuid && !progress.certificate_revoked && (
                <Link
                  href={getUriWithOrg(orgslug, `/paths/certificate/${progress.certificate_uuid}`)}
                  className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-amber-700 hover:text-amber-800"
                >
                  <Medal size={13} weight="fill" />
                  {t('paths.view_certificate')}
                  <ArrowRight size={12} weight="bold" className="rtl:rotate-180" />
                </Link>
              )}
            </div>
          </li>
        </ol>
      )}
    </section>
  )
}

function JourneyStep({
  item,
  index,
  orgslug,
  orgUuid,
  enrolled,
  isNext,
  lineDone,
}: {
  item: PathCourseItem
  index: number
  orgslug: string
  orgUuid?: string
  enrolled: boolean
  isNext: boolean
  lineDone: boolean
}) {
  const { t } = useTranslation()
  const course = item.course
  const restricted = !!course.restricted
  const completed = enrolled && item.completed
  const locked = item.locked
  const unpublished = course.published === false
  const blocked = locked || restricted
  const href = courseHref(orgslug, item)
  const thumb = restricted ? null : courseCardThumbnail(orgUuid, { course_uuid: item.course_uuid, name: course.name || '', thumbnail_image: course.thumbnail_image })
  const name = restricted ? t('paths.restricted_course') : course.name

  const node = completed ? (
    <span className="w-10 h-10 rounded-full bg-emerald-500 text-white flex items-center justify-center shrink-0 shadow-sm">
      <Check size={16} weight="bold" />
    </span>
  ) : locked ? (
    <span className="w-10 h-10 rounded-full bg-white text-neutral-400 ring-1 ring-neutral-200 flex items-center justify-center shrink-0">
      <Lock size={15} />
    </span>
  ) : isNext ? (
    <span className="w-10 h-10 rounded-full bg-neutral-900 text-white ring-4 ring-neutral-900/10 flex items-center justify-center shrink-0 text-sm font-bold tabular-nums">
      {index + 1}
    </span>
  ) : item.required ? (
    <span className="w-10 h-10 rounded-full bg-white text-sky-700 ring-2 ring-sky-400 flex items-center justify-center shrink-0 text-sm font-bold tabular-nums">
      {index + 1}
    </span>
  ) : (
    <span className="w-10 h-10 rounded-full bg-violet-50 text-violet-600 outline-2 outline-dashed outline-violet-400 -outline-offset-2 flex items-center justify-center shrink-0 text-sm font-bold tabular-nums">
      {index + 1}
    </span>
  )

  const thumbnail = (
    <ThumbnailImage
      src={thumb}
      className={`w-full h-full object-cover ${blocked || unpublished ? 'grayscale opacity-70' : 'transition-transform duration-500 group-hover/step:scale-[1.04]'}`}
    />
  )

  return (
    <li className="flex gap-3 sm:gap-4">
      <TrackColumn line node={node} done={lineDone} />
      <div className="flex-1 min-w-0 pb-4">
        <div
          className={`group/step ${CARD} p-3 sm:p-4 flex flex-row gap-3 sm:gap-4 transition-shadow ${
            isNext ? 'ring-2 ring-neutral-900' : completed ? 'ring-1 ring-emerald-200' : ''
          } ${unpublished ? 'opacity-60' : ''}`}
        >
          <div className="relative w-24 sm:w-40 self-start aspect-video rounded-xl overflow-hidden ring-1 ring-black/5 bg-neutral-100 shrink-0">
            {blocked ? (
              thumbnail
            ) : (
              <Link href={href} tabIndex={-1} className="block w-full h-full">
                {thumbnail}
              </Link>
            )}
            {locked && (
              <span className="absolute inset-0 flex items-center justify-center">
                <span className="w-8 h-8 rounded-full bg-white/90 text-neutral-600 flex items-center justify-center shadow-sm">
                  <Lock size={14} />
                </span>
              </span>
            )}
          </div>

          <div className="min-w-0 flex-1 flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400 me-0.5">
                {t('paths.dashboard.journey.step', { n: index + 1 })}
              </span>
              {item.required ? (
                <Chip tone="sky" className="!py-0.5 !text-[11px]">
                  {t('paths.required')}
                </Chip>
              ) : (
                <Chip tone="violet" className="!py-0.5 !text-[11px]">
                  {t('paths.elective')}
                </Chip>
              )}
              {completed && (
                <Chip tone="emerald" icon={<Check size={11} weight="bold" />} className="!py-0.5 !text-[11px]">
                  {t('paths.completed')}
                </Chip>
              )}
              {isNext && (
                <Chip tone="neutral" className="!py-0.5 !text-[11px] !bg-neutral-900 !text-white !ring-neutral-900">
                  {t('paths.up_next')}
                </Chip>
              )}
              {unpublished && (
                <Chip tone="neutral" className="!py-0.5 !text-[11px]">
                  {t('paths.draft')}
                </Chip>
              )}
            </div>
            {blocked ? (
              <p className="font-semibold text-neutral-500 leading-snug line-clamp-2" dir="auto">
                {name}
              </p>
            ) : (
              <Link href={href} className="font-semibold text-neutral-900 leading-snug line-clamp-2 hover:underline underline-offset-2" dir="auto">
                {name}
              </Link>
            )}
            {!restricted && course.description && (
              <p className="text-xs text-neutral-500 line-clamp-2" dir="auto">
                {course.description}
              </p>
            )}

            <div className="mt-auto pt-1.5 flex flex-wrap items-center justify-between gap-2">
              {locked ? (
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-neutral-500">
                  <LockSimple size={13} />
                  {t('paths.locked_hint')}
                </span>
              ) : enrolled && item.started && !completed ? (
                <div className="flex items-center gap-2 min-w-0 flex-1 max-w-56">
                  <div className="h-1.5 flex-1 rounded-full bg-neutral-200/80 overflow-hidden">
                    <div className="lh-t-progress h-full rounded-full bg-emerald-500" style={{ width: `${item.progress}%` }} />
                  </div>
                  <span className="text-xs font-semibold text-neutral-600 tabular-nums">{t('paths.percent_done', { percent: item.progress })}</span>
                </div>
              ) : (
                <span />
              )}
              {isNext ? (
                <Link href={href} className={buttonClass('primary', 'sm')}>
                  {item.started ? t('paths.cards.continue') : t('paths.detail.start_course')}
                  <ArrowRight size={13} weight="bold" className="rtl:rotate-180" />
                </Link>
              ) : (
                !blocked && (
                  <Link href={href} className="inline-flex items-center gap-1 text-xs font-semibold text-neutral-500 hover:text-neutral-900">
                    {t('paths.detail.open_course')}
                    <ArrowRight size={12} weight="bold" className="rtl:rotate-180" />
                  </Link>
                )
              )}
            </div>
          </div>
        </div>
      </div>
    </li>
  )
}

// ---------------------------------------------------------------------------
// Sidebar: progress, the one primary action, certificate
// ---------------------------------------------------------------------------

type Cta = {
  /** Renders the primary action; `bar` is the larger phone version. */
  node: ((_bar?: boolean) => React.ReactNode) | null
  leave: (() => void) | null
  busy: boolean
}

function usePathCta(path: Path, orgslug: string, next: PathCourseItem | undefined, signedIn: boolean): Cta {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)
  const accessToken = session?.data?.tokens?.access_token
  const progress = path.progress
  const enrolled = !!progress?.enrolled
  const completed = !!progress?.completed

  const refresh = (updated?: Path) => {
    if (updated) queryClient.setQueryData(queryKeys.paths.detail(path.path_uuid), updated)
    else queryClient.invalidateQueries({ queryKey: queryKeys.paths.detail(path.path_uuid) })
    queryClient.invalidateQueries({ queryKey: queryKeys.paths.list(path.org_id) })
  }

  const run = async (action: () => Promise<void>, fallback: string) => {
    setBusy(true)
    try {
      await action()
    } catch (error: any) {
      toast.error(getErrorMessage(error?.detail, fallback))
    } finally {
      setBusy(false)
    }
  }

  const start = () =>
    run(async () => {
      const updated = await enrollInPath(path.path_uuid, accessToken)
      refresh(updated)
      if (updated.progress?.completed) toast.success(t('paths.toasts.already_completed'))
    }, t('paths.toasts.enroll_error'))

  const leave = () =>
    run(async () => {
      await leavePath(path.path_uuid, accessToken)
      refresh()
    }, t('paths.toasts.save_error'))

  const cls = (bar?: boolean) =>
    bar
      ? 'lh-press flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-neutral-900 text-[15px] font-semibold text-white shadow-lg shadow-black/15 disabled:opacity-70'
      : buttonClass('primary', 'md', 'w-full h-11 justify-center')
  const arrow = <ArrowRight size={16} weight="bold" className="rtl:rotate-180 shrink-0" />

  let node: Cta['node'] = null
  if (!signedIn) {
    const href = getUriWithOrg(orgslug, `/login?redirect=${encodeURIComponent(`/path/${removePathPrefix(path.path_uuid)}`)}`)
    node = (bar) => (
      <Link href={href} className={cls(bar)}>
        {t('paths.sign_in_to_start')}
        {arrow}
      </Link>
    )
  } else if (completed && progress?.certificate_uuid && !progress.certificate_revoked) {
    const href = getUriWithOrg(orgslug, `/paths/certificate/${progress.certificate_uuid}`)
    node = (bar) => (
      <Link href={href} className={cls(bar)}>
        <Medal size={16} weight="fill" />
        {t('paths.view_certificate')}
      </Link>
    )
  } else if (enrolled && next) {
    const href = courseHref(orgslug, next)
    node = (bar) => (
      <Link href={href} className={cls(bar)}>
        <span className="truncate">
          {next.course?.name ? t('paths.detail.continue_with', { name: next.course.name }) : t('paths.continue_learning')}
        </span>
        {arrow}
      </Link>
    )
  } else if (!enrolled) {
    node = (bar) => (
      <button type="button" onClick={start} disabled={busy || path.courses.length === 0} className={cls(bar)}>
        {busy ? (
          <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
        ) : (
          <>
            {t('paths.start_path')}
            {arrow}
          </>
        )}
      </button>
    )
  }

  return { node, leave: enrolled && !completed ? leave : null, busy }
}

function ProgressRing({ value }: { value: number }) {
  const r = 30
  const circumference = 2 * Math.PI * r
  return (
    <svg viewBox="0 0 72 72" className="w-full h-full -rotate-90">
      <circle cx="36" cy="36" r={r} className="stroke-neutral-100" strokeWidth="7" fill="none" />
      <circle
        cx="36"
        cy="36"
        r={r}
        className="stroke-emerald-500 transition-all duration-500 ease-out"
        strokeWidth="7"
        fill="none"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - value / 100)}
      />
    </svg>
  )
}

function MiniStat({ value, label }: { value: React.ReactNode; label: string }) {
  return (
    <div className="min-w-0 px-3 py-2 [&:not(:first-child)]:border-s border-neutral-200/70">
      <p className="text-sm font-bold text-neutral-900 tabular-nums leading-tight">{value}</p>
      <p className="text-[11px] text-neutral-500 truncate">{label}</p>
    </div>
  )
}

function ProgressCard({
  path,
  shape,
  cta,
  ctaRef,
}: {
  path: Path
  shape: ReturnType<typeof pathShape>
  cta: Cta
  ctaRef: React.RefObject<HTMLDivElement | null>
}) {
  const { t } = useTranslation()
  const started = shape.enrolled
  return (
    <div className={`${CARD} p-5 space-y-4`}>
      <div className="flex items-center gap-4">
        <div className="relative w-[72px] h-[72px] shrink-0">
          <ProgressRing value={started ? shape.percent : 0} />
          <div className="absolute inset-0 flex items-center justify-center">
            {started ? (
              <span className="text-lg font-bold text-neutral-900 tabular-nums">{shape.percent}%</span>
            ) : (
              <Circuitry size={24} className="text-neutral-400" />
            )}
          </div>
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-neutral-900">
            {shape.completed ? t('paths.completed') : started ? t('paths.your_progress') : t('paths.ready_to_begin')}
          </p>
          <p className="text-xs text-neutral-500 mt-0.5 leading-relaxed">
            {started ? t('paths.progress_long', { done: shape.done, total: shape.needed }) : t('paths.start_hint')}
          </p>
        </div>
      </div>
      <PathProgressBar done={started ? shape.done : 0} total={shape.needed} />
      <div ref={ctaRef} className="space-y-2">
        {cta.node?.()}
        {cta.leave && (
          <button
            type="button"
            onClick={cta.leave}
            disabled={cta.busy}
            className="w-full inline-flex items-center justify-center gap-1.5 text-xs font-medium text-neutral-400 hover:text-neutral-700 transition-colors"
          >
            <SignOut size={12} className="rtl:rotate-180" />
            {t('paths.leave_path')}
          </button>
        )}
      </div>
      <div className="grid grid-cols-3 rounded-xl bg-neutral-50 ring-1 ring-inset ring-neutral-200/60">
        <MiniStat value={shape.total} label={t('paths.cards.stat_courses')} />
        <MiniStat value={shape.needed} label={t('paths.cards.stat_to_finish')} />
        <MiniStat value={path.enrollment_count} label={t('paths.dashboard.columns.learners')} />
      </div>
    </div>
  )
}

function CertificateCard({ path, orgslug }: { path: Path; orgslug: string }) {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const user = session?.data?.user
  const signedIn = session?.status === 'authenticated'
  const learnerName = signedIn ? [user?.first_name, user?.last_name].filter(Boolean).join(' ') || user?.username : undefined
  const progress = path.progress
  const earned = !!progress?.completed && !!progress?.certificate_uuid && !progress.certificate_revoked

  return (
    <div className={`${CARD} p-4 space-y-3`}>
      <div className="flex items-center gap-2">
        <span className="w-7 h-7 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
          <Medal size={15} weight="fill" />
        </span>
        <p className="text-sm font-semibold text-neutral-900">
          {earned ? t('paths.certificate_earned') : t('paths.certificate_included')}
        </p>
      </div>
      <div className="rounded-lg overflow-hidden ring-1 ring-black/5 shadow-sm pointer-events-none select-none">
        <CertificatePreview
          certificationName={path.certificate_config.certification_name || path.name}
          certificationDescription={path.certificate_config.certification_description || path.description}
          certificationType={path.certificate_config.certification_type || 'specialization'}
          certificatePattern={path.certificate_config.certificate_pattern}
          certificateInstructor={path.certificate_config.certificate_instructor}
          certificateId={progress?.certificate_uuid || undefined}
          learnerName={learnerName}
        />
      </div>
      {earned ? (
        <Link
          href={getUriWithOrg(orgslug, `/paths/certificate/${progress!.certificate_uuid}`)}
          className="inline-flex items-center gap-1 text-sm font-semibold text-neutral-700 hover:text-neutral-900"
        >
          {t('paths.view_certificate')}
          <ArrowRight size={14} className="rtl:rotate-180" />
        </Link>
      ) : (
        <p className="text-xs text-neutral-500 leading-relaxed">{t('paths.certificate_explainer')}</p>
      )}
    </div>
  )
}

function PathSkeleton() {
  return (
    <div className="animate-pulse space-y-6">
      <div className="h-7 w-40 bg-neutral-100 rounded-lg" />
      <div className={`${CARD} p-6 flex flex-col md:flex-row gap-6`}>
        <div className="w-full md:w-80 aspect-video bg-neutral-100 rounded-xl" />
        <div className="flex-1 space-y-3">
          <div className="h-3 w-24 bg-neutral-100 rounded" />
          <div className="h-8 w-2/3 bg-neutral-100 rounded" />
          <div className="h-4 w-full bg-neutral-100 rounded" />
          <div className="flex gap-2 pt-2">
            <div className="h-6 w-20 bg-neutral-100 rounded-full" />
            <div className="h-6 w-24 bg-neutral-100 rounded-full" />
          </div>
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-6">
        <div className="space-y-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex gap-4">
              <div className="w-10 h-10 rounded-full bg-neutral-100 shrink-0" />
              <div className={`${CARD} flex-1 h-28`} />
            </div>
          ))}
        </div>
        <div className={`${CARD} h-64`} />
      </div>
    </div>
  )
}
