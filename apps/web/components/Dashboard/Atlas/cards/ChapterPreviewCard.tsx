'use client'

import React from 'react'

import { AtlasEvent } from '@services/ai/atlas'
import { BookOpen, Folder, ListPlus, MoveRight, Pencil, Trash2 } from 'lucide-react'

import { MessagePending } from '../AtlasChat'
import BlastRadiusList from './primitives/BlastRadiusList'
import KeyValueDiff from './primitives/KeyValueDiff'

// Typed renderer for ``preview.chapter`` events. Replaces the raw
// ``<pre>{JSON.stringify(...)}</pre>`` dump. Mode-routed so each kind
// of edit gets the right affordances (rename → just name diff; delete
// → blast radius; move/reorder → list view).

interface Props {
  pending: MessagePending
}

const CHAPTER_FIELD_LABELS = {
  name: 'Name',
  description: 'Description',
  lock_type: 'Visibility',
  thumbnail_image: 'Thumbnail',
  extra_metadata: 'Metadata',
}

export default function ChapterPreviewCard({ pending }: Props) {
  const evt = pending.preview as Extract<AtlasEvent, { type: 'preview.chapter' }>
  const mode = evt.mode

  let modeIcon = <Pencil size={11} className="text-violet-300" />
  let modeLabel = 'Edit'
  if (mode === 'rename') {
    modeIcon = <Pencil size={11} className="text-violet-300" />
    modeLabel = 'Rename'
  } else if (mode === 'create') {
    modeIcon = <ListPlus size={11} className="text-emerald-300" />
    modeLabel = 'Create'
  } else if (mode === 'delete') {
    modeIcon = <Trash2 size={11} className="text-rose-300" />
    modeLabel = 'Delete'
  } else if (mode === 'move_activities') {
    modeIcon = <MoveRight size={11} className="text-sky-300" />
    modeLabel = 'Move activities'
  } else if (mode === 'reorder') {
    modeIcon = <Folder size={11} className="text-sky-300" />
    modeLabel = 'Reorder'
  }

  return (
    <div className="mt-3 rounded-xl ring-1 ring-inset ring-white/10 bg-black/20 overflow-hidden">
      <div className="px-4 py-3 border-b border-white/10 bg-gradient-to-b from-violet-500/10 to-transparent">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider font-semibold text-violet-300/80 mb-1">
          <BookOpen size={11} className="text-violet-300" />
          Chapter · {modeIcon} <span className="text-white/70">{modeLabel}</span>
        </div>
        <div className="text-[15px] font-semibold text-white/95 truncate">
          {evt.target.name || '(new chapter)'}
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
  evt: Extract<AtlasEvent, { type: 'preview.chapter' }>,
  mode: Extract<AtlasEvent, { type: 'preview.chapter' }>['mode'],
) {
  if (mode === 'create') {
    return (
      <div className="space-y-2 text-sm">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-white/40 mb-0.5">Name</div>
          <div className="text-white/90 font-medium">{evt.patch?.name || '—'}</div>
        </div>
        {evt.patch?.description && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-white/40 mb-0.5">Description</div>
            <div className="text-white/75">{evt.patch.description}</div>
          </div>
        )}
        {evt.patch?.position !== undefined && evt.patch?.position !== null && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-white/40 mb-0.5">Position</div>
            <div className="text-white/75">{Number(evt.patch.position) + 1}</div>
          </div>
        )}
      </div>
    )
  }

  if (mode === 'delete') {
    const activities = Array.isArray((evt.current as any)?.activities)
      ? (evt.current as any).activities.map((a: any) => ({
          uuid: a.uuid || a.activity_uuid,
          name: a.name,
        }))
      : undefined
    const counts: { label: string; value: number }[] = []
    if (activities) counts.push({ label: 'activities', value: activities.length })
    return (
      <BlastRadiusList
        title="This chapter will be removed"
        summary={
          activities?.length
            ? `All ${activities.length} activity(ies) inside this chapter are deleted along with the chapter itself.`
            : 'The chapter is removed; no contained activities found in current state.'
        }
        counts={counts}
        items={activities}
      />
    )
  }

  if (mode === 'move_activities') {
    const list: string[] = Array.isArray(evt.patch?.activity_uuids)
      ? evt.patch.activity_uuids
      : []
    return (
      <div className="space-y-2 text-sm">
        <div className="flex items-center gap-2 text-white/75">
          <span className="text-white/45">Moving</span>
          <span className="font-semibold">{list.length} activity{list.length === 1 ? '' : 'ies'}</span>
          <MoveRight size={14} className="text-white/35" />
          <span className="text-white/45">into</span>
          <span className="font-semibold">{evt.target.name || '(chapter)'}</span>
        </div>
        {list.length > 0 && (
          <ul className="space-y-0.5 text-xs text-white/55 pl-4">
            {list.slice(0, 12).map((u, i) => (
              <li key={u} className="font-mono">{u}</li>
            ))}
            {list.length > 12 && (
              <li className="italic">… and {list.length - 12} more</li>
            )}
          </ul>
        )}
      </div>
    )
  }

  if (mode === 'reorder') {
    const order: any[] = Array.isArray(evt.patch?.new_order) ? evt.patch.new_order : []
    return (
      <div className="space-y-1.5 text-sm">
        <div className="text-[10px] uppercase tracking-wider text-white/40">New order</div>
        <ol className="list-decimal pl-5 space-y-0.5">
          {order.map((o, i) => (
            <li key={`${i}-${o}`} className="text-white/80">
              <span className="font-mono text-[12px]">{String(o)}</span>
            </li>
          ))}
        </ol>
      </div>
    )
  }

  // edit / rename: diff the present fields.
  // proposed shape sits on patch when from propose_chapter_edit
  const proposed = (evt.patch as Record<string, any>) || null
  const current = (evt.current as Record<string, any>) || null
  return (
    <KeyValueDiff
      before={current}
      after={proposed}
      labelMap={CHAPTER_FIELD_LABELS}
    />
  )
}
