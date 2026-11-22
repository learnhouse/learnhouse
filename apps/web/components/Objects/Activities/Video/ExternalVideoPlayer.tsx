'use client'

/*
 Plays a video hosted elsewhere: Vimeo and Loom here, other services through
 the registered providers (see providers/registry). Lazy-loaded by its callers
 so none of it lands in the lesson's core chunk.

 Every player reports progress the same way (`onProgress(time, duration)`),
 so analytics and resume work for each service whose player tells us its
 position. Loom's embed has no public player API, so it only plays.
*/
import React, { Suspense, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowSquareOut, VideoCamera } from '@phosphor-icons/react'
import { detectVideoLink, findVideoProvider, withTrim, type ExternalPlayerProps } from './providers/registry'

const IFRAME_ALLOW = 'autoplay; fullscreen; picture-in-picture; encrypted-media; clipboard-write'

const VIMEO_ORIGIN = 'https://player.vimeo.com'

function parseMessage(data: unknown): any {
  if (typeof data !== 'string') return data
  try {
    return JSON.parse(data)
  } catch {
    return null
  }
}

/** Vimeo through its postMessage player API (no player.js download). */
export function VimeoPlayer({
  url,
  title,
  startTime,
  endTime,
  autoplay,
  muted,
  resumeAt,
  playbackRate,
  onProgress,
  onEnded,
  onRateChange,
  onReady,
}: ExternalPlayerProps) {
  const frame = useRef<HTMLIFrameElement>(null)
  const callbacks = useRef({ onProgress, onEnded, onRateChange, onReady })
  useEffect(() => {
    callbacks.current = { onProgress, onEnded, onRateChange, onReady }
  })

  const src = useMemo(() => {
    const match = detectVideoLink(url)
    const base = match?.provider === 'vimeo' ? match.embedUrl : url
    let u: URL
    try {
      u = new URL(base)
    } catch {
      return null
    }
    u.searchParams.set('dnt', '1')
    u.searchParams.set('playsinline', '1')
    if (autoplay) u.searchParams.set('autoplay', '1')
    if (muted) u.searchParams.set('muted', '1')
    return withTrim(u.toString(), 'vimeo', resumeAt || startTime, null)
    // The iframe loads once per video; later prop changes go through messages.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url])

  useEffect(() => {
    const win = () => frame.current?.contentWindow
    const post = (method: string, value?: unknown) =>
      win()?.postMessage(JSON.stringify(value === undefined ? { method } : { method, value }), VIMEO_ORIGIN)
    const pending = new Map<string, (_v: any) => void>()
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== VIMEO_ORIGIN || e.source !== win()) return
      const msg = parseMessage(e.data)
      if (!msg) return
      if (msg.method && pending.has(msg.method)) {
        pending.get(msg.method)?.(msg.value)
        pending.delete(msg.method)
        return
      }
      if (msg.event === 'ready') {
        for (const ev of ['timeupdate', 'ended', 'playbackratechange']) post('addEventListener', ev)
        if (playbackRate && playbackRate !== 1) post('setPlaybackRate', playbackRate)
        callbacks.current.onReady?.({
          getTime: () =>
            new Promise((resolve) => {
              pending.set('getCurrentTime', (v) => resolve(Number.isFinite(Number(v)) ? Number(v) : null))
              post('getCurrentTime')
              setTimeout(() => resolve(null), 1500)
            }),
          seek: (s) => post('setCurrentTime', Math.max(0, s)),
        })
      } else if (msg.event === 'timeupdate') {
        const seconds = Number(msg.data?.seconds)
        const duration = Number(msg.data?.duration)
        if (endTime && seconds >= endTime) post('pause')
        callbacks.current.onProgress?.(seconds, duration)
      } else if (msg.event === 'ended') {
        callbacks.current.onEnded?.()
      } else if (msg.event === 'playbackratechange') {
        const rate = Number(msg.data?.playbackRate)
        if (Number.isFinite(rate)) callbacks.current.onRateChange?.(rate)
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [endTime, playbackRate, src])

  if (!src) return <UnsupportedVideo url={url} />
  return (
    <iframe
      ref={frame}
      src={src}
      title={title || 'Vimeo'}
      allow={IFRAME_ALLOW}
      allowFullScreen
      className="absolute inset-0 h-full w-full border-0"
    />
  )
}

/** Loom: its embed takes a start time but exposes no player events. */
export function LoomPlayer({ url, title, startTime, resumeAt, autoplay }: ExternalPlayerProps) {
  const match = detectVideoLink(url)
  const base = match?.provider === 'loom' ? match.embedUrl : url
  let src = withTrim(base, 'loom', resumeAt || startTime, null)
  if (autoplay) {
    try {
      const u = new URL(src)
      u.searchParams.set('autoplay', '1')
      src = u.toString()
    } catch {
      /* keep src */
    }
  }
  return (
    <iframe
      src={src}
      title={title || 'Loom'}
      allow={IFRAME_ALLOW}
      allowFullScreen
      className="absolute inset-0 h-full w-full border-0"
    />
  )
}

/** A video from a service this build can't play: say so, link to it. */
export function UnsupportedVideo({ url }: { url: string }) {
  const { t } = useTranslation()
  const safe = /^https?:\/\//i.test(url || '') ? url : null
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-neutral-900 p-6 text-center text-white">
      <span className="grid size-11 place-items-center rounded-2xl bg-white/10">
        <VideoCamera size={22} weight="duotone" />
      </span>
      <p className="max-w-sm text-sm text-white/80">{t('activities.video_unsupported', 'This video can’t be played here.')}</p>
      {safe && (
        <a
          href={safe}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-xs font-semibold hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
        >
          <ArrowSquareOut size={13} weight="bold" />
          {t('activities.video_open_original', 'Open the video')}
        </a>
      )}
    </div>
  )
}

/**
 * The player for a stored external video. `provider` is the stored service id
 * (`content.type` of an activity, `embedProvider` of a block).
 */
export default function ExternalVideoPlayer({ provider, ...props }: ExternalPlayerProps & { provider: string }) {
  if (provider === 'vimeo') return <VimeoPlayer {...props} />
  if (provider === 'loom') return <LoomPlayer {...props} />
  const registered = findVideoProvider(provider)
  if (!registered) return <UnsupportedVideo url={props.url} />
  const Player = registered.Player
  return (
    <Suspense fallback={<div className="absolute inset-0 animate-pulse bg-neutral-900 motion-reduce:animate-none" />}>
      <Player {...props} />
    </Suspense>
  )
}
