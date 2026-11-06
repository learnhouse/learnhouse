'use client'

import { useState } from 'react'

// Shows the video's thumbnail and loads YouTube's player only when someone
// presses play. An idle YouTube iframe pulls about 1 MB of script per video.
export default function YouTubePlayer({ id, title, thumbnail }) {
  const [playing, setPlaying] = useState(false)

  if (playing) {
    return (
      <iframe
        src={`https://www.youtube-nocookie.com/embed/${id}?rel=0&autoplay=1`}
        title={title}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        referrerPolicy="strict-origin-when-cross-origin"
        allowFullScreen
      />
    )
  }

  return (
    <button type="button" className="lh-video-facade" onClick={() => setPlaying(true)} aria-label={`Play video: ${title}`}>
      <img src={thumbnail} alt="" width={960} height={540} loading="lazy" decoding="async" />
      <span className="lh-video-play" aria-hidden>
        <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
          <path d="M8 5.5v13l10.5-6.5z" />
        </svg>
      </span>
    </button>
  )
}
