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
  // Guard against a missing filename (incl. whitespace-only) or any missing id —
  // otherwise we'd build a URL containing the literal string "undefined".
  if (!filename || !filename.trim()) return { src: '', isHls: false }
  if (!orgUuid || !courseUuid || !activityUuid) return { src: '', isHls: false }
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
  // Our authed playlist/key endpoint — but NEVER a presigned object-storage URL
  // (those always carry X-Amz-* query params). Sending the cookie cross-origin
  // to R2 would fail CORS and leak the cookie to storage.
  return url.includes('/api/v1/stream/hls/') && !url.includes('X-Amz-')
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
  if (!t || !t.url) return null
  if (!ids.orgUuid || !ids.courseUuid || !ids.activityUuid) return null
  // Every numeric field must be a positive number; reject 0/negative/NaN so the
  // sprite plugin can't be handed a broken grid (which would mis-map or divide).
  const pos = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0
  if (!pos(t.interval) || !pos(t.width) || !pos(t.height) || !pos(t.columns)) {
    return null
  }
  const rows = pos(t.rows) ? t.rows : 1
  return {
    url: getActivityHlsThumbnailsUrl(ids.orgUuid, ids.courseUuid, ids.activityUuid, t.url),
    interval: t.interval,
    width: t.width,
    height: t.height,
    columns: t.columns,
    rows,
  }
}
