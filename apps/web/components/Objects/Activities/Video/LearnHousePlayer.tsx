'use client'

import React, { useEffect, useRef } from 'react'
import 'video.js/dist/video-js.css'
import '@videojs/themes/dist/city/index.css'
import { shouldSendHlsCredentials } from './videoSource'

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

      // Send the auth cookie only to our API playlist endpoint (RBAC); presigned
      // R2 segment requests must stay uncredentialed (R2 CORS).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const Vhs = (videojs as any).Vhs
      if (Vhs && !Vhs.__lhBeforeRequestSet) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        Vhs.xhr.beforeRequest = (options: any) => {
          if (options?.uri && shouldSendHlsCredentials(options.uri)) {
            options.withCredentials = true
          }
          return options
        }
        Vhs.__lhBeforeRequestSet = true
      }

      const videoEl = document.createElement('video-js')
      videoEl.classList.add('vjs-big-play-centered', 'vjs-theme-city')
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

      // Quality gear (populated from HLS renditions; harmless for MP4).
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(player as any).hlsQualitySelector?.({ displayCurrentQuality: true })
      } catch {
        /* selector is best-effort */
      }

      // Hover-scrub preview thumbnails.
      if (thumbnails?.url) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

      // Honor per-video start/stop bounds.
      if (details?.startTime) {
        player.one('loadedmetadata', () => player.currentTime(details.startTime))
      }
      if (details?.endTime) {
        player.on('timeupdate', () => {
          if (player.currentTime() >= (details.endTime as number)) player.pause()
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
