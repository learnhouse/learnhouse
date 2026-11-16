'use client'
import React from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { ArrowRight, CheckCircle, Circuitry, Medal, Users } from '@phosphor-icons/react'
import { useOrg } from '@components/Contexts/OrgContext'
import ThumbnailImage from '@components/Objects/Thumbnails/ThumbnailImage'
import { Chip, buttonClass } from '@components/Dashboard/Shared/DashKit/DashKit'
import {
  PathLevelChip,
  PathProgressBar,
  PathRuleChips,
  PathTrack,
  TRACK_STRIP,
  nextCourse,
  pathShape,
  usePathCourses,
  useSeen,
} from '@components/Objects/Paths/PathTrack'
import { getUriWithOrg } from '@services/config/config'
import { getPathThumbnailMediaDirectory } from '@services/media/media'
import { Path } from '@services/paths/paths'
import { coursePath, resourcePath } from '@/lib/seo/paths'

function pathHref(orgslug: string, path: Path) {
  return getUriWithOrg(orgslug, resourcePath('path', path))
}

function usePathCover(path: Path) {
  const org = useOrg() as any
  return path.thumbnail_image ? getPathThumbnailMediaDirectory(org?.org_uuid, path.path_uuid, path.thumbnail_image) : null
}

/**
 * The learner's path tile: cover, the route through its courses, and the
 * learner's place on it. Used by the paths catalog and the trail.
 */
function PathThumbnail({ path, orgslug }: { path: Path; orgslug: string }) {
  const { t } = useTranslation()
  const [ref, seen] = useSeen<HTMLDivElement>()
  const courses = usePathCourses(path, seen)
  const shape = pathShape(path, courses)
  const href = pathHref(orgslug, path)
  const cover = usePathCover(path)

  return (
    <div
      ref={ref}
      data-kbd-item=""
      className="group relative flex flex-col bg-white rounded-2xl nice-shadow overflow-hidden w-full transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg"
    >
      <Link prefetch={false} href={href} className="block relative aspect-[2/1] overflow-hidden bg-neutral-100">
        <ThumbnailImage src={cover} className="w-full h-full transition-transform duration-500 group-hover:scale-[1.03]" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-transparent" />
        {shape.enrolled && (
          <div className="absolute top-2.5 start-2.5">
            {shape.completed ? (
              <Chip tone="emerald" icon={<CheckCircle size={12} weight="fill" />} className="shadow-sm">
                {t('paths.completed')}
              </Chip>
            ) : (
              <Chip tone="sky" className="shadow-sm">
                {t('paths.in_progress')}
              </Chip>
            )}
          </div>
        )}
        <div className="absolute bottom-2.5 inset-x-2.5 flex items-end justify-between gap-2">
          <PathLevelChip path={path} />
          {path.certificate_enabled && (
            <span
              title={t('paths.certificate_included')}
              className="inline-flex items-center gap-1 rounded-full bg-amber-400 text-amber-950 px-2 py-1 text-[11px] font-bold shadow-sm"
            >
              <Medal size={12} weight="fill" />
              {t('paths.cards.certificate')}
            </span>
          )}
        </div>
      </Link>

      <Link prefetch={false} href={href} tabIndex={-1} className={`block px-4 py-3.5 border-b border-neutral-100 ${TRACK_STRIP}`}>
        <PathTrack path={path} courses={courses} />
      </Link>

      <div className="flex flex-col flex-1 p-4 gap-1.5">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
          <Circuitry size={12} weight="bold" />
          {t('paths.course_count', { count: shape.total })}
          {shape.required > 0 && shape.electives > 0 && (
            <span className="normal-case tracking-normal font-medium">· {t('paths.dashboard.journey.required_count', { count: shape.required })}</span>
          )}
        </div>
        <Link
          prefetch={false}
          href={href}
          dir="auto"
          className="text-[15px] font-semibold text-neutral-900 leading-snug line-clamp-1 hover:underline underline-offset-2"
        >
          {path.name}
        </Link>
        {path.description && (
          <p className="text-xs text-neutral-500 line-clamp-2" dir="auto">
            {path.description}
          </p>
        )}
        <div className="pt-1">
          <PathRuleChips path={path} electives={shape.electives} electivesNeeded={shape.electivesNeeded} />
        </div>

        <div className="mt-auto pt-3">
          {shape.enrolled ? (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-neutral-700 tabular-nums">
                  {t('paths.progress_short', { done: shape.done, total: shape.needed })}
                </span>
                <span className={`font-bold tabular-nums ${shape.completed ? 'text-emerald-600' : 'text-neutral-900'}`}>
                  {shape.percent}%
                </span>
              </div>
              <PathProgressBar done={shape.done} total={shape.needed} />
              {shape.completed && path.progress?.certificate_uuid && !path.progress.certificate_revoked && (
                <Link
                  prefetch={false}
                  href={getUriWithOrg(orgslug, `/paths/certificate/${path.progress.certificate_uuid}`)}
                  className="inline-flex items-center gap-1 pt-1 text-xs font-semibold text-amber-700 hover:text-amber-800"
                >
                  <Medal size={13} weight="fill" />
                  {t('paths.view_certificate')}
                  <ArrowRight size={12} weight="bold" className="rtl:rotate-180" />
                </Link>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2 text-xs text-neutral-500">
              <span className="inline-flex items-center gap-1 tabular-nums">
                <Users size={13} />
                {t('paths.learner_count', { count: path.enrollment_count })}
              </span>
              <Link
                prefetch={false}
                href={href}
                className="inline-flex items-center gap-1 font-semibold text-neutral-700 hover:text-neutral-900"
              >
                {t('paths.view_path')}
                <ArrowRight size={12} weight="bold" className="rtl:rotate-180" />
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * Wide tile for a path the learner is following: a bigger route, where they
 * are on it and a button straight to the next course.
 */
export function PathContinueCard({ path, orgslug }: { path: Path; orgslug: string }) {
  const { t } = useTranslation()
  const [ref, seen] = useSeen<HTMLDivElement>()
  const courses = usePathCourses(path, seen)
  const shape = pathShape(path, courses)
  const href = pathHref(orgslug, path)
  const cover = usePathCover(path)
  const next = nextCourse(path, courses)
  const nextHref = next ? getUriWithOrg(orgslug, coursePath(next)) : href

  return (
    <div
      ref={ref}
      data-kbd-item=""
      className="group flex flex-col sm:flex-row bg-white rounded-2xl nice-shadow overflow-hidden transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg"
    >
      <Link prefetch={false} href={href} className="relative block sm:w-48 lg:w-56 shrink-0 aspect-[2/1] sm:aspect-auto bg-neutral-100 overflow-hidden">
        <ThumbnailImage src={cover} className="absolute inset-0 w-full h-full transition-transform duration-500 group-hover:scale-[1.03]" />
        {path.certificate_enabled && (
          <span
            title={t('paths.certificate_included')}
            className="absolute bottom-2.5 start-2.5 inline-flex items-center gap-1 rounded-full bg-amber-400 text-amber-950 px-2 py-1 text-[11px] font-bold shadow-sm"
          >
            <Medal size={12} weight="fill" />
            {t('paths.cards.certificate')}
          </span>
        )}
      </Link>
      <div className="flex-1 min-w-0 flex flex-col gap-3 p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Link
              prefetch={false}
              href={href}
              dir="auto"
              className="text-base font-semibold text-neutral-900 leading-snug line-clamp-1 hover:underline underline-offset-2"
            >
              {path.name}
            </Link>
            <p className="text-xs text-neutral-500 tabular-nums mt-0.5">
              {t('paths.progress_long', { done: shape.done, total: shape.needed })}
            </p>
          </div>
          <span className="text-xl font-bold tabular-nums text-neutral-900 shrink-0">{shape.percent}%</span>
        </div>
        <div className={`rounded-xl px-3 py-3 ring-1 ring-neutral-100 ${TRACK_STRIP}`}>
          <PathTrack path={path} courses={courses} maxNodes={8} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 mt-auto">
          <div className="min-w-0 text-xs text-neutral-500">
            {next?.course?.name ? (
              <span className="flex items-center gap-1 min-w-0">
                <span className="font-semibold uppercase tracking-wider text-[10px] text-neutral-400 shrink-0">{t('paths.up_next')}</span>
                <span className="truncate font-medium text-neutral-700" dir="auto">
                  {next.course.name}
                </span>
              </span>
            ) : (
              <PathProgressBar done={shape.done} total={shape.needed} className="w-32" />
            )}
          </div>
          <Link prefetch={false} href={nextHref} className={buttonClass('primary', 'sm')}>
            {t('paths.cards.continue')}
            <ArrowRight size={13} weight="bold" className="rtl:rotate-180" />
          </Link>
        </div>
      </div>
    </div>
  )
}

export function PathCardSkeleton() {
  return (
    <div className="bg-white rounded-2xl nice-shadow overflow-hidden animate-pulse">
      <div className="aspect-[2/1] bg-neutral-100" />
      <div className="flex items-center gap-2 px-4 py-4 border-b border-neutral-100">
        {[0, 1, 2, 3, 4].map((i) => (
          <React.Fragment key={i}>
            <span className="w-7 h-7 rounded-full bg-neutral-100 shrink-0" />
            {i < 4 && <span className="flex-1 h-0.5 bg-neutral-100" />}
          </React.Fragment>
        ))}
      </div>
      <div className="p-4 space-y-2.5">
        <div className="h-3 w-1/3 bg-neutral-100 rounded" />
        <div className="h-4 w-2/3 bg-neutral-100 rounded" />
        <div className="h-3 w-full bg-neutral-100 rounded" />
      </div>
    </div>
  )
}

export default PathThumbnail
