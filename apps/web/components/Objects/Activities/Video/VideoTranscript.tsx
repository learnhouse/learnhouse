'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CaretDown, TextAlignLeft } from '@phosphor-icons/react'
import { cueIndexAt, formatClock, parseVttCues, type CaptionTrack, type TranscriptCue } from './videoSource'

interface VideoTranscriptProps {
  captions: CaptionTrack[]
  video: HTMLVideoElement | null
}

/**
 * The video's captions as a readable transcript under the player, folded away
 * until opened. The line being spoken is highlighted; clicking a line seeks.
 */
export default function VideoTranscript({ captions, video }: VideoTranscriptProps) {
  const { t, i18n } = useTranslation()
  const [open, setOpen] = useState(false)
  // Prefer the page language, else the first ready track.
  const initial = useMemo(() => {
    const lang = (i18n.language || '').split('-')[0]
    return captions.find((c) => c.code.split('-')[0] === lang)?.code || captions[0]?.code || ''
  }, [captions, i18n.language])
  const [code, setCode] = useState(initial)
  const track = captions.find((c) => c.code === code) || captions[0]
  // The last fetch, by URL: a language switch shows the skeleton until its own
  // track arrives.
  const [loaded, setLoaded] = useState<{ url: string; cues: TranscriptCue[] | null } | null>(null)
  const current = loaded && loaded.url === track?.url ? loaded : null
  const cues = current?.cues ?? null
  const failed = !!current && current.cues === null
  const [time, setTime] = useState(0)
  const listRef = useRef<HTMLOListElement>(null)

  // Fetched only once the panel is opened (and again per language).
  useEffect(() => {
    const url = track?.url
    if (!open || !url) return
    let alive = true
    fetch(url, { credentials: 'include' })
      .then((res) => (res.ok ? res.text() : Promise.reject(res.status)))
      .then((vtt) => alive && setLoaded({ url, cues: parseVttCues(vtt) }))
      .catch(() => alive && setLoaded({ url, cues: null }))
    return () => {
      alive = false
    }
  }, [open, track?.url])

  useEffect(() => {
    if (!video || !open) return
    const sync = () => setTime(video.currentTime || 0)
    sync()
    video.addEventListener('timeupdate', sync)
    video.addEventListener('seeked', sync)
    return () => {
      video.removeEventListener('timeupdate', sync)
      video.removeEventListener('seeked', sync)
    }
  }, [video, open])

  const active = cues ? cueIndexAt(cues, time) : -1

  // Keep the spoken line in view inside the list, never scrolling the page.
  useEffect(() => {
    const list = listRef.current
    const item = list?.children[active] as HTMLElement | undefined
    if (!list || !item) return
    const top = item.offsetTop - list.offsetTop
    if (top < list.scrollTop || top + item.offsetHeight > list.scrollTop + list.clientHeight) {
      const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      list.scrollTo({ top: Math.max(0, top - list.clientHeight / 3), behavior: reduce ? 'auto' : 'smooth' })
    }
  }, [active])

  if (!captions.length) return null

  const seek = (start: number) => {
    if (!video) return
    video.currentTime = start
  }

  return (
    <section className="mt-6 rounded-2xl bg-white/[0.04] ring-1 ring-white/10">
      <div className="flex items-center gap-2 px-4 py-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex flex-1 items-center gap-2 text-start text-[13px] font-medium text-white/80 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 rounded-md"
        >
          <TextAlignLeft size={15} className="text-white/50" />
          {t('activities.video_transcript', 'Transcript')}
          <CaretDown size={12} className={`ms-auto text-white/40 transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`} />
        </button>
        {open && captions.length > 1 && (
          <select
            value={track?.code}
            onChange={(e) => setCode(e.target.value)}
            aria-label={t('activities.video_transcript_language', 'Transcript language')}
            className="rounded-md bg-white/10 px-2 py-1 text-xs text-white ring-1 ring-white/10 focus-visible:outline-none focus-visible:ring-white/50"
          >
            {captions.map((c) => (
              <option key={c.code} value={c.code} className="text-neutral-900">
                {c.label}
              </option>
            ))}
          </select>
        )}
      </div>
      {open && (
        <div className="border-t border-white/10 px-2 pb-2">
          {failed ? (
            <p className="px-2 py-4 text-sm text-white/50">{t('activities.video_transcript_failed', 'The transcript couldn’t be loaded.')}</p>
          ) : !cues ? (
            <div className="space-y-2 px-2 py-4" aria-hidden="true">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-3 rounded bg-white/10 animate-pulse motion-reduce:animate-none" style={{ width: `${80 - i * 15}%` }} />
              ))}
            </div>
          ) : (
            <ol ref={listRef} className="max-h-72 overflow-y-auto py-1 [scrollbar-width:thin]">
              {cues.map((cue, i) => (
                <li key={`${cue.start}-${i}`}>
                  <button
                    type="button"
                    onClick={() => seek(cue.start)}
                    aria-current={i === active ? 'true' : undefined}
                    className={`flex w-full gap-3 rounded-lg px-2 py-1.5 text-start text-[13px] leading-relaxed transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 ${
                      i === active ? 'bg-white/10 text-white' : 'text-white/60 hover:bg-white/5 hover:text-white/85'
                    }`}
                  >
                    <span className="w-10 shrink-0 pt-px text-[11px] tabular-nums text-white/35" dir="ltr">
                      {formatClock(cue.start)}
                    </span>
                    <span className="min-w-0">{cue.text}</span>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </section>
  )
}
