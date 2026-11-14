'use client'
import React, { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import {
  Backpack,
  Browsers,
  CaretDown,
  CheckCircle,
  Circle,
  Cube,
  FileText,
  Globe,
  LockSimple,
  MarkdownLogo,
  Package,
  PlayCircle,
  PuzzlePiece,
  Radio,
  Lightning,
} from '@phosphor-icons/react'
import { ChapterEmoji } from '@components/Objects/Courses/ChapterEmoji/ChapterEmoji'
import type { CourseProgressModel, ProgressActivity } from './courseProgress'

export function ActivityTypeGlyph({ activity, size = 14, className = '' }: { activity: any; size?: number; className?: string }) {
  const sub = activity?.activity_sub_type
  const Icon =
    sub === 'SUBTYPE_DYNAMIC_MARKDOWN'
      ? MarkdownLogo
      : sub === 'SUBTYPE_DYNAMIC_EMBED'
        ? Globe
        : sub === 'SUBTYPE_DYNAMIC_RESOURCE'
          ? Cube
          : ({
              TYPE_VIDEO: PlayCircle,
              TYPE_DOCUMENT: FileText,
              TYPE_DYNAMIC: Browsers,
              TYPE_ASSIGNMENT: Backpack,
              TYPE_SCORM: Package,
              TYPE_LIVE_SESSION: Radio,
              TYPE_PLAY: Lightning,
              TYPE_CUSTOM: PuzzlePiece,
            } as Record<string, React.ElementType>)[activity?.activity_type] ?? FileText
  return <Icon size={size} className={className} aria-hidden="true" />
}

// Status mark used in the outline and tooltips. Colours match the track:
// teal = done, near-black = current, grey = not started, lock = locked.
export function StatusMark({ item, size = 18 }: { item: ProgressActivity; size?: number }) {
  const { t } = useTranslation()
  if (item.done) {
    return <CheckCircle size={size} weight="fill" className="shrink-0 text-teal-500" aria-label={t('common.completed')} />
  }
  if (item.locked) {
    return <LockSimple size={size - 2} className="shrink-0 text-neutral-400" aria-label={t('activities.progress.locked', 'Locked')} />
  }
  if (item.current) {
    return (
      <span className="shrink-0 flex items-center justify-center" style={{ width: size, height: size }} aria-label={t('activities.current_activity')}>
        <span className="w-[60%] h-[60%] rounded-full ring-[3px] ring-neutral-900/15 bg-neutral-900" />
      </span>
    )
  }
  return <Circle size={size} className="shrink-0 text-neutral-300" aria-label={t('activities.not_started')} />
}

// Chapters and their activities, for jumping anywhere in the course. Only the
// focused chapter starts open, so a 15-chapter course stays scannable; the
// current activity is scrolled into view when the list opens.
export function CourseOutlineList({
  model,
  onNavigate,
  size = 'md',
}: {
  model: CourseProgressModel
  onNavigate?: () => void
  size?: 'md' | 'lg'
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState<Set<number>>(() => new Set([model.focusChapterIndex]))
  const currentRef = useRef<HTMLAnchorElement | null>(null)
  const lg = size === 'lg'

  useEffect(() => {
    const id = window.setTimeout(() => currentRef.current?.scrollIntoView({ block: 'center' }), 60)
    return () => window.clearTimeout(id)
  }, [])

  const toggle = (index: number) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })

  return (
    <div className="divide-y divide-neutral-100">
      {model.chapters.map((ch) => {
        const isOpen = open.has(ch.index)
        const listId = `outline-chapter-${ch.index}`
        const complete = ch.total > 0 && ch.completed === ch.total
        return (
          <section key={ch.chapter?.id ?? ch.index}>
            <button
              type="button"
              onClick={() => toggle(ch.index)}
              aria-expanded={isOpen}
              aria-controls={listId}
              className={`w-full flex items-center gap-3 px-4 text-start hover:bg-neutral-50 transition-colors ${lg ? 'py-3.5' : 'py-2.5'}`}
            >
              <span
                className={`w-6 h-6 shrink-0 rounded-full flex items-center justify-center text-[11px] font-semibold tabular-nums ${
                  complete
                    ? 'bg-teal-500 text-white'
                    : ch.current
                      ? 'bg-neutral-900 text-white'
                      : 'bg-neutral-100 text-neutral-500'
                }`}
              >
                {ch.index + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className={`block truncate font-semibold text-neutral-900 ${lg ? 'text-[15px]' : 'text-sm'}`}>
                  <ChapterEmoji chapter={ch.chapter} />
                  {ch.chapter?.name}
                </span>
                <span className="block text-xs text-neutral-400 tabular-nums">
                  {t('activities.progress.chapter_done', { defaultValue: '{{done}} of {{total}} done', done: ch.completed, total: ch.total })}
                </span>
              </span>
              {ch.locked && <LockSimple size={14} className="shrink-0 text-neutral-400" aria-label={t('activities.progress.locked', 'Locked')} />}
              <CaretDown size={14} className={`shrink-0 text-neutral-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </button>
            {isOpen && (
              <ul id={listId} className="pb-2 px-2">
                {ch.activities.map((item) => (
                  <li key={item.activity.activity_uuid}>
                    <Link
                      ref={item.current ? currentRef : undefined}
                      href={item.href}
                      prefetch={false}
                      onClick={onNavigate}
                      aria-current={item.current ? 'page' : undefined}
                      className={`flex items-center gap-3 rounded-lg px-2.5 transition-colors ${lg ? 'min-h-[48px]' : 'min-h-[38px]'} ${
                        item.current ? 'bg-neutral-100' : 'hover:bg-neutral-50'
                      }`}
                    >
                      <StatusMark item={item} size={lg ? 20 : 17} />
                      <span
                        className={`flex-1 min-w-0 truncate ${lg ? 'text-[15px]' : 'text-sm'} ${
                          item.current ? 'font-semibold text-neutral-900' : item.done ? 'text-neutral-500' : 'text-neutral-700'
                        }`}
                      >
                        {item.activity.name}
                      </span>
                      <ActivityTypeGlyph activity={item.activity} className="shrink-0 text-neutral-300" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )
      })}
    </div>
  )
}
