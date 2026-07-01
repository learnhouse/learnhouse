'use client'

import React, { useEffect, useRef } from 'react'
import 'video.js/dist/video-js.css'
import './learnhouse-player.css'
import { shouldSendHlsCredentials } from './videoSource'

const SEEK_SECONDS = 10

/* Register ±10s seek-button components once (video.js Button API — no plugin). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function registerSeekButtons(videojs: any) {
  const Button = videojs.getComponent('Button')
  const make = (name: string, cls: string, label: string, delta: number) => {
    if (videojs.getComponent(name)) return
    class SeekButton extends Button {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      constructor(player: any, options: any) {
        super(player, options)
        this.controlText(label)
        this.addClass(cls)
      }
      handleClick() {
        const cur = this.player().currentTime() ?? 0
        const dur = this.player().duration() || Infinity
        this.player().currentTime(Math.max(0, Math.min(dur, cur + delta)))
      }
    }
    videojs.registerComponent(name, SeekButton)
  }
  make('LhSeekBack', 'vjs-seek-back-10', `Rewind ${SEEK_SECONDS} seconds`, -SEEK_SECONDS)
  make('LhSeekForward', 'vjs-seek-forward-10', `Forward ${SEEK_SECONDS} seconds`, SEEK_SECONDS)
}

interface VideoDetails {
  startTime?: number
  endTime?: number | null
  autoplay?: boolean
  muted?: boolean
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
  details?: VideoDetails
  onReady?: () => void
  poster?: string
  /** Hover-scrub preview sprite config (HLS only). */
  thumbnails?: ThumbnailsConfig | null
}

const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2]

/**
 * Video.js-based player: adaptive HLS with an automatic quality selector,
 * hover-scrub thumbnail previews, and the clean "city" theme. Falls back to a
 * progressive MP4 source when HLS isn't ready.
 *
 * Video.js and its plugins are imported dynamically inside an effect so nothing
 * touches `window`/`document` during SSR.
 */
const LearnHousePlayer: React.FC<LearnHousePlayerProps> = ({
  src,
  isHls = false,
  details,
  onReady,
  poster,
  thumbnails,
}) => {
  const containerRef = useRef<HTMLDivElement>(null)
   
  const playerRef = useRef<any>(null)

  useEffect(() => {
    let disposed = false

    ;(async () => {
      const { default: videojs } = await import('video.js')
      // Order matters: quality-levels must register before the selector.
      await import('videojs-contrib-quality-levels')
      await import('videojs-hls-quality-selector')
      await import('videojs-sprite-thumbnails')
      if (disposed || !containerRef.current) return

      registerSeekButtons(videojs)

      // Send the auth cookie only to our API playlist endpoint (RBAC); presigned
      // R2 segment requests must stay uncredentialed (R2 CORS).
       
      const Vhs = (videojs as any).Vhs
      if (Vhs && !Vhs.__lhBeforeRequestSet) {
         
        Vhs.xhr.beforeRequest = (options: any) => {
          if (options?.uri && shouldSendHlsCredentials(options.uri)) {
            options.withCredentials = true
          }
          return options
        }
        Vhs.__lhBeforeRequestSet = true
      }

      const videoEl = document.createElement('video-js')
      videoEl.classList.add('vjs-big-play-centered', 'vjs-theme-learnhouse')
      videoEl.setAttribute('playsinline', '')
      containerRef.current.appendChild(videoEl)

      const player = videojs(videoEl, {
        controls: true,
        fluid: true,
        responsive: true,
        preload: 'metadata',
        poster: poster || undefined,
        autoplay: !!details?.autoplay,
        muted: !!details?.muted,
        playbackRates: PLAYBACK_RATES,
        sources: [{ src, type: isHls ? 'application/x-mpegURL' : 'video/mp4' }],
        html5: {
          vhs: { overrideNative: true },
          nativeAudioTracks: false,
          nativeVideoTracks: false,
        },
      }, () => {
        onReady?.()
      })
      playerRef.current = player

      // Insert the ±10s seek buttons right after the play button.
      try {
        const bar = player.getChild('ControlBar')
        if (bar && !bar.getChild('LhSeekBack')) {
          bar.addChild('LhSeekBack', {}, 1)
          bar.addChild('LhSeekForward', {}, 2)
        }
      } catch {
        /* seek buttons are best-effort */
      }

      // Casual-download deterrents (cosmetic — not real protection; the segments
      // are AES-128 encrypted server-side for the actual bar-raising).
      try {
        const techEl = player.el().querySelector('video') as HTMLVideoElement | null
        if (techEl) {
          techEl.setAttribute('controlsList', 'nodownload')
          techEl.disablePictureInPicture = true
        }
        player.el().addEventListener('contextmenu', (e: Event) => e.preventDefault())
      } catch {
        /* best-effort */
      }

      // Quality gear (populated from HLS renditions; harmless for MP4).
      try {
         
        ;(player as any).hlsQualitySelector?.({ displayCurrentQuality: true })
      } catch {
        /* selector is best-effort */
      }

      // Hover-scrub preview thumbnails.
      if (thumbnails?.url) {
        try {
           
          ;(player as any).spriteThumbnails?.({
            url: thumbnails.url,
            width: thumbnails.width,
            height: thumbnails.height,
            columns: thumbnails.columns,
            rows: thumbnails.rows,
            interval: thumbnails.interval,
            responsive: 0,
          })
        } catch {
          /* thumbnails are best-effort */
        }
      }

      // Honor per-video start/stop bounds. video.js's currentTime() getter is
      // typed number | undefined, so coalesce before comparing.
      const startTime = details?.startTime
      if (startTime) {
        player.one('loadedmetadata', () => player.currentTime(startTime))
      }
      const endTime = details?.endTime
      if (endTime) {
        player.on('timeupdate', () => {
          if ((player.currentTime() ?? 0) >= endTime) player.pause()
        })
      }
    })()

    return () => {
      disposed = true
      if (playerRef.current) {
        playerRef.current.dispose()
        playerRef.current = null
      }
    }
    // Rebuild when the source changes (Video.tsx also keys the component by src).
  }, [src, isHls])

  return (
    <div className="learnhouse-player w-full" data-vjs-player>
      <div ref={containerRef} className="w-full" />
    </div>
  )
}

export default LearnHousePlayer
