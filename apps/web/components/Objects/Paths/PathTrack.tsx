'use client'
import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Books, Check, Flag, FlagCheckered, GitFork, ListNumbers, Lock, LockSimple, Medal } from '@phosphor-icons/react'
import { Chip } from '@components/Dashboard/Shared/DashKit/DashKit'
import ThumbnailImage from '@components/Objects/Thumbnails/ThumbnailImage'
import { useOrg } from '@components/Contexts/OrgContext'
import { getCourseThumbnailMediaDirectory } from '@services/media/media'
import { Path, PathCourseItem } from '@services/paths/paths'
import { usePath } from '@/hooks/queries/usePaths'

/*
 The route visual every path tile shares: a start flag, one node per course
 in path order joined by a line, and a finish node (a medal when the path
 awards a certificate). Required courses get a solid sky ring and electives a
 dashed violet one, the same marks the path editor uses. For a learner who
 follows the path, finished courses fill in and the line fills up to them.
*/

/** True once the element has come near the viewport. Lets each tile fetch
 * its course list only when it is about to be seen. */
export function useSeen<T extends Element>() {
  const ref = useRef<T>(null)
  const [seen, setSeen] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (seen || !el) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true)
          io.disconnect()
        }
      },
      { rootMargin: '200px' }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [seen])
  return [ref, seen] as const
}

/** The ordered courses of a path. The org list leaves them out, so the
 * detail is read (and cached for the path page) once the tile is visible. */
export function usePathCourses(path: Path, enabled: boolean): PathCourseItem[] | undefined {
  const inline = Array.isArray(path.courses) && path.courses.length > 0
  const { data } = usePath(enabled && !inline && path.course_count > 0 ? path.path_uuid : undefined)
  if (inline) return path.courses
  if (path.course_count === 0) return []
  return data?.courses
}

export type PathShape = {
  total: number
  required: number
  electives: number
  electivesNeeded: number
  needed: number
  done: number
  enrolled: boolean
  completed: boolean
  percent: number
}

/** Counts for a path tile, from the course list when loaded and from the
 * summary the list endpoint returns otherwise. */
export function pathShape(path: Path, courses?: PathCourseItem[]): PathShape {
  const progress = path.progress
  const required = courses ? courses.filter((c) => c.required).length : (progress?.required_total ?? path.course_count)
  const total = courses ? courses.length : path.course_count
  const electives = Math.max(total - required, 0)
  const electivesNeeded = Math.min(Math.max(path.electives_required || 0, 0), electives)
  return {
    total,
    required,
    electives,
    electivesNeeded,
    needed: progress?.courses_needed ?? required + electivesNeeded,
    done: progress?.courses_done ?? 0,
    enrolled: !!progress?.enrolled,
    completed: !!progress?.completed,
    percent: progress?.percent ?? 0,
  }
}

/** The course a follower should take next, if any. */
export function nextCourse(path: Path, courses?: PathCourseItem[]) {
  if (!courses || !path.progress?.enrolled || path.progress.completed) return undefined
  return courses.find((c) => !c.completed && !c.locked && !c.course?.restricted)
}

const SIZES = {
  md: { node: 'w-8 h-8', end: 'w-7 h-7', icon: 13, badge: 'w-3.5 h-3.5', badgeIcon: 8, text: 'text-[11px]', line: 'min-w-2' },
  sm: { node: 'w-5 h-5', end: 'w-5 h-5', icon: 10, badge: 'w-2.5 h-2.5', badgeIcon: 6, text: 'text-[9px]', line: 'min-w-1' },
} as const

function Connector({ done, size }: { done: boolean; size: keyof typeof SIZES }) {
  return (
    <span
      aria-hidden
      className={`flex-1 ${SIZES[size].line} ${
        done ? 'h-0.5 rounded-full bg-emerald-500' : 'border-t-2 border-dashed border-neutral-300/90'
      }`}
    />
  )
}

export function PathTrack({
  path,
  courses,
  size = 'md',
  maxNodes = 6,
  showProgress = true,
  className = '',
}: {
  path: Path
  /** The ordered courses; undefined while loading shows numbered placeholders. */
  courses?: PathCourseItem[]
  size?: keyof typeof SIZES
  maxNodes?: number
  /** Learner view: fill finished courses and point at the next one. */
  showProgress?: boolean
  className?: string
}) {
  const { t } = useTranslation()
  const org = useOrg() as any
  const s = SIZES[size]
  const enrolled = showProgress && !!path.progress?.enrolled
  const finished = enrolled && !!path.progress?.completed
  const next = showProgress ? nextCourse(path, courses) : undefined

  const count = courses ? courses.length : path.course_count
  const overflow = count > maxNodes ? count - (maxNodes - 1) : 0
  const shown = overflow ? maxNodes - 1 : count
  const placeholders = !courses

  const nodes = Array.from({ length: shown }, (_, i) => {
    const item = courses?.[i]
    return { i, item }
  })

  return (
    <ol aria-label={t('paths.courses_in_path')} className={`flex items-center w-full ${className}`}>
      {/* Start */}
      <li className="flex items-center shrink-0" title={t('paths.dashboard.journey.start')}>
        <span
          className={`${s.end} rounded-full flex items-center justify-center shrink-0 shadow-sm ${
            enrolled ? 'bg-emerald-500 text-white' : 'bg-neutral-900 text-white'
          }`}
        >
          <Flag size={s.icon} weight="fill" />
        </span>
      </li>

      {count === 0 && (
        <li className="flex-1 flex items-center gap-2 min-w-0 px-2">
          <Connector done={false} size={size} />
          <span className={`${s.text} font-semibold text-neutral-400 whitespace-nowrap`}>{t('paths.no_courses_yet')}</span>
          <Connector done={false} size={size} />
        </li>
      )}

      {nodes.map(({ i, item }) => {
        const course = item?.course
        const completed = enrolled && !!item?.completed
        const locked = enrolled && !!item?.locked
        const restricted = !!course?.restricted
        const unpublished = course?.published === false
        const isNext = !!next && item?.course_uuid === next.course_uuid
        const required = item ? item.required : true
        const thumb =
          course?.thumbnail_image && !restricted && org?.org_uuid
            ? getCourseThumbnailMediaDirectory(org.org_uuid, item!.course_uuid, course.thumbnail_image)
            : null
        const status = [
          required ? t('paths.required') : t('paths.elective'),
          completed ? t('paths.completed') : null,
          isNext ? t('paths.up_next') : null,
          locked ? t('paths.locked_hint') : null,
          unpublished ? t('paths.draft') : null,
        ]
          .filter(Boolean)
          .join(' · ')
        const label = restricted
          ? t('paths.restricted_course')
          : course?.name
            ? `${i + 1}. ${course.name}`
            : t('paths.dashboard.journey.step', { n: i + 1 })

        const ring = placeholders
          ? 'ring-1 ring-neutral-200'
          : completed
            ? 'ring-2 ring-emerald-500 ring-offset-1 ring-offset-white'
            : isNext
              ? 'ring-2 ring-neutral-900 ring-offset-1 ring-offset-white'
              : required
                ? 'ring-2 ring-sky-400 ring-offset-1 ring-offset-white'
                : 'outline-2 outline-dashed outline-violet-400 outline-offset-1'

        return (
          <li key={item?.course_uuid ?? i} className="flex-1 flex items-center min-w-0" title={item ? `${label} — ${status}` : undefined}>
            <Connector done={completed} size={size} />
            <span className="relative shrink-0">
              {isNext && size === 'md' && (
                <span aria-hidden className="absolute -inset-1 rounded-full bg-neutral-900/10 animate-ping" />
              )}
              <span
                className={`relative ${s.node} rounded-full overflow-hidden flex items-center justify-center bg-neutral-100 text-neutral-500 ${s.text} font-bold tabular-nums ${ring} ${
                  locked || unpublished ? 'grayscale opacity-60' : ''
                } ${placeholders ? 'animate-pulse' : ''}`}
              >
                {thumb ? (
                  <ThumbnailImage src={thumb} className="w-full h-full object-cover" />
                ) : restricted ? (
                  <Lock size={s.icon} />
                ) : (
                  i + 1
                )}
              </span>
              {size === 'md' && (completed || locked) && (
                <span
                  className={`absolute -bottom-0.5 -end-0.5 ${s.badge} rounded-full flex items-center justify-center ring-2 ring-white ${
                    completed ? 'bg-emerald-500 text-white' : 'bg-white text-neutral-500'
                  }`}
                >
                  {completed ? <Check size={s.badgeIcon} weight="bold" /> : <Lock size={s.badgeIcon} weight="bold" />}
                </span>
              )}
            </span>
          </li>
        )
      })}

      {overflow > 0 && (
        <li className="flex-1 flex items-center min-w-0">
          <Connector done={false} size={size} />
          <span
            className={`${s.node} rounded-full shrink-0 flex items-center justify-center bg-white ring-1 ring-neutral-200 text-neutral-500 ${s.text} font-bold tabular-nums`}
          >
            +{overflow}
          </span>
        </li>
      )}

      {/* Finish */}
      <li
        className={`flex items-center min-w-0 ${count === 0 ? 'shrink-0' : 'flex-1'}`}
        title={path.certificate_enabled ? t('paths.certificate_included') : t('paths.dashboard.journey.finish')}
      >
        {count > 0 && <Connector done={finished} size={size} />}
        <span
          className={`${s.end} rounded-full shrink-0 flex items-center justify-center ${
            path.certificate_enabled
              ? finished
                ? 'bg-amber-400 text-white shadow-sm'
                : 'bg-amber-50 text-amber-600 ring-1 ring-amber-200'
              : finished
                ? 'bg-emerald-500 text-white shadow-sm'
                : 'bg-white text-neutral-500 ring-1 ring-neutral-200'
          }`}
        >
          {path.certificate_enabled ? <Medal size={s.icon} weight="fill" /> : <FlagCheckered size={s.icon} weight="fill" />}
        </span>
      </li>
    </ol>
  )
}

/** "Pick 1 of 2 electives" and "Guided order", the two rules worth a chip. */
export function PathRuleChips({ path, electives, electivesNeeded }: { path: Path; electives: number; electivesNeeded: number }) {
  const { t } = useTranslation()
  if (!electives && !path.sequential) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {electives > 0 && (
        <Chip tone="violet" icon={<GitFork size={12} />}>
          {electivesNeeded > 0
            ? t('paths.cards.pick_electives', { count: electivesNeeded, total: electives })
            : t('paths.dashboard.journey.elective_count', { count: electives })}
        </Chip>
      )}
      {path.sequential && (
        <Chip tone="neutral" icon={<LockSimple size={12} />}>
          {t('paths.guided_order')}
        </Chip>
      )}
    </div>
  )
}

/** Level pill for a path cover. */
export function PathLevelChip({ path }: { path: Path }) {
  const { t } = useTranslation()
  return (
    <span className="inline-flex items-center rounded-full bg-white/95 backdrop-blur px-2.5 py-1 text-[11px] font-semibold text-neutral-700 shadow-sm">
      {path.level ? t(`paths.levels.${path.level}`) : t('paths.levels.all')}
    </span>
  )
}

/** The strip a tile puts its track on: a faint dot grid, like a board. */
export const TRACK_STRIP =
  'bg-neutral-50/80 bg-[radial-gradient(var(--color-neutral-200)_1px,transparent_1px)] [background-size:12px_12px]'

/** One segment per course to finish, filled for the ones done. */
export function PathProgressBar({ done, total, className = '' }: { done: number; total: number; className?: string }) {
  if (total <= 0) return null
  if (total > 12) {
    const pct = Math.round((100 * Math.min(done, total)) / total)
    return (
      <div className={`h-1.5 w-full rounded-full bg-neutral-200/80 overflow-hidden ${className}`}>
        <div className="lh-t-progress h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
      </div>
    )
  }
  return (
    <div className={`flex items-center gap-1 w-full ${className}`}>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={`h-1.5 flex-1 rounded-full ${i < done ? 'bg-emerald-500' : 'bg-neutral-200/80'}`} />
      ))}
    </div>
  )
}

/** Empty state that shows what a path is: a sample route and three points. */
export function PathsIntro({
  title,
  description,
  points,
  action,
}: {
  title: string
  description: string
  points?: [string, string, string]
  action?: React.ReactNode
}) {
  const icons = [ListNumbers, GitFork, Medal]
  return (
    <div className="flex flex-col items-center text-center px-6 py-12 sm:py-14 gap-6">
      <div aria-hidden className={`w-full max-w-sm rounded-2xl px-5 py-4 ring-1 ring-neutral-100 ${TRACK_STRIP}`}>
        <div className="flex items-center">
          <span className="w-7 h-7 rounded-full bg-neutral-900 text-white flex items-center justify-center shrink-0 shadow-sm">
            <Flag size={13} weight="fill" />
          </span>
          {[
            'ring-2 ring-emerald-500 ring-offset-1 ring-offset-white text-emerald-600',
            'ring-2 ring-sky-400 ring-offset-1 ring-offset-white text-sky-600',
            'outline-2 outline-dashed outline-violet-400 outline-offset-1 text-violet-500',
            'ring-2 ring-sky-400 ring-offset-1 ring-offset-white text-sky-600',
          ].map((ring, i) => (
            <React.Fragment key={i}>
              <Connector done={i === 0} size="md" />
              <span className={`w-8 h-8 rounded-full bg-white flex items-center justify-center shrink-0 ${ring}`}>
                <Books size={14} weight="duotone" />
              </span>
            </React.Fragment>
          ))}
          <Connector done={false} size="md" />
          <span className="w-7 h-7 rounded-full bg-amber-50 text-amber-600 ring-1 ring-amber-200 flex items-center justify-center shrink-0">
            <Medal size={13} weight="fill" />
          </span>
        </div>
      </div>
      <div className="max-w-md">
        <p className="text-lg font-bold tracking-tight text-neutral-900">{title}</p>
        <p className="mt-1.5 text-sm text-neutral-500">{description}</p>
      </div>
      {points && (
        <ul className="grid grid-cols-1 sm:grid-cols-3 gap-3 w-full max-w-2xl text-start">
          {points.map((point, i) => {
            const Icon = icons[i]
            return (
              <li key={i} className="flex items-start gap-2.5 rounded-xl bg-white ring-1 ring-neutral-100 px-3 py-2.5">
                <span className="w-7 h-7 rounded-lg bg-neutral-100 text-neutral-600 flex items-center justify-center shrink-0">
                  <Icon size={14} />
                </span>
                <span className="text-xs text-neutral-600 leading-snug pt-0.5">{point}</span>
              </li>
            )
          })}
        </ul>
      )}
      {action}
    </div>
  )
}
