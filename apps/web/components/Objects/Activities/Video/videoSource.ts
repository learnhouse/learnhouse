import {
  getActivityVideoStreamUrl,
  getActivityHlsMasterUrl,
  getActivityHlsThumbnailsUrl,
  getActivityCaptionUrl,
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
  // Guard against a missing filename (incl. whitespace-only) or any missing id;
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
  // Our authed playlist/key endpoints (activity + video block), but NEVER a
  // presigned object-storage URL (those always carry X-Amz-* query params).
  // Sending the cookie cross-origin to R2 would fail CORS and leak the cookie.
  const isApiPlaylist =
    url.includes('/api/v1/stream/hls/') || url.includes('/api/v1/stream/block-hls/')
  return isApiPlaylist && !url.includes('X-Amz-')
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

function vttTimestamp(seconds: number): string {
  const ms = Math.round(seconds * 1000)
  const h = Math.floor(ms / 3600000)
  const m = Math.floor(ms / 60000) % 60
  const s = Math.floor(ms / 1000) % 60
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(ms % 1000, 3)}`
}

/**
 * Turn a sprite-sheet grid into a storyboard WebVTT, the format the player's
 * timeline previews read: one cue per frame, cropped with `#xywh`. The sprite
 * URL is made absolute against `baseUrl` because the VTT is served from a blob
 * URL, where relative paths don't resolve. Null when the grid is unusable.
 */
export function buildThumbnailsVtt(t: HlsThumbnails, baseUrl: string): string | null {
  const pos = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0
  if (!t.url || !pos(t.interval) || !pos(t.width) || !pos(t.height) || !pos(t.columns)) {
    return null
  }
  const rows = pos(t.rows) ? t.rows : 1
  let sprite: string
  try {
    sprite = new URL(t.url, baseUrl).href
  } catch {
    return null
  }
  const lines = ['WEBVTT', '']
  for (let i = 0; i < t.columns * rows; i++) {
    const x = (i % t.columns) * t.width
    const y = Math.floor(i / t.columns) * t.height
    lines.push(
      `${vttTimestamp(i * t.interval)} --> ${vttTimestamp((i + 1) * t.interval)}`,
      `${sprite}#xywh=${x},${y},${t.width},${t.height}`,
      ''
    )
  }
  return lines.join('\n')
}

export interface CaptionTrack {
  code: string
  label: string
  url: string
}

interface CaptionsActivityMeta {
  extra_metadata?: {
    captions?: {
      enabled?: boolean
      languages?: { code?: string; label?: string; status?: string }[]
    } | null
  } | null
}

/**
 * Resolve the ready caption tracks for an activity from its captions metadata.
 * Only languages whose generation finished (`status === 'ready'`) are returned.
 */
export function resolveActivityCaptions(
  activity: CaptionsActivityMeta,
  ids: ThumbnailArgs
): CaptionTrack[] {
  const caps = activity?.extra_metadata?.captions
  if (!caps || !caps.enabled) return []
  if (!ids.orgUuid || !ids.courseUuid || !ids.activityUuid) return []
  return (caps.languages || [])
    .filter((l) => l && l.status === 'ready' && !!l.code)
    .map((l) => ({
      code: l.code as string,
      label: l.label || (l.code as string),
      url: getActivityCaptionUrl(ids.orgUuid, ids.courseUuid, ids.activityUuid, l.code as string),
    }))
}

/**
 * The activities before and after `activityUuid` in course order (chapters
 * flattened). Unpublished neighbours are skipped, since learners can't open
 * them. `next` is null on the last activity.
 */
export function resolveAdjacentActivities<T extends { activity_uuid?: string; published?: boolean }>(
  course: { chapters?: { activities?: T[] }[] } | null | undefined,
  activityUuid: string
): { prev: T | null; next: T | null } {
  const all = (course?.chapters || []).flatMap((c) => c.activities || [])
  const strip = (u?: string) => (u || '').replace(/^activity_/, '')
  const index = all.findIndex((a) => strip(a.activity_uuid) === strip(activityUuid))
  if (index === -1) return { prev: null, next: null }
  const visible = (a: T) => a.published !== false
  const prev = all.slice(0, index).reverse().find(visible) || null
  const next = all.slice(index + 1).find(visible) || null
  return { prev, next }
}

type FrameStyle = { backgroundImage: string; backgroundSize: string; backgroundPosition: string }

function frameStyle(t: HlsThumbnails, index: number): FrameStyle {
  const rows = t.rows > 0 ? t.rows : 1
  const total = t.columns * rows
  const i = Math.min(total - 1, Math.max(0, index))
  const col = i % t.columns
  const row = Math.floor(i / t.columns)
  const pct = (n: number, of: number) => (of > 1 ? (n / (of - 1)) * 100 : 0)
  return {
    backgroundImage: `url("${t.url}")`,
    backgroundSize: `${t.columns * 100}% ${rows * 100}%`,
    backgroundPosition: `${pct(col, t.columns)}% ${pct(row, rows)}%`,
  }
}

/**
 * Background styles that show one frame of a sprite sheet, sized in
 * percentages so the frame fills whatever box it's drawn into. `fraction`
 * picks the frame (0 = first, 1 = last).
 */
export function spriteFrameStyle(t: HlsThumbnails, fraction = 0.2): FrameStyle {
  const total = t.columns * (t.rows > 0 ? t.rows : 1)
  return frameStyle(t, Math.floor(total * fraction))
}

/** Like `spriteFrameStyle`, for the frame shown at `seconds` into the video. */
export function spriteFrameAt(t: HlsThumbnails, seconds: number): FrameStyle {
  return frameStyle(t, Math.floor(Math.max(0, seconds) / t.interval))
}

export interface VideoChapter {
  start: number
  title: string
}

interface ChaptersActivityMeta {
  extra_metadata?: {
    chapters?: { status?: string; items?: { start?: unknown; title?: unknown }[] } | null
  } | null
}

/** Ready chapters for an activity, sorted, with malformed entries dropped. */
export function resolveActivityChapters(activity: ChaptersActivityMeta): VideoChapter[] {
  const ch = activity?.extra_metadata?.chapters
  if (!ch || ch.status !== 'ready' || !Array.isArray(ch.items)) return []
  const items = ch.items
    .filter(
      (c): c is VideoChapter =>
        typeof c?.start === 'number' && Number.isFinite(c.start) && c.start >= 0 &&
        typeof c?.title === 'string' && c.title.trim() !== ''
    )
    .map((c) => ({ start: c.start, title: c.title.trim() }))
    .sort((a, b) => a.start - b.start)
  return items.length >= 2 ? items : []
}

/**
 * A WebVTT chapters track for the player's time slider: each chapter runs
 * until the next one starts; the last runs to the end (the player clamps cue
 * ends to the media duration).
 */
export function buildChaptersVtt(chapters: VideoChapter[]): string | null {
  if (chapters.length < 2) return null
  const escape = (text: string) =>
    text.replace(/\s+/g, ' ').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/-->/g, '→')
  const lines = ['WEBVTT', '']
  chapters.forEach((c, i) => {
    const end = i + 1 < chapters.length ? chapters[i + 1].start : 359999
    lines.push(`${vttTimestamp(c.start)} --> ${vttTimestamp(end)}`, escape(c.title), '')
  })
  return lines.join('\n')
}

/** Index of the chapter playing at `seconds`, or -1 before the first. */
export function chapterIndexAt(chapters: VideoChapter[], seconds: number): number {
  let index = -1
  for (let i = 0; i < chapters.length; i++) {
    if (chapters[i].start <= seconds) index = i
    else break
  }
  return index
}

/** `m:ss` / `h:mm:ss` label for a chapter start. */
export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor(total / 60) % 60
  const s = String(total % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

/** Seconds from `ss`, `m:ss` or `h:mm:ss`; NaN when it isn't a clock value. */
export function parseClock(text: string): number {
  const parts = text.trim().split(':')
  if (!parts.length || parts.length > 3 || parts.some((p) => !/^\d+$/.test(p))) return NaN
  return parts.reduce((total, p) => total * 60 + Number(p), 0)
}
