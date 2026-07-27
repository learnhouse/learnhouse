'use client'
import React from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'motion/react'
import { ChevronLeft, ChevronRight, Folder } from 'lucide-react'
import {
  Backpack,
  FileText,
  Note,
  Video,
  Package,
  PuzzlePiece,
  MarkdownLogo,
  Globe,
} from '@phosphor-icons/react'

import { useAuth } from '@components/Contexts/AuthContext'
import { getCourseMetadata } from '@services/courses/courses'

interface ActivitySwitcherProps {
  course: { course_uuid: string }
  activity: { activity_uuid: string; activity_type?: string; name?: string }
  isDirty?: boolean
  onSave?: () => Promise<void> | void
}

function ActivityTypeIcon({ type, subType, size = 12 }: { type?: string; subType?: string; size?: number }) {
  if (subType === 'SUBTYPE_DYNAMIC_MARKDOWN') return <MarkdownLogo size={size} weight="fill" />
  if (subType === 'SUBTYPE_DYNAMIC_EMBED') return <Globe size={size} weight="fill" />
  switch (type) {
    case 'TYPE_VIDEO':
      return <Video size={size} weight="fill" />
    case 'TYPE_DOCUMENT':
      return <FileText size={size} weight="fill" />
    case 'TYPE_ASSIGNMENT':
      return <Backpack size={size} weight="fill" />
    case 'TYPE_SCORM':
      return <Package size={size} weight="fill" />
    case 'TYPE_CUSTOM':
      return <PuzzlePiece size={size} weight="fill" />
    case 'TYPE_DYNAMIC':
    default:
      return <Note size={size} weight="fill" />
  }
}

const ease: [number, number, number, number] = [0.22, 1, 0.36, 1]

export default function ActivitySwitcher({
  course,
  activity,
  isDirty,
  onSave,
}: ActivitySwitcherProps) {
  const router = useRouter()
  const { accessToken } = useAuth()
  const [open, setOpen] = React.useState(false)
  const closeTimerRef = React.useRef<number | null>(null)
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const [canScrollLeft, setCanScrollLeft] = React.useState(false)
  const [canScrollRight, setCanScrollRight] = React.useState(false)

  const courseUuid = course?.course_uuid
  const cleanCourseUuid = courseUuid?.replace('course_', '') ?? ''
  const currentActivityUuid = activity?.activity_uuid

  // Share the cache entry with CourseProvider's withUnpublishedActivities
  // variant so a single fetch backs both consumers.
  const { data } = useQuery({
    queryKey: ['course', cleanCourseUuid, 'meta', 'withUnpublished'],
    queryFn: () =>
      getCourseMetadata(
        cleanCourseUuid,
        {},
        accessToken ?? undefined,
        { withUnpublishedActivities: true }
      ),
    enabled: !!cleanCourseUuid && !!accessToken,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    placeholderData: (prev) => prev,
  })

  const chapters: any[] = data?.chapters ?? []
  const hasChapters = chapters.length > 0

  const cancelClose = () => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
  }

  const handleEnter = () => {
    cancelClose()
    setOpen(true)
  }

  const handleLeave = () => {
    cancelClose()
    closeTimerRef.current = window.setTimeout(() => setOpen(false), 160)
  }

  React.useEffect(() => () => cancelClose(), [])

  const updateScrollState = React.useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    setCanScrollLeft(el.scrollLeft > 2)
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 2)
  }, [])

  React.useEffect(() => {
    if (!open) return
    const id = requestAnimationFrame(updateScrollState)
    return () => cancelAnimationFrame(id)
  }, [open, chapters.length, updateScrollState])

  const scrollByAmount = (delta: number) => {
    scrollRef.current?.scrollBy({ left: delta, behavior: 'smooth' })
  }

  const handleSwitch = async (
    event: React.MouseEvent<HTMLAnchorElement>,
    href: string
  ) => {
    // Same-activity click — let the default no-op happen.
    if (href.includes(`/activity/${(currentActivityUuid ?? '').replace('activity_', '')}/`)) {
      return
    }
    event.preventDefault()
    if (isDirty) {
      const proceed = window.confirm(
        'You have unsaved changes. Save before switching activities?\n\nOK = Save and switch\nCancel = Stay on this activity'
      )
      if (!proceed) return
      try {
        await onSave?.()
      } catch (err) {
        console.error('Save failed before switching activity', err)
        return
      }
    }
    router.push(href)
  }

  return (
    <div
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      style={{
        position: 'absolute',
        top: -15,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 2,
      }}
    >
      <motion.div
        layout
        transition={{ layout: { duration: 0.35, ease } }}
        className="nice-shadow bg-white rounded-full overflow-hidden flex items-center"
      >
        {/* Always-visible 3-dot indicator */}
        <div className="flex items-center justify-center gap-[3px] px-2.5 h-[22px] text-neutral-500 flex-shrink-0">
          <span className="w-[3px] h-[3px] rounded-full bg-current" />
          <span className="w-[3px] h-[3px] rounded-full bg-current" />
          <span className="w-[3px] h-[3px] rounded-full bg-current" />
        </div>

        <AnimatePresence initial={false}>
          {open && hasChapters && (
            <motion.div
              key="strip"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, transition: { duration: 0.2, ease, delay: 0.08 } }}
              exit={{ opacity: 0, transition: { duration: 0.12, ease } }}
              className="flex items-center gap-1 pl-1 pr-1.5 py-0.5"
            >
              <button
                type="button"
                onClick={() => scrollByAmount(-200)}
                disabled={!canScrollLeft}
                aria-label="Scroll left"
                className={
                  'flex items-center justify-center w-6 h-6 rounded-full bg-neutral-100 text-neutral-600 hover:bg-neutral-200 active:bg-neutral-300 transition-all flex-shrink-0 ' +
                  (canScrollLeft ? 'opacity-100' : 'opacity-30 pointer-events-none')
                }
              >
                <ChevronLeft size={14} />
              </button>
              <div
                ref={scrollRef}
                onScroll={updateScrollState}
                className="flex items-center gap-1 px-1.5 max-w-[min(70vw,760px)] overflow-x-auto scrollbar-hide"
              >
                {chapters.map((chapter: any, idx: number) => (
                <React.Fragment key={chapter.id ?? chapter.chapter_uuid ?? idx}>
                  {idx > 0 && (
                    <div
                      aria-hidden
                      className="w-px h-3 bg-neutral-200 flex-shrink-0 mx-0.5"
                    />
                  )}
                  <div
                    className="flex items-center gap-1 text-[9px] text-neutral-400 font-semibold uppercase tracking-wide flex-shrink-0 px-1"
                    title={chapter.name}
                  >
                    <Folder size={9} />
                    <span className="truncate max-w-[100px]">{chapter.name}</span>
                  </div>
                  {(chapter.activities ?? []).map((act: any) => {
                    const isCurrent = act.activity_uuid === currentActivityUuid
                    const cleanActivityUuid =
                      (act.activity_uuid ?? '').replace('activity_', '')
                    const href = `/course/${cleanCourseUuid}/activity/${cleanActivityUuid}/edit`
                    return (
                      <a
                        key={act.id ?? act.activity_uuid}
                        href={href}
                        onClick={(e) => handleSwitch(e, href)}
                        aria-current={isCurrent ? 'page' : undefined}
                        className={
                          'flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap transition-colors flex-shrink-0 ' +
                          (isCurrent
                            ? 'bg-neutral-900 text-white'
                            : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200')
                        }
                        title={act.name}
                      >
                        <ActivityTypeIcon type={act.activity_type} subType={act.activity_sub_type} size={11} />
                        <span className="max-w-[150px] truncate">{act.name}</span>
                      </a>
                    )
                  })}
                </React.Fragment>
              ))}
              </div>
              <button
                type="button"
                onClick={() => scrollByAmount(200)}
                disabled={!canScrollRight}
                aria-label="Scroll right"
                className={
                  'flex items-center justify-center w-6 h-6 rounded-full bg-neutral-100 text-neutral-600 hover:bg-neutral-200 active:bg-neutral-300 transition-all flex-shrink-0 ' +
                  (canScrollRight ? 'opacity-100' : 'opacity-30 pointer-events-none')
                }
              >
                <ChevronRight size={14} />
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  )
}
