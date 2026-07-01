import { getActivityVideoStreamUrl, getActivityHlsMasterUrl } from '@services/media/media'

/**
 * Pure helpers for choosing a video activity's playback source.
 *
 * Extracted from the components so the decision logic (HLS-when-ready with an
 * MP4 fallback, and the hls.js credentials rule) can be unit-tested.
 */

export interface HlsActivityMeta {
  extra_metadata?: { hls?: { status?: string } } | null
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
 * hls.js requests both API playlists and R2 segments. Send the auth cookie only
 * to our API playlist endpoint (for RBAC); presigned R2 segment requests must
 * stay uncredentialed (R2 CORS rejects credentialed wildcard requests).
 */
export function shouldSendHlsCredentials(url: string): boolean {
  return url.includes('/api/v1/stream/hls/')
}
