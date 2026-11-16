'use client'
import React, { memo, useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { CaretDown, CaretLeft, CaretRight, Check, Flag, ListBullets, LockSimple, Trophy } from '@phosphor-icons/react'
import ToolTip from '@components/Objects/StyledElements/Tooltip/Tooltip'
import { Popover, PopoverContent, PopoverTrigger } from '@components/ui/popover'
import { getUriWithOrg } from '@services/config/config'
import { useCourseCertification } from '@components/Hooks/useCourseCertification'
import { ChapterEmoji, getChapterEmoji } from '@components/Objects/Courses/ChapterEmoji/ChapterEmoji'
import { useCourseProgress, type ProgressActivity, type ProgressChapter } from './courseProgress'
import { ActivityTypeGlyph, CourseOutlineList, StatusMark } from './CourseOutlineList'

interface Props {
  course: any
  orgslug: string
  course_uuid: string
  current_activity?: string
  enableNavigation?: boolean
  trailData?: any
}

// A chapter that isn't the current one, with more activities than this, is
// drawn as one bar filled to its progress instead of one segment each, so a
// long chapter never turns into hairlines. The current chapter always shows
// every activity (up to MAX_SEGMENTS).
const MAX_SEGMENTS_COLLAPSED = 12
const MAX_SEGMENTS = 60
// Minimum widths keep segments readable; past what fits, the track scrolls.
const SEGMENT_MIN = 7
const SEGMENT_MIN_ACTIVE = 14

const NAV_BTN =
  'h-8 w-8 shrink-0 inline-flex items-center justify-center rounded-lg text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100 disabled:opacity-35 disabled:pointer-events-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/20'

function TooltipCard({ children }: { children: React.ReactNode }) {
  return <div className="bg-white rounded-xl nice-shadow py-2.5 px-3 min-w-[200px] max-w-[280px] animate-in fade-in duration-150">{children}</div>
}

function useStatusLabel() {
  const { t } = useTranslation()
  return (item: ProgressActivity) =>
    item.current
      ? t('activities.current_activity')
      : item.done
        ? t('common.completed')
        : item.locked
          ? t('activities.progress.locked', 'Locked')
          : t('activities.not_started')
}

function ActivityTip({ item, ch }: { item: ProgressActivity; ch: ProgressChapter }) {
  const { t } = useTranslation()
  const status = useStatusLabel()
  return (
    <TooltipCard>
      <p className="text-xs text-neutral-400 truncate">
        {t('activities.progress.chapter_n', { defaultValue: 'Chapter {{n}}', n: ch.index + 1 })} ·{' '}
        <ChapterEmoji chapter={ch.chapter} />
        {ch.chapter?.name}
      </p>
      <div className="mt-1 flex items-start gap-2">
        <StatusMark item={item} size={16} />
        <div className="min-w-0">
          <p className="text-sm font-medium text-neutral-900 leading-snug">{item.activity.name}</p>
          <p className="mt-0.5 flex items-center gap-1 text-xs text-neutral-500">
            <ActivityTypeGlyph activity={item.activity} size={12} />
            {status(item)}
          </p>
        </div>
      </div>
    </TooltipCard>
  )
}

function ChapterTip({ ch }: { ch: ProgressChapter }) {
  const { t } = useTranslation()
  return (
    <TooltipCard>
      <p className="text-xs text-neutral-400">{t('activities.progress.chapter_n', { defaultValue: 'Chapter {{n}}', n: ch.index + 1 })}</p>
      <p className="text-sm font-medium text-neutral-900 leading-snug">
        <ChapterEmoji chapter={ch.chapter} />
        {ch.chapter?.name}
      </p>
      <div className="mt-2 flex items-center gap-2">
        <div className="h-1.5 flex-1 rounded-full bg-neutral-100 overflow-hidden">
          <div className="lh-t-progress h-full bg-teal-500" style={{ width: `${ch.total ? (ch.completed / ch.total) * 100 : 0}%` }} />
        </div>
        <span className="text-xs text-neutral-500 tabular-nums">
          {t('activities.progress.chapter_done', { defaultValue: '{{done}} of {{total}} done', done: ch.completed, total: ch.total })}
        </span>
      </div>
    </TooltipCard>
  )
}

// The chapter circle that opens every chapter on the line, as in the original
// navigator: its number (or emoji), a tick once the chapter is done, a lock
// when it is locked. The current chapter's circle is larger and dark.
function ChapterMarker({ ch, active }: { ch: ProgressChapter; active: boolean }) {
  const complete = ch.total > 0 && ch.completed === ch.total
  const emoji = getChapterEmoji(ch.chapter)
  const tone = complete
    ? 'lh-t-solid bg-teal-500 text-white shadow-[0_0_0_1px_rgba(13,148,136,0.35)]'
    : active
      ? 'lh-t-solid bg-neutral-900 text-white shadow-[0_0_0_3px_rgba(23,23,23,0.1)]'
      : 'bg-white text-neutral-500 shadow-[0_1px_1px_rgba(0,0,0,0.03),0_0_0_1px_rgba(0,0,0,0.08)]'
  return (
    <span
      className={`relative z-[1] shrink-0 rounded-full flex items-center justify-center font-bold tabular-nums transition-transform ${
        active ? 'w-7 h-7 text-[11px]' : 'w-[22px] h-[22px] text-[10px]'
      } ${tone}`}
    >
      {complete ? (
        <Check size={active ? 13 : 11} weight="bold" />
      ) : emoji ? (
        <span aria-hidden="true" className={active ? 'text-[13px] leading-none' : 'text-[11px] leading-none'}>{emoji}</span>
      ) : ch.locked && !active ? (
        <LockSimple size={10} weight="bold" />
      ) : (
        ch.index + 1
      )}
    </span>
  )
}

// The trophy at the end of the track: the course-end / certificate view.
function CertificationBadge({ href, isCompleted }: { href: string; isCompleted: boolean }) {
  const { t } = useTranslation()
  return (
    <ToolTip
      sideOffset={8}
      unstyled
      content={
        <TooltipCard>
          <p className="text-sm font-medium text-neutral-900">
            {isCompleted ? t('courses.course_completed_exclamation') : t('courses.course_completion')}
          </p>
          <p className="mt-0.5 text-xs text-neutral-500">
            {isCompleted ? t('certificate.view_certificate') : t('courses.unlock_certificate_message')}
          </p>
        </TooltipCard>
      }
    >
      <Link
        href={href}
        prefetch={false}
        aria-label={isCompleted ? t('certificate.view_certificate') : t('courses.course_completion')}
        className={`h-5 w-5 shrink-0 rounded-full inline-flex items-center justify-center transition-colors ${
          isCompleted ? 'bg-amber-400 text-white hover:bg-amber-500' : 'bg-white text-neutral-400 ring-1 ring-inset ring-neutral-300'
        }`}
      >
        <Trophy size={11} weight="fill" />
      </Link>
    </ToolTip>
  )
}

// The course progress strip on the activity page (and the course page once
// the learner has started).
//
// Line 1 says where you are in words: "Chapter 2 of 5 · <emoji> name" and
// "Activity 3 of 7", with the full outline one click away.
// Line 2 is the track, one group per chapter, each opened by a numbered
// marker. The current chapter sits in a tinted pill with one segment per
// activity (the current one raised and ringed). Other chapters show small
// segments, or collapse to their marker alone in long courses.
function ActivityIndicators(props: Props) {
  const { t } = useTranslation()
  const router = useRouter()
  const status = useStatusLabel()
  const [outlineOpen, setOutlineOpen] = useState(false)
  const trackRef = useRef<HTMLOListElement>(null)
  const enableNavigation = props.enableNavigation || false
  const courseid = props.course_uuid.replace('course_', '')

  const model = useCourseProgress({
    course: props.course,
    trailData: props.trailData,
    orgslug: props.orgslug,
    currentActivityId: props.current_activity,
  })

  // The trophy promises a certificate, so it only makes sense on a course that
  // actually has certification. A definitive "no certification" hides it; a
  // pending or failed lookup leaves it as it is today.
  const { isEnabled: certificationEnabled, isUnknown: certificationUnknown } =
    useCourseCertification(props.course_uuid)
  const showCertificationBadge = certificationEnabled || certificationUnknown
  const endHref = getUriWithOrg(props.orgslug, '') + `/course/${courseid}/activity/end`

  const focus = model.focusChapter
  // Many chapters: the line scrolls sideways. Keep the current chapter in
  // view (scrolling the track only, never the page) and fade the edges that
  // have more to show.
  const focusIndex = focus?.index ?? -1
  const [fade, setFade] = useState({ start: false, end: false, rtl: false })
  const updateFade = useCallback(() => {
    const el = trackRef.current
    if (!el) return
    const offset = Math.abs(el.scrollLeft)
    setFade({
      start: offset > 2,
      end: offset + el.clientWidth < el.scrollWidth - 2,
      rtl: getComputedStyle(el).direction === 'rtl',
    })
  }, [])
  useEffect(() => {
    const track = trackRef.current
    const item = track?.querySelector('[data-focus-chapter]') as HTMLElement | null
    if (track && item && track.scrollWidth > track.clientWidth) {
      const tr = track.getBoundingClientRect()
      const i = item.getBoundingClientRect()
      track.scrollBy({ left: i.left + i.width / 2 - (tr.left + tr.width / 2) })
    }
    updateFade()
  }, [focusIndex, updateFade])
  useEffect(() => {
    const el = trackRef.current
    if (!el) return
    const ro = new ResizeObserver(updateFade)
    ro.observe(el)
    return () => ro.disconnect()
  }, [updateFade])

  if (!focus) return null
  const hasCurrent = model.currentIndex >= 0
  const chapterCount = model.chapters.length
  const emoji = getChapterEmoji(focus.chapter)

  const goPrev = () => model.prev && router.push(model.prev.href)
  const goNext = () => {
    if (model.next) router.push(model.next.href)
    else if (model.isLast) router.push(endHref)
  }

  const chapterOf = t('activities.progress.chapter_n_of', {
    defaultValue: 'Chapter {{n}} of {{total}}',
    n: focus.index + 1,
    total: chapterCount,
  })
  const activityOf = hasCurrent
    ? t('activities.progress.activity_n_of', {
        defaultValue: 'Activity {{n}} of {{total}}',
        n: model.positionInChapter + 1,
        total: focus.total,
      })
    : t('activities.progress.chapter_done', { defaultValue: '{{done}} of {{total}} done', done: focus.completed, total: focus.total })
  const overall = t('activities.progress.overall', {
    defaultValue: '{{done}} of {{total}} done',
    done: model.completedCount,
    total: model.total,
  })

  // One activity on the line. Done = teal, current = dark and raised,
  // not started = light grey with a faint inset, locked = paler still.
  const segment = (item: ProgressActivity, ch: ProgressChapter, active: boolean) => (
    <ToolTip key={item.activity.activity_uuid} sideOffset={8} unstyled content={<ActivityTip item={item} ch={ch} />}>
      <Link
        href={item.href}
        prefetch={false}
        aria-current={item.current ? 'step' : undefined}
        aria-label={`${item.activity.name}, ${status(item)}`}
        className="group/seg flex-1 flex items-center h-6 focus-visible:outline-none"
        style={{ minWidth: active ? SEGMENT_MIN_ACTIVE : SEGMENT_MIN }}
      >
        <span
          className={`block w-full transition-all group-focus-visible/seg:ring-2 group-focus-visible/seg:ring-neutral-900/30 ${
            item.current
              ? 'lh-t-progress h-[11px] rounded-full bg-neutral-900 shadow-[0_0_0_2px_#fff,0_0_0_4px_rgba(23,23,23,0.12)]'
              : item.done
                ? `lh-t-progress-soft ${active ? 'h-2' : 'h-[7px]'} bg-teal-500 group-hover/seg:bg-teal-600`
                : item.locked
                  ? `${active ? 'h-2' : 'h-[7px]'} bg-neutral-100`
                  : `${active ? 'h-2 bg-neutral-300/80' : 'h-[7px] bg-neutral-200'} group-hover/seg:bg-neutral-400`
          }`}
        />
      </Link>
    </ToolTip>
  )

  return (
    <nav aria-label={t('activities.progress.label', 'Course progress')} className="w-full min-w-0" data-course-progress="">
      {/* Line 1: where you are, in words. */}
      <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
        {enableNavigation && (
          <button
            type="button"
            onClick={goPrev}
            disabled={!model.prev}
            className={NAV_BTN}
            aria-label={model.prev ? `${t('activities.previous_activity')}: ${model.prev.activity.name}` : t('activities.previous_activity')}
          >
            <CaretLeft size={16} weight="bold" className="rtl:rotate-180" />
          </button>
        )}

        <div className="min-w-0 flex-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-neutral-400 tabular-nums">{chapterOf}</span>
          <span className="min-w-0 truncate text-sm font-semibold text-neutral-900">
            {emoji && (
              <span aria-hidden="true" className="me-1">
                {emoji}
              </span>
            )}
            {focus.chapter?.name}
          </span>
          <span className="shrink-0 text-xs text-neutral-500 tabular-nums">· {activityOf}</span>
        </div>

        <span className="hidden md:inline shrink-0 text-xs text-neutral-400 tabular-nums">{overall}</span>

        <Popover open={outlineOpen} onOpenChange={setOutlineOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-haspopup="dialog"
              className="shrink-0 inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-xs font-semibold text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/20"
            >
              <ListBullets size={15} weight="bold" />
              <span className="hidden sm:inline">{t('activities.progress.all_chapters', 'All chapters')}</span>
              <CaretDown size={11} weight="bold" className={`transition-transform ${outlineOpen ? 'rotate-180' : ''}`} />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" sideOffset={8} className="w-[min(92vw,380px)] p-0 overflow-hidden rounded-xl border-0 bg-white nice-shadow">
            <div className="px-4 pt-3.5 pb-3 border-b border-neutral-100">
              <p className="text-sm font-semibold text-neutral-900 truncate">{props.course?.name}</p>
              <div className="mt-2 flex items-center gap-3">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-100">
                  <div className="lh-t-progress h-full rounded-full bg-teal-500" style={{ width: `${model.percent}%` }} />
                </div>
                <span className="text-xs font-medium tabular-nums text-neutral-500">{overall}</span>
              </div>
            </div>
            <div className="max-h-[min(65vh,520px)] overflow-y-auto overscroll-contain">
              <CourseOutlineList model={model} onNavigate={() => setOutlineOpen(false)} />
            </div>
          </PopoverContent>
        </Popover>

        {enableNavigation && (
          <button
            type="button"
            onClick={goNext}
            disabled={!model.next && !model.isLast}
            className={NAV_BTN}
            aria-label={model.next ? `${t('activities.next_activity')}: ${model.next.activity.name}` : t('course.finish_course', 'Finish course')}
          >
            {model.isLast ? <Flag size={15} weight="fill" /> : <CaretRight size={16} weight="bold" className="rtl:rotate-180" />}
          </button>
        )}
      </div>

      {/* Line 2: the line. Each chapter is a circle followed by one segment
          per activity, glued together as in the original navigator. Flex
          order follows the writing direction, so RTL reads right to left. */}
      <div
        className="relative mt-2"
        style={
          fade.start || fade.end
            ? {
                maskImage: `linear-gradient(to ${fade.rtl ? 'left' : 'right'}, ${fade.start ? 'transparent' : '#000'} 0, #000 28px, #000 calc(100% - 28px), ${fade.end ? 'transparent' : '#000'} 100%)`,
                WebkitMaskImage: `linear-gradient(to ${fade.rtl ? 'left' : 'right'}, ${fade.start ? 'transparent' : '#000'} 0, #000 28px, #000 calc(100% - 28px), ${fade.end ? 'transparent' : '#000'} 100%)`,
              }
            : undefined
        }
      >
        <ol
          ref={trackRef}
          onScroll={updateFade}
          className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide py-1"
          aria-label={t('activities.progress.track_label', 'Chapters and activities')}
        >
          {model.chapters.map((ch) => {
            const active = ch.index === focus.index
            const chapterLabel = `${t('activities.progress.chapter_n', { defaultValue: 'Chapter {{n}}', n: ch.index + 1 })}: ${ch.chapter?.name ?? ''}, ${t('activities.progress.chapter_done', { defaultValue: '{{done}} of {{total}} done', done: ch.completed, total: ch.total })}`
            const marker = (
              <ToolTip sideOffset={8} unstyled content={<ChapterTip ch={ch} />}>
                {ch.firstHref ? (
                  <Link
                    href={ch.firstHref}
                    prefetch={false}
                    aria-label={chapterLabel}
                    className="shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/30"
                  >
                    <ChapterMarker ch={ch} active={active} />
                  </Link>
                ) : (
                  <span aria-label={chapterLabel}>
                    <ChapterMarker ch={ch} active={active} />
                  </span>
                )}
              </ToolTip>
            )

            const collapsed = (!active && ch.total > MAX_SEGMENTS_COLLAPSED) || ch.total > MAX_SEGMENTS
            const pct = ch.total ? (ch.completed / ch.total) * 100 : 0
            const markerPos = active && model.positionInChapter >= 0 ? ((model.positionInChapter + 0.5) / ch.total) * 100 : null
            // Width follows the number of activities; the current chapter
            // gets extra room so its segments read clearly.
            const weight = Math.max(collapsed ? Math.min(ch.total, MAX_SEGMENTS_COLLAPSED) : ch.total, 1) * (active ? 2 : 1)
            const minWidth =
              (active ? 28 : 22) +
              (ch.total === 0 ? 0 : collapsed ? 48 : ch.total * ((active ? SEGMENT_MIN_ACTIVE : SEGMENT_MIN) + 2))
            return (
              <li
                key={ch.chapter?.id ?? ch.index}
                aria-current={active && hasCurrent ? 'location' : undefined}
                data-focus-chapter={active ? '' : undefined}
                className="flex items-center"
                style={{ flexGrow: weight, flexBasis: 0, minWidth }}
              >
                {marker}
                {ch.total > 0 &&
                  (collapsed ? (
                    <span className="relative flex-1 h-[7px] -ms-1 rounded-e-full bg-neutral-200 overflow-hidden">
                      <span className="lh-t-progress absolute inset-y-0 start-0 bg-teal-500" style={{ width: `${pct}%` }} />
                      {markerPos !== null && (
                        <span className="lh-t-progress absolute inset-y-0 w-2 -ms-1 rounded-full bg-neutral-900" style={{ insetInlineStart: `${markerPos}%` }} />
                      )}
                    </span>
                  ) : (
                    // Segments start under the circle's edge so the chapter
                    // and its activities read as one piece of the line.
                    <span className="flex-1 min-w-0 flex items-center gap-[2px] -ms-1 [&>*:last-child>span]:rounded-e-full [&>*:not(:last-child)>span:not([class*='rounded-full'])]:rounded-[1px]">
                      {ch.activities.map((item) => segment(item, ch, active))}
                    </span>
                  ))}
              </li>
            )
          })}
          {showCertificationBadge && (
            <li className="shrink-0 flex items-center ps-1">
              <CertificationBadge href={endHref} isCompleted={model.isCourseCompleted} />
            </li>
          )}
        </ol>
      </div>
    </nav>
  )
}

export default memo(ActivityIndicators)
