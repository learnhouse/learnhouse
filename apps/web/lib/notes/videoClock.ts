'use client'

/**
 * The lesson video's clock, for timestamped notes: read where the video is and
 * seek to a moment. The video activity registers its player (HTML5 or
 * YouTube); without one the first <video> on the page is used.
 */

export type VideoClock = {
  /** Seconds into the video; YouTube's player answers asynchronously. */
  getTime: () => number | null | Promise<number | null>
  seek: (_seconds: number) => void
}

let registered: VideoClock | null = null
const listeners = new Set<() => void>()

export function registerVideoClock(clock: VideoClock): () => void {
  registered = clock
  listeners.forEach((l) => l())
  return () => {
    if (registered === clock) {
      registered = null
      listeners.forEach((l) => l())
    }
  }
}

export function subscribeVideoClock(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

function domVideo(): HTMLVideoElement | null {
  if (typeof document === 'undefined') return null
  return document.querySelector<HTMLVideoElement>('.video-js video, video')
}

export function getVideoClock(): VideoClock | null {
  if (registered) return registered
  const video = domVideo()
  if (!video) return null
  return {
    getTime: () => (Number.isFinite(video.currentTime) ? video.currentTime : null),
    seek: (s) => {
      video.currentTime = s
    },
  }
}

/** Jump the lesson video to a moment and bring it into view. */
export function seekLessonVideo(seconds: number): boolean {
  const clock = getVideoClock()
  if (!clock) return false
  clock.seek(seconds)
  const target = domVideo() ?? document.querySelector<HTMLElement>('.lh-video-frame')
  target?.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
  return true
}
