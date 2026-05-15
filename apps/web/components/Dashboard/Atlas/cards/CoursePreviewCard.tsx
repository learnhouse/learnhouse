'use client'

import React from 'react'

import { AtlasEvent } from '@services/ai/atlas'
import { GraduationCap, ListPlus, MoveRight, Pencil, Trash2 } from 'lucide-react'

import { MessagePending } from '../AtlasChat'
import BlastRadiusList from './primitives/BlastRadiusList'
import KeyValueDiff from './primitives/KeyValueDiff'

// Typed renderer for ``preview.course`` events. Same routing pattern as
// the chapter card; renders course-specific fields cleanly instead of
// dumping the raw patch JSON.

interface Props {
  pending: MessagePending
}

const COURSE_FIELD_LABELS = {
  name: 'Name',
  description: 'Description',
  about: 'About',
  learnings: 'Learner outcomes',
  tags: 'Tags',
  language: 'Language',
  public: 'Public listing',
  published: 'Published',
  open_to_contributors: 'Open to contributors',
  seo: 'SEO',
  extra_metadata: 'Metadata',
}

const COURSE_FORMATTERS = {
  learnings: (v: unknown) =>
    Array.isArray(v) && v.length > 0 ? (
      <ul className="list-disc pl-4 space-y-0.5">
        {v.map((line, i) => (
          <li key={i} className="text-[13px]">{String(line)}</li>
        ))}
      </ul>
    ) : (
      <span className="italic text-white/35">empty</span>
    ),
  tags: (v: unknown) =>
    Array.isArray(v) && v.length > 0 ? (
      <div className="flex flex-wrap gap-1">
        {v.map((tag, i) => (
          <span
            key={i}
            className="inline-flex items-center rounded-full bg-white/[0.06] ring-1 ring-inset ring-white/10 px-2 py-0.5 text-[11px] text-white/80"
          >
            {String(tag)}
          </span>
        ))}
      </div>
    ) : (
      <span className="italic text-white/35">empty</span>
    ),
}

export default function CoursePreviewCard({ pending }: Props) {
  const evt = pending.preview as Extract<AtlasEvent, { type: 'preview.course' }>
  const mode = evt.mode

  let modeIcon = <Pencil size={11} className="text-violet-300" />
  let modeLabel = 'Edit'
  if (mode === 'create') {
    modeIcon = <ListPlus size={11} className="text-emerald-300" />
    modeLabel = 'Create'
  } else if (mode === 'delete') {
    modeIcon = <Trash2 size={11} className="text-rose-300" />
    modeLabel = 'Delete'
  } else if (mode === 'reorder_chapters') {
    modeIcon = <MoveRight size={11} className="text-sky-300" />
    modeLabel = 'Reorder chapters'
  }

  return (
    <div className="mt-3 rounded-xl ring-1 ring-inset ring-white/10 bg-black/20 overflow-hidden">
      <div className="px-4 py-3 border-b border-white/10 bg-gradient-to-b from-violet-500/10 to-transparent">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider font-semibold text-violet-300/80 mb-1">
          <GraduationCap size={11} className="text-violet-300" />
          Course · {modeIcon} <span className="text-white/70">{modeLabel}</span>
        </div>
        <div className="text-[15px] font-semibold text-white/95 truncate">
          {evt.target.name || '(new course)'}
        </div>
        {evt.summary && (
          <p className="text-xs text-white/60 mt-1 leading-relaxed">{evt.summary}</p>
        )}
      </div>

      <div className="px-4 py-3">
        {renderBody(evt, mode)}
      </div>
    </div>
  )
}

function renderBody(
  evt: Extract<AtlasEvent, { type: 'preview.course' }>,
  mode: Extract<AtlasEvent, { type: 'preview.course' }>['mode'],
) {
  if (mode === 'create') {
    const p = (evt.patch as Record<string, any>) || {}
    return (
      <div className="space-y-3 text-sm">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-white/40 mb-0.5">Name</div>
          <div className="text-white/95 font-medium">{p.name || '—'}</div>
        </div>
        {p.description && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-white/40 mb-0.5">Description</div>
            <div className="text-white/75">{p.description}</div>
          </div>
        )}
        {p.about && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-white/40 mb-0.5">About</div>
            <div className="text-white/75 leading-relaxed">{p.about}</div>
          </div>
        )}
        {Array.isArray(p.learnings) && p.learnings.length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-white/40 mb-0.5">Learner outcomes</div>
            <ul className="list-disc pl-5 space-y-0.5 text-white/75">
              {p.learnings.map((l: any, i: number) => (
                <li key={i}>{String(l)}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    )
  }

  if (mode === 'delete') {
    const current = (evt.current as any) || {}
    const counts: { label: string; value: number }[] = []
    if (typeof current.chapters === 'number') counts.push({ label: 'chapters', value: current.chapters })
    if (typeof current.activities === 'number') counts.push({ label: 'activities', value: current.activities })
    return (
      <BlastRadiusList
        title="This course will be removed"
        summary="Permanently removes all chapters and activities along with any user progress."
        counts={counts}
      />
    )
  }

  if (mode === 'reorder_chapters') {
    const newOrder: any[] = Array.isArray((evt.patch as any)?.new_order)
      ? (evt.patch as any).new_order
      : []
    const currentOrder: any[] = Array.isArray((evt.current as any)?.order)
      ? (evt.current as any).order
      : []
    return (
      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-white/40 mb-1">Current order</div>
          <ol className="list-decimal pl-5 space-y-0.5">
            {currentOrder.map((o, i) => (
              <li key={`c-${i}-${o}`} className="text-white/55 font-mono text-[12px]">
                {String(o)}
              </li>
            ))}
          </ol>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-violet-300/80 mb-1">Proposed order</div>
          <ol className="list-decimal pl-5 space-y-0.5">
            {newOrder.map((o, i) => (
              <li key={`p-${i}-${o}`} className="text-white/90 font-mono text-[12px]">
                {String(o)}
              </li>
            ))}
          </ol>
        </div>
      </div>
    )
  }

  // edit
  const proposed = (evt.patch as Record<string, any>) || null
  const current = (evt.current as Record<string, any>) || null
  return (
    <KeyValueDiff
      before={current}
      after={proposed}
      labelMap={COURSE_FIELD_LABELS}
      formatMap={COURSE_FORMATTERS}
    />
  )
}
