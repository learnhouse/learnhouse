'use client'
import React, { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { ArrowsIn } from '@phosphor-icons/react'
import { getUriWithOrg } from '@services/config/config'
import { getCourseThumbnailMediaDirectory } from '@services/media/media'
import { ShortcutHint } from '@components/Objects/Shortcuts/ShortcutHint'
import { useCourseProgress } from '@components/Pages/Courses/courseProgress'
import { coursePath } from '@/lib/seo/paths'
import CompanyContextChip from '@ee/components/Companies/CompanyContextChip'

/**
 * True while a video plays in focus mode and the pointer has been still for a
 * moment: the focus chrome fades out so the picture has the screen. Any
 * pointer, key or touch brings it back. Off whenever `enabled` is false.
 */
export function useChromeIdle(enabled: boolean, delay = 2600): boolean {
  const [idle, setIdle] = useState(false)
  useEffect(() => {
    if (!enabled) return
    let timer: ReturnType<typeof setTimeout> | undefined
    let playing = false
    const arm = () => {
      setIdle(false)
      if (timer) clearTimeout(timer)
      if (playing) timer = setTimeout(() => setIdle(true), delay)
    }
    // Media events don't bubble; capture them on the document.
    const onPlay = (e: Event) => {
      if (!(e.target instanceof HTMLVideoElement)) return
      playing = true
      arm()
    }
    const onStop = (e: Event) => {
      if (!(e.target instanceof HTMLVideoElement)) return
      playing = false
      arm()
    }
    const video = document.querySelector<HTMLVideoElement>('.learnhouse-player video')
    playing = !!video && !video.paused
    arm()
    document.addEventListener('play', onPlay, true)
    document.addEventListener('pause', onStop, true)
    document.addEventListener('ended', onStop, true)
    const opts = { passive: true } as const
    window.addEventListener('pointermove', arm, opts)
    window.addEventListener('pointerdown', arm, opts)
    window.addEventListener('keydown', arm)
    return () => {
      if (timer) clearTimeout(timer)
      document.removeEventListener('play', onPlay, true)
      document.removeEventListener('pause', onStop, true)
      document.removeEventListener('ended', onStop, true)
      window.removeEventListener('pointermove', arm)
      window.removeEventListener('pointerdown', arm)
      window.removeEventListener('keydown', arm)
      setIdle(false)
    }
  }, [enabled, delay])
  return enabled && idle
}

const SWIPE_MIN_PX = 72
const SWIPE_MAX_MS = 700

/** Whether a touch that starts at `el` belongs to something that scrolls or drags sideways. */
function ownsHorizontalGesture(el: Element | null, stop: Element | null): boolean {
  for (let node = el; node && node !== stop; node = node.parentElement) {
    if (node.matches('input, textarea, select, [contenteditable="true"], [role="slider"], .media-slider, .media-time-slider, .media-volume-slider')) return true
    const style = getComputedStyle(node)
    if ((style.overflowX === 'auto' || style.overflowX === 'scroll') && node.scrollWidth > node.clientWidth + 1) return true
  }
  return false
}

/**
 * Horizontal swipe to step between lessons in focus mode. Ignores vertical
 * scrolls, slow drags and anything starting on a slider, a field or a strip
 * that scrolls sideways itself. `forward` follows the reading direction.
 */
export function useFocusSwipe({ enabled, isRTL, onNext, onPrev }: { enabled: boolean; isRTL: boolean; onNext: () => void; onPrev: () => void }) {
  const start = useRef<{ x: number; y: number; t: number; skip: boolean } | null>(null)
  const onTouchStart = (e: React.TouchEvent<HTMLElement>) => {
    if (!enabled || e.touches.length !== 1) {
      start.current = null
      return
    }
    const touch = e.touches[0]
    start.current = {
      x: touch.clientX,
      y: touch.clientY,
      t: Date.now(),
      skip: ownsHorizontalGesture(e.target as Element, e.currentTarget),
    }
  }
  const onTouchEnd = (e: React.TouchEvent<HTMLElement>) => {
    const s = start.current
    start.current = null
    if (!enabled || !s || s.skip) return
    const touch = e.changedTouches[0]
    const dx = touch.clientX - s.x
    const dy = touch.clientY - s.y
    if (Date.now() - s.t > SWIPE_MAX_MS) return
    if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < Math.abs(dy) * 2) return
    // A leftward swipe moves forward in LTR (content slides in from the end).
    const forward = isRTL ? dx > 0 : dx < 0
    if (forward) onNext()
    else onPrev()
  }
  return enabled ? { onTouchStart, onTouchEnd } : {}
}

interface FocusTopBarProps {
  course: any
  orgUuid?: string
  orgslug: string
  courseuuid: string
  activityName: string
  activityId: string
  trailData?: any
  dark: boolean
  /** Fade out (video playing, pointer idle). */
  idle: boolean
  /** Desktop extras: Ask AI pill, chapter outline. Phones use the bottom bar. */
  actions?: React.ReactNode
  onExit: () => void
}

/**
 * Focus mode's one bar: where you are (course, lesson, progress) and the way
 * out. Light for reading, dark for the video theater; course progress runs
 * along its bottom edge as on the phone activity bar.
 */
export function FocusTopBar({ course, orgUuid, orgslug, courseuuid, activityName, activityId, trailData, dark, idle, actions, onExit }: FocusTopBarProps) {
  const { t } = useTranslation()
  const model = useCourseProgress({ course, trailData, orgslug, currentActivityId: activityId })
  const thumb = course?.thumbnail_image
    ? getCourseThumbnailMediaDirectory(orgUuid || '', course.course_uuid, course.thumbnail_image)
    : '/empty_thumbnail.png'
  const position = model.currentIndex >= 0 ? `${model.currentIndex + 1} / ${model.total}` : ''

  return (
    <header
      className={`lh-focus-topbar sticky top-0 transition-opacity duration-500 motion-reduce:transition-none ${
        idle ? 'opacity-0 hover:opacity-100 focus-within:opacity-100' : 'opacity-100'
      } ${dark ? 'bg-[#0b0b0c]/80 text-white' : 'bg-[#f7f7f6]/85 text-neutral-900'} backdrop-blur-xl backdrop-saturate-150`}
      style={{ zIndex: 'var(--z-modal-content)', paddingTop: 'var(--lh-safe-top)' }}
    >
      <div className="mx-auto flex h-14 max-w-(--breakpoint-2xl) items-center gap-3 px-3 sm:px-6">
        {/* The company this course belongs to, when opened from its space (EE). */}
        <span className="contents sm:hidden"><CompanyContextChip orgslug={orgslug} dark={dark} compact /></span>
        <span className="hidden sm:contents"><CompanyContextChip orgslug={orgslug} dark={dark} /></span>
        <Link
          href={getUriWithOrg(orgslug, coursePath({ slug: course?.slug, course_uuid: courseuuid }))}
          className="lh-press flex min-w-0 flex-1 items-center gap-3 rounded-xl py-1 pe-2"
          title={t('course.back_to_course', 'Back to course')}
        >
              <img
            src={thumb}
            alt=""
            className={`h-[27px] w-12 shrink-0 rounded-md object-cover ${dark ? 'ring-1 ring-white/10' : 'ring-1 ring-black/5'}`}
            onError={(e) => {
              if (!e.currentTarget.src.endsWith('/empty_thumbnail.png')) e.currentTarget.src = '/empty_thumbnail.png'
            }}
          />
          <span className="flex min-w-0 flex-col leading-tight">
            <span className={`truncate text-[11px] font-medium ${dark ? 'text-white/45' : 'text-neutral-500'}`}>{course?.name}</span>
            <span className="truncate text-sm font-semibold">{activityName}</span>
          </span>
        </Link>

        {position && (
          <span
            className={`hidden shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold tabular-nums sm:inline-flex ${
              dark ? 'bg-white/[0.07] text-white/70' : 'bg-black/[0.04] text-neutral-600'
            }`}
          >
            {position}
          </span>
        )}
        {actions}
        <ShortcutHint label={t('activities.exit_focus_mode')} keys="escape">
          <button
            type="button"
            onClick={onExit}
            aria-label={t('activities.exit_focus_mode')}
            className={`lh-press grid size-9 shrink-0 place-items-center rounded-xl transition-colors focus-visible:outline-none focus-visible:ring-2 ${
              dark
                ? 'bg-white/[0.07] text-white/85 ring-1 ring-white/10 hover:bg-white/[0.12] focus-visible:ring-white/40'
                : 'bg-white text-neutral-700 shadow-[0_1px_1px_rgba(0,0,0,0.03),0_0_0_1px_rgba(0,0,0,0.07)] hover:bg-neutral-50 focus-visible:ring-neutral-900/20'
            }`}
          >
            <ArrowsIn size={16} weight="bold" />
          </button>
        </ShortcutHint>
      </div>
      {/* Course progress along the bottom edge. */}
      <div className={`absolute inset-x-0 bottom-0 h-[2px] ${dark ? 'bg-white/[0.06]' : 'bg-black/[0.05]'}`}>
        <div className="lh-t-progress h-full bg-teal-500 transition-[width] duration-500 ease-out" style={{ width: `${model.percent}%` }} />
      </div>
    </header>
  )
}
