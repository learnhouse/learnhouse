'use client'
import React, { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { CaretLeft, CaretRight, ListBullets, Flag } from '@phosphor-icons/react'
import { Dialog, DialogContent, DialogTitle } from '@components/ui/dialog'
import { useCourseProgress, type CourseProgressModel } from '@components/Pages/Courses/courseProgress'
import { CourseOutlineList } from '@components/Pages/Courses/CourseOutlineList'

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
  // Same model as the desktop progress strip, so both agree on done/current/locked.
  const model = useCourseProgress({
    course: props.course,
    trailData: props.trailData,
    orgslug: props.orgslug,
    currentActivityId: props.currentActivityId,
  })

  // Publish the bar's height so the page leaves room for it (styles/mobile.css).
  useEffect(() => {
    document.documentElement.classList.add('lh-has-activitybar')
    return () => document.documentElement.classList.remove('lh-has-activitybar')
  }, [])

  const prev = model.prev?.activity ?? null
  const next = model.next?.activity ?? null
  const isLast = model.isLast
  const index = model.currentIndex
  const progress = model.percent

  const dark = props.dark
  const circle = `lh-press flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors ${
    dark ? 'bg-white/10 text-white' : 'bg-neutral-100 text-neutral-800'
  }`
  const disabled = dark ? 'opacity-30' : 'opacity-35'

  return (
    <>
      <div
        className={`lh-bottom-bleed md:hidden fixed inset-x-0 bottom-0 backdrop-blur-xl backdrop-saturate-150 ${
          dark ? 'bg-[#141414]/90 border-t border-white/5' : 'bg-white/90 border-t border-black/[0.06]'
        }`}
        style={{ zIndex: 'var(--z-nav)', paddingBottom: 'var(--lh-safe-bottom)' }}
      >
        {/* Course progress, edge to edge along the top of the bar. */}
        <div className={`absolute inset-x-0 top-0 h-[2px] ${dark ? 'bg-white/10' : 'bg-black/[0.04]'}`}>
          <div
            className="lh-t-progress h-full bg-teal-500 transition-[width] duration-500 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="flex items-center gap-2 px-3" style={{ height: 'var(--lh-activitybar-h)' }}>
          <button
            type="button"
            onClick={() => model.prev && router.push(model.prev.href)}
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
              <span className={dark ? 'text-white/50' : 'text-neutral-400'}>/{model.total}</span>
            </span>
          </button>
          {/* The activity's control (mark complete, submit, status) takes the
              remaining width: one clear target between the arrows. */}
          <div className="flex min-w-0 flex-1 justify-center">{props.children}</div>
          <button
            type="button"
            onClick={() => router.push(model.next ? model.next.href : model.endHref)}
            disabled={!next && !isLast}
            className={`${circle} ${!next && !isLast ? disabled : ''}`}
            aria-label={next ? `${t('common.next')}: ${next.name}` : t('course.finish_course', 'Finish course')}
          >
            {isLast ? <Flag size={18} weight="fill" /> : <CaretRight size={20} weight="bold" className="rtl:rotate-180" />}
          </button>
        </div>
      </div>

      <CourseOutlineSheet open={outlineOpen} onOpenChange={setOutlineOpen} course={props.course} model={model} />
    </>
  )
}

function CourseOutlineSheet({
  open,
  onOpenChange,
  course,
  model,
}: {
  open: boolean
  onOpenChange: (_open: boolean) => void
  course: any
  model: CourseProgressModel
}) {
  const { t } = useTranslation()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="md:hidden flex flex-col p-0 bg-white">
        <div className="shrink-0 px-5 pt-7 pb-3 border-b border-black/[0.05]">
          <DialogTitle className="text-lg font-bold text-neutral-900 pe-8 line-clamp-2">{course?.name}</DialogTitle>
          <div className="mt-2 flex items-center gap-3">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-100">
              <div className="lh-t-progress h-full rounded-full bg-teal-500" style={{ width: `${model.percent}%` }} />
            </div>
            <span className="text-xs font-semibold tabular-nums text-neutral-500">
              {t('activities.progress.overall', { defaultValue: '{{done}} of {{total}} done', done: model.completedCount, total: model.total })}
            </span>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain pb-4">
          {/* Mounted only while open, so it scrolls to the current lesson each time. */}
          {open && <CourseOutlineList model={model} size="lg" onNavigate={() => onOpenChange(false)} />}
        </div>
      </DialogContent>
    </Dialog>
  )
}
