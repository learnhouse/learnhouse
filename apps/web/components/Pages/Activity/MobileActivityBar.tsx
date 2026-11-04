'use client'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { CaretLeft, CaretRight, ListBullets, CheckCircle, Circle, Flag } from '@phosphor-icons/react'
import { Dialog, DialogContent, DialogTitle } from '@components/ui/dialog'
import { getUriWithOrg } from '@services/config/config'

interface MobileActivityBarProps {
  course: any
  /** Activity uuid, with or without the `activity_` prefix. */
  currentActivityId: string
  orgslug: string
  trailData?: any
  /** Dark styling, for the video theater band. */
  dark?: boolean
  /** The completion / submission control for this activity. */
  children?: React.ReactNode
}

const clean = (uuid?: string) => uuid?.replace('activity_', '') ?? ''

/**
 * The course reader's bottom bar on phones: previous / next within thumb
 * reach, the activity's own action (mark complete, submit) in the middle, and
 * a contents button that opens the course outline as a sheet. Replaces the
 * desktop's inline nav row and the sticky top bar below md.
 */
export default function MobileActivityBar(props: MobileActivityBarProps) {
  const { t } = useTranslation()
  const router = useRouter()
  const [outlineOpen, setOutlineOpen] = useState(false)
  const cleanCourseUuid = props.course?.course_uuid?.replace('course_', '')
  const currentId = clean(props.currentActivityId)

  const { flat, index, completedIds } = useMemo(() => {
    const flat: any[] = []
    let index = -1
    props.course?.chapters?.forEach((chapter: any) => {
      chapter.activities?.forEach((activity: any) => {
        flat.push(activity)
        if (clean(activity.activity_uuid) === currentId) index = flat.length - 1
      })
    })
    const run = props.trailData?.runs?.find(
      (r: any) => r.course?.course_uuid?.replace('course_', '') === cleanCourseUuid
    )
    const completedIds = new Set<number>(
      (run?.steps ?? []).filter((s: any) => s.complete).map((s: any) => s.activity_id)
    )
    return { flat, index, completedIds }
  }, [props.course, props.trailData, currentId, cleanCourseUuid])

  // Publish the bar's height so the page leaves room for it (styles/mobile.css).
  useEffect(() => {
    document.documentElement.classList.add('lh-has-activitybar')
    return () => document.documentElement.classList.remove('lh-has-activitybar')
  }, [])

  const prev = index > 0 ? flat[index - 1] : null
  const next = index >= 0 && index < flat.length - 1 ? flat[index + 1] : null
  const isLast = index >= 0 && !next
  const hrefFor = (a: any) => getUriWithOrg(props.orgslug, '') + `/course/${cleanCourseUuid}/activity/${clean(a.activity_uuid)}`
  const endHref = getUriWithOrg(props.orgslug, '') + `/course/${cleanCourseUuid}/activity/end`
  const progress = flat.length ? (completedIds.size / flat.length) * 100 : 0

  const dark = props.dark
  const circle = `lh-press flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors ${
    dark ? 'bg-white/10 text-white' : 'bg-neutral-100 text-neutral-800'
  }`
  const disabled = dark ? 'opacity-30' : 'opacity-35'

  return (
    <>
      <div
        className={`md:hidden fixed inset-x-0 bottom-0 backdrop-blur-xl backdrop-saturate-150 ${
          dark ? 'bg-[#141414]/90 border-t border-white/5' : 'bg-white/90 border-t border-black/[0.06]'
        }`}
        style={{ zIndex: 'var(--z-nav)', paddingBottom: 'var(--lh-safe-bottom)' }}
      >
        {/* Course progress, edge to edge along the top of the bar. */}
        <div className={`absolute inset-x-0 top-0 h-[2px] ${dark ? 'bg-white/10' : 'bg-black/[0.04]'}`}>
          <div
            className="h-full bg-teal-500 transition-[width] duration-500 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="flex items-center gap-2 px-3" style={{ height: 'var(--lh-activitybar-h)' }}>
          <button
            type="button"
            onClick={() => prev && router.push(hrefFor(prev))}
            disabled={!prev}
            className={`${circle} ${!prev ? disabled : ''}`}
            aria-label={prev ? `${t('common.previous')}: ${prev.name}` : t('activities.no_previous_activity')}
          >
            <CaretLeft size={20} weight="bold" className="rtl:rotate-180" />
          </button>
          <button
            type="button"
            onClick={() => setOutlineOpen(true)}
            className={`lh-press flex h-11 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm font-semibold tabular-nums ${
              dark ? 'bg-white/10 text-white' : 'bg-neutral-100 text-neutral-800'
            }`}
            aria-label={t('activities.view_all_activities')}
          >
            <ListBullets size={18} weight="bold" />
            <span>
              {index + 1}
              <span className={dark ? 'text-white/50' : 'text-neutral-400'}>/{flat.length}</span>
            </span>
          </button>
          <div className="flex min-w-0 flex-1 justify-center">{props.children}</div>
          <button
            type="button"
            onClick={() => router.push(next ? hrefFor(next) : endHref)}
            disabled={!next && !isLast}
            className={`lh-press flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors ${
              dark ? 'bg-white text-neutral-900' : 'bg-neutral-900 text-white'
            } ${!next && !isLast ? disabled : ''}`}
            aria-label={next ? `${t('common.next')}: ${next.name}` : t('course.finish_course', 'Finish course')}
          >
            {isLast ? <Flag size={18} weight="fill" /> : <CaretRight size={20} weight="bold" className="rtl:rotate-180" />}
          </button>
        </div>
      </div>

      <CourseOutlineSheet
        open={outlineOpen}
        onOpenChange={setOutlineOpen}
        course={props.course}
        currentId={currentId}
        completedIds={completedIds}
        hrefFor={hrefFor}
        progress={progress}
      />
    </>
  )
}

function CourseOutlineSheet({
  open,
  onOpenChange,
  course,
  currentId,
  completedIds,
  hrefFor,
  progress,
}: {
  open: boolean
  onOpenChange: (_open: boolean) => void
  course: any
  currentId: string
  completedIds: Set<number>
  hrefFor: (_a: any) => string
  progress: number
}) {
  const { t } = useTranslation()
  const currentRef = useRef<HTMLAnchorElement | null>(null)

  // Land on the lesson being read, not the top of a long outline.
  useEffect(() => {
    if (!open) return
    const id = window.setTimeout(() => currentRef.current?.scrollIntoView({ block: 'center' }), 80)
    return () => window.clearTimeout(id)
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="md:hidden flex flex-col p-0 bg-white">
        <div className="shrink-0 px-5 pt-7 pb-3 border-b border-black/[0.05]">
          <DialogTitle className="text-lg font-bold text-neutral-900 pe-8 line-clamp-2">{course?.name}</DialogTitle>
          <div className="mt-2 flex items-center gap-3">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-100">
              <div className="h-full rounded-full bg-teal-500" style={{ width: `${progress}%` }} />
            </div>
            <span className="text-xs font-semibold tabular-nums text-neutral-500">{Math.round(progress)}%</span>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain pb-4">
          {course?.chapters?.map((chapter: any, ci: number) => (
            <section key={chapter.id ?? ci}>
              <h3 className="sticky top-0 z-[1] bg-white/95 backdrop-blur px-5 pt-4 pb-2 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
                {t('courses.chapter')} {ci + 1} · <span className="normal-case tracking-normal text-neutral-600">{chapter.name}</span>
              </h3>
              <ul className="px-2">
                {chapter.activities?.map((activity: any) => {
                  const isCurrent = clean(activity.activity_uuid) === currentId
                  const done = completedIds.has(activity.id)
                  return (
                    <li key={activity.id}>
                      <Link
                        ref={isCurrent ? currentRef : undefined}
                        href={hrefFor(activity)}
                        prefetch={false}
                        onClick={() => onOpenChange(false)}
                        className={`lh-press flex min-h-[52px] items-center gap-3 rounded-xl px-3 ${
                          isCurrent ? 'bg-neutral-100' : 'active:bg-black/[0.03]'
                        }`}
                        aria-current={isCurrent ? 'page' : undefined}
                      >
                        {done ? (
                          <CheckCircle size={22} weight="fill" className="shrink-0 text-teal-500" />
                        ) : (
                          <Circle size={22} className={`shrink-0 ${isCurrent ? 'text-neutral-500' : 'text-neutral-300'}`} />
                        )}
                        <span
                          className={`flex-1 text-[15px] leading-snug ${
                            isCurrent ? 'font-semibold text-neutral-900' : done ? 'text-neutral-500' : 'text-neutral-800'
                          }`}
                        >
                          {activity.name}
                        </span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
