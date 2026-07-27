'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'

import { useLHSession } from '@components/Contexts/LHSessionContext'
import { FileText, Folder, Loader2, Paperclip, Search } from 'lucide-react'

import { useAtlasMini } from '../AtlasMiniContext'

// Inline "+" attach button on the composer. Opens a popover listing the
// chapters and activities of the currently-focused course so the user
// can pin a structured reference without leaving the chat. Falls back
// to a polite empty state when no course is focused.

interface CourseSnapshot {
  chapters?: Array<{
    chapter_uuid?: string
    id?: number
    name?: string
    activities?: Array<{
      activity_uuid?: string
      name?: string
      activity_type?: string
    }>
  }>
}

export default function ReferencePicker() {
  const { pageContext, attachReference, attachedReferences } = useAtlasMini()
  const session = useLHSession() as any
  const accessToken: string | undefined = session?.data?.tokens?.access_token

  const [open, setOpen] = useState(false)
  const [snapshot, setSnapshot] = useState<CourseSnapshot | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')

  const wrapperRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onClick)
    return () => window.removeEventListener('mousedown', onClick)
  }, [open])

  // Load the course snapshot when the popover opens.
  useEffect(() => {
    if (!open || !pageContext?.course_uuid || !accessToken) return
    let cancelled = false
    setLoading(true)
    setError(null)
    const url = `${getApiBase()}courses/${pageContext.course_uuid}`
    fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to load course (${res.status})`)
        return res.json()
      })
      .then((data) => {
        if (!cancelled) setSnapshot(data)
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message || 'Failed to load.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, pageContext?.course_uuid, accessToken])

  const filtered = useMemo(() => {
    if (!snapshot?.chapters) return []
    const q = filter.trim().toLowerCase()
    if (!q) return snapshot.chapters
    return snapshot.chapters
      .map((c) => ({
        ...c,
        activities: (c.activities || []).filter((a) =>
          (a.name || '').toLowerCase().includes(q),
        ),
      }))
      .filter(
        (c) =>
          (c.name || '').toLowerCase().includes(q) ||
          (c.activities || []).length > 0,
      )
  }, [snapshot, filter])

  const isAttached = (type: 'activity' | 'chapter', uuid: string) =>
    attachedReferences.some((r) => r.type === type && r.uuid === uuid)

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Attach reference"
        aria-label="Attach reference"
        className="flex items-center justify-center w-9 h-9 rounded-xl ring-1 ring-inset ring-white/[0.06] bg-white/[0.02] text-white/55 hover:text-white/85 hover:bg-white/[0.04] transition-colors"
      >
        <Paperclip size={14} />
      </button>
      {open && (
        <div className="absolute bottom-full right-0 mb-2 w-[320px] max-h-[420px] flex flex-col rounded-xl ring-1 ring-inset ring-white/10 bg-zinc-900/95 backdrop-blur shadow-2xl shadow-black/40 overflow-hidden">
          <div className="px-3 py-2 border-b border-white/[0.06] flex items-center gap-2">
            <Search size={12} className="text-white/40" />
            <input
              autoFocus
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={
                pageContext?.course_uuid
                  ? 'Find activity or chapter…'
                  : 'No course focused'
              }
              disabled={!pageContext?.course_uuid}
              className="flex-1 bg-transparent text-sm text-white placeholder:text-white/30 outline-none"
            />
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto">
            {!pageContext?.course_uuid ? (
              <div className="px-3 py-4 text-[12px] text-white/45 italic">
                Open a course to pick references from it.
              </div>
            ) : loading ? (
              <div className="flex items-center gap-2 px-3 py-4 text-[12px] text-white/45">
                <Loader2 size={12} className="animate-spin" />
                Loading…
              </div>
            ) : error ? (
              <div className="px-3 py-4 text-[12px] text-rose-200/80">{error}</div>
            ) : filtered.length === 0 ? (
              <div className="px-3 py-4 text-[12px] text-white/45 italic">
                Nothing matches.
              </div>
            ) : (
              <ul className="py-1">
                {filtered.map((ch) => (
                  <li key={ch.chapter_uuid || `c-${ch.id}`} className="mb-1.5">
                    <button
                      type="button"
                      disabled={!ch.chapter_uuid || isAttached('chapter', ch.chapter_uuid)}
                      onClick={() => {
                        if (!ch.chapter_uuid || !pageContext?.course_uuid) return
                        attachReference({
                          type: 'chapter',
                          uuid: ch.chapter_uuid,
                          name: ch.name || 'Chapter',
                          parent_course_uuid: pageContext.course_uuid,
                          parent_chapter_id: ch.id,
                          parent_chapter_name: ch.name,
                        })
                      }}
                      className="w-full text-left flex items-center gap-2 px-3 py-1.5 text-[12px] text-white/80 hover:bg-white/[0.04] disabled:opacity-40"
                    >
                      <Folder size={11} className="text-sky-300 flex-none" />
                      <span className="font-medium truncate flex-1">{ch.name || 'Untitled chapter'}</span>
                      {ch.chapter_uuid && isAttached('chapter', ch.chapter_uuid) && (
                        <span className="text-[10px] text-emerald-300">attached</span>
                      )}
                    </button>
                    {(ch.activities || []).length > 0 && (
                      <ul className="pl-2">
                        {(ch.activities || []).map((a) => (
                          <li key={a.activity_uuid || a.name}>
                            <button
                              type="button"
                              disabled={!a.activity_uuid || isAttached('activity', a.activity_uuid!)}
                              onClick={() => {
                                if (!a.activity_uuid || !pageContext?.course_uuid) return
                                attachReference({
                                  type: 'activity',
                                  uuid: a.activity_uuid,
                                  name: a.name || 'Activity',
                                  parent_course_uuid: pageContext.course_uuid,
                                  parent_chapter_id: ch.id,
                                  parent_chapter_name: ch.name,
                                  activity_type: a.activity_type,
                                })
                              }}
                              className="w-full text-left flex items-center gap-2 pl-7 pr-3 py-1 text-[12px] text-white/70 hover:bg-white/[0.04] disabled:opacity-40"
                            >
                              <FileText size={10} className="text-emerald-300/70 flex-none" />
                              <span className="truncate flex-1">{a.name || 'Untitled'}</span>
                              {a.activity_uuid && isAttached('activity', a.activity_uuid) && (
                                <span className="text-[10px] text-emerald-300">attached</span>
                              )}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function getApiBase() {
  // ``getAPIUrl`` from @services/config/config returns the trailing-slash
  // base URL the rest of the app uses. We re-implement to avoid an
  // import cycle with services/ai/atlas.ts.
  if (typeof process !== 'undefined') {
    const url = (process as any).env?.NEXT_PUBLIC_LEARNHOUSE_API_URL
    if (url) return url
  }
  return '/api/v1/'
}
