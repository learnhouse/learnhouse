'use client'

import React from 'react'

import { BookOpen, FileText, Folder, X as XIcon } from 'lucide-react'

import { AtlasPageContext, useAtlasMini } from '../AtlasMiniContext'

// Surfaces what Atlas currently thinks it's editing — course → chapter →
// activity. Each chip is clickable to drop that level (and below) of
// the context, so the user can scope up without leaving the panel.
// Lives below the panel header / at the top of the full-page chat.

interface Props {
  // When true, the breadcrumb shows even with no context (renders a
  // muted "No focus" hint instead of nothing). Useful for the panel
  // header so the bar's height stays consistent.
  alwaysVisible?: boolean
  compact?: boolean
}

export default function PageContextBreadcrumb({ alwaysVisible, compact }: Props) {
  const { pageContext, setPageContext } = useAtlasMini()
  const ctx = pageContext
  const hasAnything =
    !!ctx && !!(ctx.course_uuid || ctx.chapter_id || ctx.activity_uuid)

  if (!hasAnything && !alwaysVisible) return null

  const clearActivity = () => {
    if (!ctx) return
    setPageContext({
      ...ctx,
      activity_uuid: undefined,
      activity_name: undefined,
    } as AtlasPageContext)
  }
  const clearChapter = () => {
    if (!ctx) return
    setPageContext({
      ...ctx,
      chapter_id: undefined,
      chapter_name: undefined,
      activity_uuid: undefined,
      activity_name: undefined,
    } as AtlasPageContext)
  }
  const clearCourse = () => setPageContext(null)

  return (
    <div
      className={`flex flex-wrap items-center gap-1.5 ${
        compact ? 'px-3 py-1.5' : 'px-4 py-2'
      } bg-white/[0.02] ring-1 ring-inset ring-white/[0.04]`}
    >
      <span className="text-[10px] uppercase tracking-wider text-white/35 font-semibold mr-1">
        Focus
      </span>
      {!hasAnything && (
        <span className="text-[11px] italic text-white/35">No focus</span>
      )}
      {ctx?.course_uuid && (
        <Chip
          icon={<BookOpen size={11} className="text-violet-300" />}
          label={ctx.course_name || 'Course'}
          onClear={clearCourse}
        />
      )}
      {ctx?.chapter_id !== undefined && ctx?.chapter_id !== null && (
        <>
          <Sep />
          <Chip
            icon={<Folder size={11} className="text-sky-300" />}
            label={ctx.chapter_name || 'Chapter'}
            onClear={clearChapter}
          />
        </>
      )}
      {ctx?.activity_uuid && (
        <>
          <Sep />
          <Chip
            icon={<FileText size={11} className="text-emerald-300" />}
            label={ctx.activity_name || 'Activity'}
            onClear={clearActivity}
          />
        </>
      )}
    </div>
  )
}

function Chip({
  icon,
  label,
  onClear,
}: {
  icon: React.ReactNode
  label: string
  onClear: () => void
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-white/[0.04] ring-1 ring-inset ring-white/[0.08] px-2 py-0.5 text-[11px] text-white/80 max-w-[14rem]">
      {icon}
      <span className="truncate">{label}</span>
      <button
        type="button"
        onClick={onClear}
        aria-label="Clear focus"
        className="text-white/35 hover:text-white/75 flex-none"
      >
        <XIcon size={10} />
      </button>
    </span>
  )
}

function Sep() {
  return <span className="text-white/25 text-[10px]">/</span>
}
