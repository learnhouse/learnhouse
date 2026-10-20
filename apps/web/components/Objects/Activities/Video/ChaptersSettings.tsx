'use client'
import React from 'react'
import BarLoader from 'react-spinners/BarLoader'
import { ListBullets, Plus, Sparkle, X } from '@phosphor-icons/react'
import toast from 'react-hot-toast'
import { generateVideoChapters, getActivity, saveVideoChapters } from '@services/courses/activities'
import { formatClock, parseClock } from './videoSource'

interface ChapterRow {
  time: string
  title: string
}

export interface ChaptersMeta {
  status?: string
  items?: { start: number; title: string }[]
  error?: string | null
}

const POLL_MS = 3000
const MAX_POLLS = 60

const toRows = (meta?: ChaptersMeta | null): ChapterRow[] =>
  (meta?.items || []).map((c) => ({ time: formatClock(c.start), title: c.title }))

/**
 * "AI Chapters" panel for the edit-video modal: generate chapters from the
 * video's captions, then adjust times and titles by hand.
 */
export default function ChaptersSettings({
  activityUuid,
  accessToken,
  initial,
  hasCaptions,
}: {
  activityUuid: string
  accessToken: string
  initial?: ChaptersMeta | null
  hasCaptions: boolean
}) {
  const [rows, setRows] = React.useState<ChapterRow[]>(() => toRows(initial))
  const [status, setStatus] = React.useState<string | null>(initial?.status || null)
  const [busy, setBusy] = React.useState<'generate' | 'save' | null>(null)
  const cancelled = React.useRef(false)

  React.useEffect(() => {
    setRows(toRows(initial))
    setStatus(initial?.status || null)
  }, [initial])

  React.useEffect(() => () => {
    cancelled.current = true
  }, [])

  const update = (i: number, patch: Partial<ChapterRow>) =>
    setRows((r) => r.map((row, j) => (j === i ? { ...row, ...patch } : row)))

  const generate = async () => {
    setBusy('generate')
    const res = await generateVideoChapters(activityUuid, accessToken)
    if (res?.success === false) {
      toast.error(res?.data?.detail || 'Could not generate chapters')
      setBusy(null)
      return
    }
    setStatus('processing')
    for (let i = 0; i < MAX_POLLS && !cancelled.current; i++) {
      await new Promise((r) => setTimeout(r, POLL_MS))
      const data = await getActivity(activityUuid, null, accessToken)
      const meta: ChaptersMeta | undefined = data?.extra_metadata?.chapters
      if (meta?.status === 'ready' || meta?.status === 'failed') {
        setStatus(meta.status)
        if (meta.status === 'ready') {
          setRows(toRows(meta))
          toast.success('Chapters generated')
        } else {
          toast.error('Chapters could not be generated from these captions')
        }
        break
      }
    }
    setBusy(null)
  }

  const save = async () => {
    const items = rows
      .filter((r) => r.title.trim() || r.time.trim())
      .map((r) => ({ start: parseClock(r.time), title: r.title.trim() }))
    if (items.some((c) => Number.isNaN(c.start) || !c.title)) {
      toast.error('Each chapter needs a time like 1:30 and a title')
      return
    }
    setBusy('save')
    const res = await saveVideoChapters(activityUuid, items, accessToken)
    if (res?.success === false) {
      toast.error(res?.data?.detail || 'Could not save chapters')
    } else {
      setRows(toRows(res?.data))
      setStatus(res?.data?.status || null)
      toast.success(items.length ? 'Chapters saved' : 'Chapters removed')
    }
    setBusy(null)
  }

  return (
    <div className="rounded-xl nice-shadow p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-medium text-gray-700">
          <ListBullets size={18} weight="duotone" className="text-violet-400" />
          AI Chapters
        </h3>
        {status && status !== 'idle' && (
          <span className="text-[11px] font-medium text-gray-400 capitalize">{status}</span>
        )}
      </div>
      <p className="text-xs text-gray-400 -mt-2">
        {hasCaptions
          ? 'Split the video into chapters from its captions. Learners see them on the timeline and under the player.'
          : 'Generate captions first; chapters are built from them. You can still add chapters by hand.'}
      </p>

      {rows.length > 0 && (
        <div className="space-y-1.5">
          {rows.map((row, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                value={row.time}
                onChange={(e) => update(i, { time: e.target.value })}
                placeholder="0:00"
                aria-label="Start time"
                className="w-16 h-8 px-2 text-sm tabular-nums rounded-lg bg-gray-50 border border-gray-200 focus:outline-none focus:ring-2 focus:ring-black/10"
              />
              <input
                value={row.title}
                onChange={(e) => update(i, { title: e.target.value })}
                placeholder="Chapter title"
                aria-label="Chapter title"
                className="flex-1 h-8 px-2 text-sm rounded-lg bg-gray-50 border border-gray-200 focus:outline-none focus:ring-2 focus:ring-black/10"
              />
              <button
                type="button"
                onClick={() => setRows((r) => r.filter((_, j) => j !== i))}
                aria-label="Remove chapter"
                className="p-1.5 text-gray-400 hover:text-gray-700 rounded-md hover:bg-gray-100"
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setRows((r) => [...r, { time: '', title: '' }])}
          className="inline-flex items-center gap-1 h-8 px-3 text-xs font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
        >
          <Plus size={12} /> Add chapter
        </button>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={generate}
            disabled={!hasCaptions || busy !== null}
            className="inline-flex items-center gap-1.5 h-8 px-4 text-xs font-medium text-white bg-violet-600 rounded-lg hover:bg-violet-700 transition-colors disabled:opacity-50"
          >
            {busy === 'generate' ? (
              <BarLoader cssOverride={{ borderRadius: 60 }} width={40} color="#ffffff" />
            ) : (
              <>
                <Sparkle size={14} weight="duotone" /> {rows.length ? 'Regenerate' : 'Generate chapters'}
              </>
            )}
          </button>
          <button
            type="button"
            onClick={save}
            disabled={busy !== null}
            className="inline-flex items-center h-8 px-4 text-xs font-medium text-white bg-black rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50"
          >
            {busy === 'save' ? <BarLoader cssOverride={{ borderRadius: 60 }} width={40} color="#ffffff" /> : 'Save chapters'}
          </button>
        </div>
      </div>
    </div>
  )
}
