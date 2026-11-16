'use client'

import React, { lazy, Suspense, useEffect, useRef, useState } from 'react'
import '@videojs/react/video/skin.css'
import './player.css'
import { I18nProvider } from '@videojs/react/i18n'
import { usePlayer, Video, VideoPlayer, VideoSkin } from '@videojs/react/video'
import { PauseIcon, PlayIcon } from '@videojs/react/icons'
import {
  buildChaptersVtt,
  buildThumbnailsVtt,
  shouldSendHlsCredentials,
  spriteFrameStyle,
  type CaptionTrack,
  type VideoChapter,
} from './videoSource'
import { useShowLearnHouseBranding } from '@components/Hooks/useLearnHouseBranding'

// hls.js is ~half a megabyte; MP4 and embed activities never need it, so the
// adapter (and hls.js with it) only loads once an HLS source renders.
const loadHlsJsVideo = () => import('@videojs/react/media/hlsjs-video')
const HlsJsVideo = lazy(() => loadHlsJsVideo().then((m) => ({ default: m.HlsJsVideo })))

/** Start fetching the HLS adapter early (e.g. while the activity loads). */
export function preloadHlsAdapter() {
  void loadHlsJsVideo()
}

interface VideoDetails {
  startTime?: number
  endTime?: number | null
  autoplay?: boolean
  muted?: boolean
}

/** A neighbouring activity offered on the paused screen. */
export interface PlayerNavItem {
  /** Small caption above the title, e.g. "Previous" or "Up next". */
  label: string
  title: string
  /** Background styles for the preview (e.g. one sprite frame). */
  previewStyle?: React.CSSProperties | null
  /** Plain preview image, used when there's no `previewStyle`. */
  imageUrl?: string | null
  onSelect: () => void
}

export interface ThumbnailsConfig {
  /** Absolute URL of the sprite sheet. */
  url: string
  interval: number
  width: number
  height: number
  columns: number
  rows: number
}

interface LearnHousePlayerProps {
  src: string
  /** When true, `src` is an HLS master playlist (.m3u8). */
  isHls?: boolean
  /** Progressive MP4 URL to fall back to if the HLS source errors. */
  fallbackSrc?: string
  details?: VideoDetails
  onReady?: () => void
  poster?: string
  /**
   * Instant placeholder shown until the first frame decodes: background
   * styles (e.g. one storyboard frame), drawn soft so a tiny frame reads well.
   * Falls back to a frame of `thumbnails`, then to `posterImageUrl`.
   */
  posterStyle?: React.CSSProperties | null
  /** Image drawn blurred behind the play badge when there is no frame (e.g. the course thumbnail). */
  posterImageUrl?: string | null
  /**
   * Initial preload. `none` downloads nothing while the player is off screen;
   * once it scrolls into view (or the viewer hovers, focuses or touches it)
   * it warms up to `metadata`: an MP4's first frame and index, or an HLS
   * stream's first segment at the lowest rendition. Play then starts at once
   * without ever fetching the whole video up front. Data Saver and 2G
   * connections wait for intent. Defaults to `metadata`.
   */
  preload?: 'none' | 'metadata' | 'auto'
  /** Shown at the top of the player while the controls are visible. */
  title?: string
  /** Hover-scrub preview sprite config (HLS only). */
  thumbnails?: ThumbnailsConfig | null
  /** Ready WebVTT caption tracks to attach (subtitles/CC menu). */
  captions?: CaptionTrack[]
  /** Paint a soft glow from the current frame under the player (theater pages). */
  ambient?: boolean
  /** Activities shown at either side of the player while paused. */
  prevItem?: PlayerNavItem | null
  nextItem?: PlayerNavItem | null
  /** Chapters drawn as segments on the time slider. */
  chapters?: VideoChapter[]
  /** Receives the current <video> element (it changes when falling back to MP4). */
  onVideoElement?: (el: HTMLVideoElement | null) => void
}

interface LoadedCaption {
  code: string
  label: string
  blobUrl: string
}

// An HLS master that loads but whose segments never arrive fires no error, so
// a watchdog moves to the MP4 fallback if metadata hasn't loaded by then.
const LOAD_WATCHDOG_MS = 15000

// Send the auth cookie only to our API playlist/key endpoints (RBAC); presigned
// R2 segment requests must stay uncredentialed (R2 CORS).
//
// Start low, climb fast: the first segment comes from the lowest rendition
// (startLevel 0), so the one segment warmed before play is small and the first
// frame is ready on press. ABR moves up from the second segment on, once real
// throughput is measured; player-size capping keeps the ceiling sensible.
const HLS_ENGINE = {
  hlsJs: {
    startLevel: 0,
    xhrSetup: (xhr: XMLHttpRequest, url: string) => {
      if (shouldSendHlsCredentials(url)) xhr.withCredentials = true
    },
  },
}

// Fill the aspect-video parent with 20px corners (the skin's default is 28px).
// `contain` letterboxes non-16:9 uploads instead of cropping them (the skin's
// default is `cover`). Dark chrome: the frosted control bar and menus sit on a
// near-black tint under the blur, so they read the same over bright footage,
// on the dark theater band and in focus mode.
const SKIN_STYLE = {
  width: '100%',
  height: '100%',
  '--media-border-radius': '20px',
  '--media-border-color': 'oklch(100% 0 0 / 0.08)',
  '--media-object-fit': 'contain',
  '--media-background': 'oklch(9% 0 0)',
  '--media-controls': 'oklch(12% 0 0 / 0.62)',
  '--media-popover': 'oklch(14% 0 0 / 0.82)',
  '--media-muted': 'oklch(100% 0 0 / 0.18)',
} as React.CSSProperties

/**
 * Placeholder over the player until the first frame is on screen: a soft
 * storyboard frame (or blurred image) with a play badge, so the player has a
 * face before any video byte arrives. Clicks fall through to the skin's
 * tap-to-play surface.
 */
function PosterLayer({ style, imageUrl, frameReady }: { style?: React.CSSProperties | null; imageUrl?: string | null; frameReady: boolean }) {
  const started = usePlayer((s) => s.started)
  const error = usePlayer((s) => s.error)
  const visible = !started && !frameReady && !error
  const backdrop = style
    ? style
    : imageUrl
      ? { backgroundImage: `url("${imageUrl}")`, backgroundSize: 'cover', backgroundPosition: 'center' }
      : null
  return (
    <div
      aria-hidden="true"
      className={`lh-player-poster @container pointer-events-none absolute inset-0 z-[14] overflow-hidden rounded-[inherit] bg-[#0d0d0e] transition-opacity duration-300 motion-reduce:transition-none ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
    >
      {backdrop && (
        <div
          className={`absolute -inset-6 bg-no-repeat ${style ? 'blur-[14px] opacity-90' : 'blur-[28px] opacity-45'}`}
          style={backdrop}
        />
      )}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_30%,rgb(0_0_0/0.55))]" />
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="grid size-16 place-items-center rounded-full bg-white/15 text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.18),0_8px_24px_rgb(0_0_0/0.35)] ring-1 ring-white/20 backdrop-blur-md @3xl:size-20">
          <PlayIcon className="size-7 translate-x-[1px] @3xl:size-8" />
        </div>
      </div>
    </div>
  )
}

function NavCard({ item, align, interactive }: { item: PlayerNavItem; align: 'start' | 'end'; interactive: boolean }) {
  const preview = item.previewStyle
    ? item.previewStyle
    : item.imageUrl
      ? { backgroundImage: `url("${item.imageUrl}")`, backgroundSize: 'cover', backgroundPosition: 'center' }
      : undefined
  return (
    <button
      type="button"
      onClick={item.onSelect}
      tabIndex={interactive ? 0 : -1}
      className={`group/nav hidden max-w-[16rem] items-center gap-3 text-white @3xl:flex ${interactive ? 'pointer-events-auto' : ''} ${
        align === 'end' ? 'flex-row-reverse text-end' : 'text-start'
      }`}
    >
      <span
        className="aspect-video w-24 shrink-0 rounded-md bg-white/10 bg-no-repeat shadow-lg shadow-black/40 ring-1 ring-white/15 transition group-hover/nav:ring-white/40"
        style={preview}
      />
      <span className="min-w-0 [text-shadow:0_1px_2px_rgb(0_0_0/0.5)]">
        <span className="block text-[11px] font-medium uppercase tracking-wider text-white/60">{item.label}</span>
        <span className="mt-0.5 line-clamp-2 text-sm font-medium leading-snug text-white/85 transition-colors group-hover/nav:text-white">
          {item.title}
        </span>
      </span>
    </button>
  )
}

/**
 * Paused screen: the previous and next activities in soft shadows at either
 * side; the skin's own play control stays the only play button. The links are
 * interactive targets, so the skin's tap-to-toggle gesture leaves them alone.
 */
function PausedOverlay({ prev, next }: { prev?: PlayerNavItem | null; next?: PlayerNavItem | null }) {
  const paused = usePlayer((s) => s.paused)
  const error = usePlayer((s) => s.error)
  const visible = paused && !error
  return (
    <div
      className={`@container pointer-events-none absolute inset-0 z-[15] transition-opacity duration-300 ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
      aria-hidden={!visible}
    >
      <div className="absolute inset-0 bg-black/15" />
      <div className="absolute inset-y-0 start-0 w-1/2 bg-gradient-to-r from-black/55 via-black/15 to-transparent rtl:bg-gradient-to-l" />
      <div className="absolute inset-y-0 end-0 w-1/2 bg-gradient-to-l from-black/55 via-black/15 to-transparent rtl:bg-gradient-to-r" />
      <div className="relative flex h-full items-center justify-between gap-6 px-8">
        <div>{prev && <NavCard item={prev} align="start" interactive={visible} />}</div>
        <div>{next && <NavCard item={next} align="end" interactive={visible} />}</div>
      </div>
    </div>
  )
}

// How long the play badge lingers after playback resumes.
const RESUME_BADGE_MS = 1000

/**
 * Centre play/pause badge in the skin's style: shows the pause glyph for as
 * long as playback is paused, then the play glyph for a moment after it
 * resumes. Nothing before the first play, so the poster stays clean.
 */
function CenterIndicator() {
  const paused = usePlayer((s) => s.paused)
  const error = usePlayer((s) => s.error)
  const [hasPlayed, setHasPlayed] = useState(false)
  const [resumed, setResumed] = useState(false)

  useEffect(() => {
    if (paused) {
      setResumed(false)
      return
    }
    if (!hasPlayed) {
      setHasPlayed(true)
      return
    }
    setResumed(true)
    const timer = setTimeout(() => setResumed(false), RESUME_BADGE_MS)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused])

  const visible = !error && hasPlayed && (paused || resumed)
  return (
    <div className="@container pointer-events-none absolute inset-0 z-[16] flex items-center justify-center">
      <div
        className={`grid size-16 place-items-center rounded-full bg-black/35 text-white backdrop-blur-sm transition duration-300 @3xl:size-20 ${
          visible ? 'scale-100 opacity-100' : 'scale-90 opacity-0'
        }`}
      >
        {paused ? <PauseIcon className="size-7 @3xl:size-8" /> : <PlayIcon className="size-7 @3xl:size-8" />}
      </div>
    </div>
  )
}

/** Icon-only LearnHouse mark, top-right; fades in and out with the controls. */
function PlayerLogo() {
  const showBranding = useShowLearnHouseBranding()
  const visible = usePlayer((s) => s.controlsVisible)
  if (!showBranding) return null
  return (
    <img
      src="/lrn.svg"
      alt=""
      aria-hidden="true"
      draggable={false}
      className={`pointer-events-none absolute top-5 end-6 z-[25] h-3.5 w-auto select-none brightness-0 invert drop-shadow-[0_1px_2px_rgba(0,0,0,0.35)] transition-opacity duration-300 sm:top-6 sm:end-8 sm:h-4 ${
        visible ? 'opacity-80' : 'opacity-0'
      }`}
    />
  )
}

/**
 * Video.js 10 player with the stock video skin: adaptive HLS through hls.js
 * (quality menu, storyboard thumbnails, captions, speed, PiP, AirPlay, keyboard
 * shortcuts and touch gestures all come from the skin), falling back to a
 * progressive MP4 source when HLS errors or stalls.
 */
const LearnHousePlayer: React.FC<LearnHousePlayerProps> = ({
  src,
  isHls = false,
  fallbackSrc,
  details,
  onReady,
  poster,
  posterStyle,
  posterImageUrl,
  preload = 'metadata',
  title,
  thumbnails,
  captions,
  ambient = false,
  prevItem,
  nextItem,
  chapters,
  onVideoElement,
}) => {
  const mediaRef = useRef<HTMLVideoElement | null>(null)
  // The element as state too: the HLS adapter mounts lazily, after the first
  // commit, so effects that attach tracks or listeners key off the element.
  const [mediaEl, setMediaEl] = useState<HTMLVideoElement | null>(null)
  const setMediaRef = React.useCallback((el: HTMLVideoElement | null) => {
    mediaRef.current = el
    setMediaEl(el)
  }, [])
  const [fellBack, setFellBack] = useState(false)
  const resumeAtRef = useRef(0)
  const startAppliedRef = useRef(false)
  const metaLoadedRef = useRef(false)
  const [loadedCaptions, setLoadedCaptions] = useState<LoadedCaption[]>([])
  // `preload="none"` waits for intent: hovering, focusing or touching the
  // player warms it up to `metadata` (first frame + a little buffer), so the
  // press that follows plays almost at once without fetching on page load.
  const [warm, setWarm] = useState(false)
  const [frameReady, setFrameReady] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  // Warm up as soon as the player is on screen, unless the connection asks
  // us to spare data (then only intent warms it).
  useEffect(() => {
    if (preload !== 'none' || warm) return
    const el = rootRef.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const conn = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection
    if (conn?.saveData || /(^|-)2g$/.test(conn?.effectiveType || '')) return
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return
        io.disconnect()
        setWarm(true)
      },
      { threshold: 0.25 }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [preload, warm])
  const effectivePreload = preload === 'none' && (warm || details?.autoplay) ? 'metadata' : preload
  const warmUp = preload === 'none' && !warm ? () => setWarm(true) : undefined

  const playingHls = isHls && !fellBack
  const canFallBack = isHls && !!fallbackSrc && !fellBack

  useEffect(() => {
    setFellBack(false)
    setFrameReady(false)
    resumeAtRef.current = 0
    startAppliedRef.current = false
    metaLoadedRef.current = false
  }, [src, isHls, fallbackSrc])

  const fallBack = () => {
    if (!canFallBack) return
    resumeAtRef.current = mediaRef.current?.currentTime ?? 0
    metaLoadedRef.current = false
    setFellBack(true)
  }

  // Armed only once media loading has begun: with `preload="none"` nothing
  // loads until intent, and an idle player must not fall back to the MP4.
  const loadingStarted = effectivePreload !== 'none'
  useEffect(() => {
    if (!canFallBack || !loadingStarted) return
    const timer = setTimeout(() => {
      if (!metaLoadedRef.current) fallBack()
    }, LOAD_WATCHDOG_MS)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canFallBack, src, loadingStarted])

  // Fetch each ready VTT with credentials (RBAC) into a blob URL, since a
  // cross-origin <track src> can't carry the cookie on private courses.
  const captionsKey = (captions || []).map((c) => c.url).join('|')
  useEffect(() => {
    if (!captions || !captions.length) {
      setLoadedCaptions([])
      return
    }
    let cancelled = false
    const created: string[] = []
    Promise.all(
      captions.map(async (track) => {
        try {
          const res = await fetch(track.url, { credentials: 'include' })
          if (!res.ok) return null
          const vtt = await res.text()
          const blobUrl = URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' }))
          created.push(blobUrl)
          return { code: track.code, label: track.label, blobUrl }
        } catch {
          return null
        }
      })
    ).then((loaded) => {
      if (!cancelled) setLoadedCaptions(loaded.filter((c): c is LoadedCaption => !!c))
    })
    return () => {
      cancelled = true
      created.forEach((u) => URL.revokeObjectURL(u))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [captionsKey])

  // The skin reads hover previews from a `thumbnails` metadata track, so turn
  // the sprite grid into a storyboard VTT.
  const [thumbnailsVttUrl, setThumbnailsVttUrl] = useState<string | null>(null)
  useEffect(() => {
    const vtt = playingHls && thumbnails?.url ? buildThumbnailsVtt(thumbnails, window.location.href) : null
    if (!vtt) {
      setThumbnailsVttUrl(null)
      return
    }
    const url = URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' }))
    setThumbnailsVttUrl(url)
    return () => URL.revokeObjectURL(url)
    // Keyed by value: callers build `thumbnails` inline on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playingHls, JSON.stringify(thumbnails ?? null)])

  // Ambient glow: copy the current frame into a tiny canvas a few times a
  // second; CSS scales and blurs it into a soft halo around the player. A
  // cross-origin MP4 taints the canvas, which only blocks reading pixels back,
  // not drawing them.
  const ambientRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const video = mediaEl
    const ctx = ambientRef.current?.getContext('2d')
    if (!ambient || !video || !ctx) return
    let timer: ReturnType<typeof setInterval> | undefined
    const draw = () => {
      if (video.readyState < 2) return
      try {
        ctx.drawImage(video, 0, 0, ctx.canvas.width, ctx.canvas.height)
      } catch {
        /* frame not decodable yet */
      }
    }
    const stop = () => {
      if (timer) clearInterval(timer)
      timer = undefined
    }
    const start = () => {
      stop()
      timer = setInterval(draw, 250)
    }
    video.addEventListener('play', start)
    video.addEventListener('pause', stop)
    video.addEventListener('ended', stop)
    video.addEventListener('seeked', draw)
    video.addEventListener('loadeddata', draw)
    draw()
    if (!video.paused) start()
    return () => {
      stop()
      video.removeEventListener('play', start)
      video.removeEventListener('pause', stop)
      video.removeEventListener('ended', stop)
      video.removeEventListener('seeked', draw)
      video.removeEventListener('loadeddata', draw)
    }
  }, [ambient, mediaEl])

  // Casual-download deterrent (cosmetic; segments are AES-128 encrypted
  // server-side). Picture-in-picture stays enabled.
  useEffect(() => {
    mediaEl?.setAttribute('controlsList', 'nodownload')
  }, [mediaEl])

  const handleLoadedMetadata = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    metaLoadedRef.current = true
    const el = e.currentTarget
    if (resumeAtRef.current > 0) {
      el.currentTime = resumeAtRef.current
      resumeAtRef.current = 0
    } else if (details?.startTime && !startAppliedRef.current) {
      el.currentTime = details.startTime
    }
    startAppliedRef.current = true
    onReady?.()
  }

  const endTime = details?.endTime
  const handleTimeUpdate = endTime
    ? (e: React.SyntheticEvent<HTMLVideoElement>) => {
        if (e.currentTarget.currentTime >= endTime) e.currentTarget.pause()
      }
    : undefined

  const mediaProps = {
    ref: setMediaRef,
    playsInline: true,
    preload: effectivePreload,
    autoPlay: !!details?.autoplay,
    muted: !!details?.muted,
    onLoadedMetadata: handleLoadedMetadata,
    onLoadedData: () => setFrameReady(true),
    onTimeUpdate: handleTimeUpdate,
    onError: canFallBack ? fallBack : undefined,
  }

  // Poster: the caller's frame, else a storyboard frame, else a blurred image.
  const posterFrame = posterStyle ?? (thumbnails?.url ? spriteFrameStyle(thumbnails, 0.1) : null)
  const showPosterLayer = preload === 'none' && !poster

  // Tracks go onto the <video> imperatively rather than as React children:
  // the player manages the media element's track list itself, and React
  // inserting a late caption <track> next to one the player has touched
  // throws `insertBefore` and takes the whole activity page down.
  useEffect(() => {
    const video = mediaEl
    if (!video || !loadedCaptions.length) return
    const els = loadedCaptions.map((c) => {
      const el = document.createElement('track')
      el.kind = 'subtitles'
      el.src = c.blobUrl
      el.srclang = c.code
      el.label = c.label
      video.appendChild(el)
      return el
    })
    return () => els.forEach((el) => el.remove())
  }, [loadedCaptions, mediaEl])

  // Chapters: the skin splits the time slider at each cue of a default
  // chapters track and shows the chapter title while scrubbing.
  const chaptersKey = (chapters || []).map((c) => `${c.start}:${c.title}`).join('|')
  useEffect(() => {
    const video = mediaEl
    const vtt = chapters ? buildChaptersVtt(chapters) : null
    if (!video || !vtt) return
    const url = URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' }))
    const el = document.createElement('track')
    el.kind = 'chapters'
    el.src = url
    el.default = true
    video.appendChild(el)
    return () => {
      el.remove()
      URL.revokeObjectURL(url)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chaptersKey, mediaEl])

  useEffect(() => {
    onVideoElement?.(mediaEl)
    return () => onVideoElement?.(null)
  }, [onVideoElement, mediaEl])

  useEffect(() => {
    const video = mediaEl
    if (!video || !thumbnailsVttUrl) return
    const el = document.createElement('track')
    el.kind = 'metadata'
    el.label = 'thumbnails'
    el.src = thumbnailsVttUrl
    el.default = true
    video.appendChild(el)
    return () => el.remove()
  }, [thumbnailsVttUrl, mediaEl])

  return (
    // dir="ltr": transport controls read left-to-right everywhere; labels still
    // follow the page language through the i18n provider.
    // data-shortcuts-ignore: the skin owns its keys (j/k/l seek, arrows, f,
    // space); page shortcuts must not also fire while the player has focus.
    <div
      ref={rootRef}
      dir="ltr"
      data-shortcuts-ignore=""
      className="learnhouse-player relative isolate w-full h-full"
      onContextMenu={(e) => e.preventDefault()}
      onPointerEnter={warmUp}
      onTouchStart={warmUp}
      onFocusCapture={warmUp}
    >
      {ambient && (
        <canvas
          ref={ambientRef}
          width={32}
          height={18}
          aria-hidden="true"
          className="pointer-events-none absolute start-[15%] top-[45%] -z-10 h-[65%] w-[70%] opacity-[0.12] blur-[120px]"
        />
      )}
      <I18nProvider>
        <VideoPlayer poster={poster || ''} title={title || ''}>
          <VideoSkin style={SKIN_STYLE}>
            {playingHls ? (
              <Suspense fallback={null}>
                <HlsJsVideo
                  {...mediaProps}
                  source={{
                    src,
                    type: 'application/vnd.apple.mpegurl',
                    preferPlayback: 'mse',
                    engine: HLS_ENGINE,
                  }}
                />
              </Suspense>
            ) : (
              <Video {...mediaProps} src={fellBack ? fallbackSrc : src} />
            )}
            {showPosterLayer && (
              <PosterLayer style={posterFrame} imageUrl={posterImageUrl} frameReady={frameReady} />
            )}
            {(prevItem || nextItem) && (
              <PausedOverlay prev={prevItem} next={nextItem} />
            )}
            <CenterIndicator />
            <PlayerLogo />
          </VideoSkin>
        </VideoPlayer>
      </I18nProvider>
    </div>
  )
}

export default LearnHousePlayer
