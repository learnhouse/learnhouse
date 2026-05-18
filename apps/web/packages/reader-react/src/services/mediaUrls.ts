import { normalizeBaseUrl } from './urls'

export type BlockMediaType =
  | 'imageBlock'
  | 'videoBlock'
  | 'audioBlock'
  | 'pdfBlock'

export interface MediaUrlInput {
  /** Base URL for static media (defaults to `baseApiUrl`). */
  mediaBaseUrl: string
  orgUuid: string
  courseUuid: string
  activityUuid: string
  blockUuid: string
  fileId: string
  type: BlockMediaType
}

export function getActivityBlockMediaUrl(input: MediaUrlInput): string {
  const base = normalizeBaseUrl(input.mediaBaseUrl)
  return `${base}content/orgs/${input.orgUuid}/courses/${input.courseUuid}/activities/${input.activityUuid}/dynamic/blocks/${input.type}/${input.blockUuid}/${input.fileId}`
}

export interface ActivityMediaInput {
  mediaBaseUrl: string
  orgUuid: string
  courseUuid: string
  activityUuid: string
  fileId: string
  /** 'video' for hosted video activities, 'documentpdf' for PDF activities. */
  activityKind: 'video' | 'documentpdf'
}

export function getActivityMediaUrl(input: ActivityMediaInput): string {
  const base = normalizeBaseUrl(input.mediaBaseUrl)
  return `${base}content/orgs/${input.orgUuid}/courses/${input.courseUuid}/activities/${input.activityUuid}/${input.activityKind}/${input.fileId}`
}

export interface StreamUrlInput {
  /** Base URL for streaming endpoints (defaults to `baseApiUrl`). */
  baseApiUrl: string
  orgUuid: string
  courseUuid: string
  activityUuid: string
  blockUuid?: string
  filename: string
  /** Activity-level video or block-level video/audio? */
  kind: 'activity-video' | 'video-block' | 'audio-block'
}

export function getStreamUrl(input: StreamUrlInput): string {
  const base = normalizeBaseUrl(input.baseApiUrl)
  switch (input.kind) {
    case 'activity-video':
      return `${base}api/v1/stream/video/${input.orgUuid}/${input.courseUuid}/${input.activityUuid}/${input.filename}`
    case 'video-block':
      return `${base}api/v1/stream/block/${input.orgUuid}/${input.courseUuid}/${input.activityUuid}/${input.blockUuid}/${input.filename}`
    case 'audio-block':
      return `${base}api/v1/stream/block/audio/${input.orgUuid}/${input.courseUuid}/${input.activityUuid}/${input.blockUuid}/${input.filename}`
  }
}
