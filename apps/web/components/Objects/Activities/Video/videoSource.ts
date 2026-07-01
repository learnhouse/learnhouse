import {
  getActivityVideoStreamUrl,
  getActivityHlsMasterUrl,
  getActivityHlsThumbnailsUrl,
} from '@services/media/media'

/**
 * Pure helpers for choosing a video activity's playback source.
 *
 * Extracted from the components so the decision logic (HLS-when-ready with an
 * MP4 fallback, the credentials rule, and thumbnail config) can be unit-tested.
 */

export interface HlsThumbnails {
  url: string
  interval: number
  width: number
  height: number
  columns: number
  rows: number
}

export interface HlsActivityMeta {
  extra_metadata?: {
    hls?: {
      status?: string
      thumbnails?: {
        url?: string
        interval?: number
        width?: number
        height?: number
        columns?: number
        rows?: number
      } | null
    }
  } | null
}

/** True once transcoding has produced a ready HLS ladder for the activity. */
export function isActivityHlsReady(activity: HlsActivityMeta): boolean {
  return activity?.extra_metadata?.hls?.status === 'ready'
}

export interface VideoSourceArgs {
  hlsReady: boolean
  orgUuid: string
  courseUuid: string
  activityUuid: string
  filename?: string
}

export interface VideoSource {
  src: string
  isHls: boolean
}

/**
 * Resolve the source URL for a hosted video: adaptive HLS when ready, otherwise
 * the (optimized) progressive MP4 stream. Empty when there's no file.
 */
export function resolveActivityVideoSource(args: VideoSourceArgs): VideoSource {
  const { hlsReady, orgUuid, courseUuid, activityUuid, filename } = args
  if (!filename) return { src: '', isHls: false }
  if (hlsReady) {
    return { src: getActivityHlsMasterUrl(orgUuid, courseUuid, activityUuid), isHls: true }
  }
  return {
    src: getActivityVideoStreamUrl(orgUuid, courseUuid, activityUuid, filename),
    isHls: false,
  }
}

/**
 * The player requests both API playlists and R2 segments. Send the auth cookie
 * only to our API playlist endpoint (for RBAC); presigned R2 segment requests
 * must stay uncredentialed (R2 CORS rejects credentialed wildcard requests).
 */
export function shouldSendHlsCredentials(url: string): boolean {
  return url.includes('/api/v1/stream/hls/')
}

export interface ThumbnailArgs {
  orgUuid: string
  courseUuid: string
  activityUuid: string
}

/**
 * Resolve the hover-scrub thumbnail config for the player from the activity's
 * HLS metadata, or null when unavailable/incomplete. Only valid when HLS is
 * ready (the sprite lives alongside the HLS output).
 */
export function resolveHlsThumbnails(
  activity: HlsActivityMeta,
  ids: ThumbnailArgs
): HlsThumbnails | null {
  const t = activity?.extra_metadata?.hls?.thumbnails
  if (!t || !t.url || !t.width || !t.height || !t.columns || !t.interval) {
    return null
  }
  return {
    url: getActivityHlsThumbnailsUrl(ids.orgUuid, ids.courseUuid, ids.activityUuid, t.url),
    interval: t.interval,
    width: t.width,
    height: t.height,
    columns: t.columns,
    rows: t.rows ?? 1,
  }
}
