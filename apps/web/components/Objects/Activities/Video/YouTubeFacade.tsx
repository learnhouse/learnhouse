'use client'

import React, { lazy, Suspense, useState } from 'react'
import { preconnect } from 'react-dom'
import { Play } from '@phosphor-icons/react'
import { youTubeThumbnailUrl } from './videoSource'

// The YouTube player (iframe + its ~1 MB of scripts) only loads on demand.
const loadYouTube = () => import('react-youtube')
const YouTube = lazy(loadYouTube)

type YouTubeEvent = { data: number; target: any }

interface YouTubeFacadeProps {
  videoId: string
  /** Accessible name of the play button, e.g. "Play video: Intro". */
  playLabel: string
  title?: string
  playerVars: Record<string, string | number | undefined>
  /** Mount the real player straight away (activity set to autoplay). */
  eager?: boolean
  onReady?: (_event: { target: any }) => void
  onStateChange?: (_event: YouTubeEvent) => void
}

/**
 * Click-to-load YouTube: the video's own thumbnail and a play button until the
 * learner presses play, then the real embed, already playing. Saves the
 * multi-megabyte iframe on every page view that never plays the video.
 */
export default function YouTubeFacade({ videoId, playLabel, title, playerVars, eager = false, onReady, onStateChange }: YouTubeFacadeProps) {
  const [active, setActive] = useState(eager)
  const [thumb, setThumb] = useState<'maxres' | 'hq'>('maxres')

  preconnect('https://i.ytimg.com')

  // Hovering warms the connections and the player chunk, so the press is quick.
  const warm = () => {
    preconnect('https://www.youtube.com')
    preconnect('https://www.google.com')
    void loadYouTube()
  }

  if (!videoId) return <div className="absolute inset-0 bg-[#0d0d0e]" />

  if (active) {
    return (
      <Suspense fallback={<div className="absolute inset-0 animate-pulse bg-[#0d0d0e]" />}>
        <YouTube
          className="absolute inset-0 h-full w-full"
          iframeClassName="h-full w-full"
          title={title}
          opts={{ width: '100%', height: '100%', playerVars: { ...playerVars, autoplay: 1 } }}
          videoId={videoId}
          onReady={(event: { target: any }) => {
            onReady?.(event)
            // A press already happened; start even where autoplay is blocked.
            if (!eager) event.target.playVideo?.()
          }}
          onStateChange={onStateChange}
        />
      </Suspense>
    )
  }

  return (
    <button
      type="button"
      onClick={() => setActive(true)}
      onPointerEnter={warm}
      onFocus={warm}
      onTouchStart={warm}
      aria-label={playLabel}
      className="group absolute inset-0 block h-full w-full overflow-hidden bg-[#0d0d0e] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/70"
    >
      <img
        src={youTubeThumbnailUrl(videoId, thumb)}
        alt=""
        decoding="async"
        fetchPriority="high"
        onLoad={(e) => {
          // A missing maxres thumbnail comes back as a 120px grey placeholder.
          if (thumb === 'maxres' && e.currentTarget.naturalWidth <= 120) setThumb('hq')
        }}
        onError={() => thumb === 'maxres' && setThumb('hq')}
        className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.015] motion-reduce:transition-none"
      />
      <span className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/10 to-black/30" />
      {title && (
        <span className="absolute inset-x-5 top-4 line-clamp-2 text-start text-base font-semibold text-white [text-shadow:0_1px_2px_rgb(0_0_0/0.5)] sm:inset-x-7 sm:top-6 sm:text-xl">
          {title}
        </span>
      )}
      <span className="absolute inset-0 flex items-center justify-center">
        <span className="grid size-16 place-items-center rounded-full bg-white/15 text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.18),0_8px_24px_rgb(0_0_0/0.35)] ring-1 ring-white/25 backdrop-blur-md transition-transform duration-200 group-hover:scale-105 group-active:scale-95 sm:size-20">
          <Play size={28} weight="fill" className="translate-x-[1px]" />
        </span>
      </span>
    </button>
  )
}
