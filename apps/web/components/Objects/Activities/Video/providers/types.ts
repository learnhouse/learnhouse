import type React from 'react'

/**
 * Video providers: the extension point external video services plug into.
 *
 * YouTube, Vimeo and Loom are built in. Other providers register through
 * `@ee/components/Video/videoProviders` (an empty list in the open-source
 * build), so a link from a service nobody registered keeps today's behaviour:
 * a plain embed, or a "can't play here" hint.
 */

/** A link recognised as a video from a known service. */
export interface VideoLinkMatch {
  /** Stored provider id (`content.type` / `embedProvider`), e.g. `vimeo`. */
  provider: string
  /** Human name, for badges. */
  label: string
  /** The provider's id for the video. */
  videoId: string
  /** What the provider's iframe player loads. */
  embedUrl: string
  /** The link as pasted (normalized). */
  sourceUrl: string
}

/** Lets the page read and move a player (timestamped notes, "start over"). */
export interface VideoPlayerControls {
  getTime: () => Promise<number | null>
  seek: (_seconds: number) => void
}

export interface ExternalPlayerProps {
  /** The stored link: a share link or the provider's embed URL. */
  url: string
  title?: string
  /** Trim, in seconds. */
  startTime?: number
  endTime?: number | null
  autoplay?: boolean
  muted?: boolean
  /** Position to continue from (resume); wins over `startTime`. */
  resumeAt?: number | null
  /** Playback speed to start at. */
  playbackRate?: number | null
  /** The activity the video lives in, for providers that check access. */
  activityUuid?: string
  onProgress?: (_currentTime: number, _duration: number) => void
  onEnded?: () => void
  onRateChange?: (_rate: number) => void
  onReady?: (_controls: VideoPlayerControls) => void
}

export interface VideoProvider {
  id: string
  label: string
  /** The video in `url`, or null when the link isn't this provider's. */
  match: (_url: string) => VideoLinkMatch | null
  /** The provider's player. Keep it lazy: it must not land in the core chunk. */
  Player: React.ComponentType<ExternalPlayerProps>
}
