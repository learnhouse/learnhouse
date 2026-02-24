import { getBackendUrl, getConfig } from '@services/config/config'

function getMediaUrl() {
  const mediaUrl = getConfig('NEXT_PUBLIC_LEARNHOUSE_MEDIA_URL');
  if (mediaUrl) {
    return mediaUrl;
  } else {
    return getBackendUrl();
  }
}

function getApiUrl() {
  return getBackendUrl();
}

/**
 * Get the streaming URL for an activity video.
 * Uses the optimized streaming endpoint with proper Range request support.
 */
export function getActivityVideoStreamUrl(
  orgUUID: string,
  courseUUID: string,
  activityUUID: string,
  filename: string
) {
  return `${getApiUrl()}api/v1/stream/video/${orgUUID}/${courseUUID}/${activityUUID}/${filename}`
}

/**
 * Get the streaming URL for a video block.
 * Uses the optimized streaming endpoint with proper Range request support.
 */
export function getVideoBlockStreamUrl(
  orgUUID: string,
  courseUUID: string,
  activityUUID: string,
  blockUUID: string,
  filename: string
) {
  return `${getApiUrl()}api/v1/stream/block/${orgUUID}/${courseUUID}/${activityUUID}/${blockUUID}/${filename}`
}

/**
 * Get the streaming URL for an audio block.
 * Uses the optimized streaming endpoint with proper Range request support.
 */
export function getAudioBlockStreamUrl(
  orgUUID: string,
  courseUUID: string,
  activityUUID: string,
  blockUUID: string,
  filename: string
) {
  return `${getApiUrl()}api/v1/stream/block/audio/${orgUUID}/${courseUUID}/${activityUUID}/${blockUUID}/${filename}`
}

export function getCourseThumbnailMediaDirectory(
  orgUUID: string,
  courseUUID: string,
  fileId: string
) {
  let uri = `${getMediaUrl()}content/orgs/${orgUUID}/courses/${courseUUID}/thumbnails/${fileId}`
  return uri
}

export function getBoardThumbnailMediaDirectory(
  orgUUID: string,
  boardUUID: string,
  fileId: string
) {
  let uri = `${getMediaUrl()}content/orgs/${orgUUID}/boards/${boardUUID}/thumbnails/${fileId}`
  return uri
}

export function getPlaygroundThumbnailMediaDirectory(
  orgUUID: string,
  playgroundUUID: string,
  fileId: string
) {
  let uri = `${getMediaUrl()}content/orgs/${orgUUID}/playgrounds/${playgroundUUID}/thumbnails/${fileId}`
  return uri
}

export function getCommunityThumbnailMediaDirectory(
  orgUUID: string,
  communityUUID: string,
  fileId: string
) {
  let uri = `${getMediaUrl()}content/orgs/${orgUUID}/communities/${communityUUID}/thumbnails/${fileId}`
  return uri
}

export function getOrgLandingMediaDirectory(orgUUID: string, fileId: string) {
  let uri = `${getMediaUrl()}content/orgs/${orgUUID}/landing/${fileId}`
  return uri
}

export function getUserAvatarMediaDirectory(userUUID: string, fileId: string) {
  let uri = `${getMediaUrl()}content/users/${userUUID}/avatars/${fileId}`
  return uri
}

export function getActivityBlockMediaDirectory(
  orgUUID: string,
  courseId: string,
  activityId: string,
  blockId: any,
  fileId: any,
  type: string
) {
  if (type == 'pdfBlock') {
    let uri = `${getMediaUrl()}content/orgs/${orgUUID}/courses/${courseId}/activities/${activityId}/dynamic/blocks/pdfBlock/${blockId}/${fileId}`
    return uri
  }
  if (type == 'videoBlock') {
    let uri = `${getMediaUrl()}content/orgs/${orgUUID}/courses/${courseId}/activities/${activityId}/dynamic/blocks/videoBlock/${blockId}/${fileId}`
    return uri
  }
  if (type == 'imageBlock') {
    let uri = `${getMediaUrl()}content/orgs/${orgUUID}/courses/${courseId}/activities/${activityId}/dynamic/blocks/imageBlock/${blockId}/${fileId}`
    return uri
  }
  if (type == 'audioBlock') {
    let uri = `${getMediaUrl()}content/orgs/${orgUUID}/courses/${courseId}/activities/${activityId}/dynamic/blocks/audioBlock/${blockId}/${fileId}`
    return uri
  }
}

export function getTaskRefFileDir(
  orgUUID: string,
  courseUUID: string,
  activityUUID: string,
  assignmentUUID: string,
  assignmentTaskUUID: string,
  fileID : string

) {
  let uri = `${getMediaUrl()}content/orgs/${orgUUID}/courses/${courseUUID}/activities/${activityUUID}/assignments/${assignmentUUID}/tasks/${assignmentTaskUUID}/${fileID}`
  return uri
}

export function getTaskFileSubmissionDir(
  orgUUID: string,
  courseUUID: string,
  activityUUID: string,
  assignmentUUID: string,
  assignmentTaskUUID: string,
  fileSubID : string
) {
  let uri = `${getMediaUrl()}content/orgs/${orgUUID}/courses/${courseUUID}/activities/${activityUUID}/assignments/${assignmentUUID}/tasks/${assignmentTaskUUID}/subs/${fileSubID}`
  return uri
}

export function getActivityMediaDirectory(
  orgUUID: string,
  courseUUID: string,
  activityUUID: string,
  fileId: string,
  activityType: string
) {
  if (activityType == 'video') {
    let uri = `${getMediaUrl()}content/orgs/${orgUUID}/courses/${courseUUID}/activities/${activityUUID}/video/${fileId}`
    return uri
  }
  if (activityType == 'documentpdf') {
    let uri = `${getMediaUrl()}content/orgs/${orgUUID}/courses/${courseUUID}/activities/${activityUUID}/documentpdf/${fileId}`
    return uri
  }
}

export function getOrgLogoMediaDirectory(orgUUID: string, fileId: string) {
  let uri = `${getMediaUrl()}content/orgs/${orgUUID}/logos/${fileId}`
  return uri
}

export function getOrgThumbnailMediaDirectory(orgUUID: string, fileId: string) {
  let uri = `${getMediaUrl()}content/orgs/${orgUUID}/thumbnails/${fileId}`
  return uri
}

export function getOrgPreviewMediaDirectory(orgUUID: string, fileId: string) {
  let uri = `${getMediaUrl()}content/orgs/${orgUUID}/previews/${fileId}`
  return uri
}

export function getOrgOgImageMediaDirectory(orgUUID: string, fileId: string) {
  let uri = `${getMediaUrl()}content/orgs/${orgUUID}/og_images/${fileId}`
  return uri
}

export function getOrgAuthBackgroundMediaDirectory(orgUUID: string, fileId: string) {
  let uri = `${getMediaUrl()}content/orgs/${orgUUID}/auth_backgrounds/${fileId}`
  return uri
}

export function getOrgFaviconMediaDirectory(orgUUID: string, fileId: string) {
  let uri = `${getMediaUrl()}content/orgs/${orgUUID}/favicons/${fileId}`
  return uri
}

/**
 * Get the URL for SCORM content files
 * Routes through a local proxy to ensure same-origin for SCORM API injection
 */
export function getScormContentUrl(
  orgUUID: string,
  courseUUID: string,
  activityUUID: string,
  filePath: string
): string {
  // Use local proxy route to serve SCORM content from same origin
  // This is required for the SCORM API to work properly in iframes
  return `/api/scorm/${activityUUID}/content/${filePath}`
}

/**
 * Get the thumbnail URL for a podcast
 */
export function getPodcastThumbnailMediaDirectory(
  orgUUID: string,
  podcastUUID: string,
  fileId: string
) {
  let uri = `${getMediaUrl()}content/orgs/${orgUUID}/podcasts/${podcastUUID}/thumbnails/${fileId}`
  return uri
}

/**
 * Get the thumbnail URL for a podcast episode
 */
export function getEpisodeThumbnailMediaDirectory(
  orgUUID: string,
  podcastUUID: string,
  episodeUUID: string,
  fileId: string
) {
  let uri = `${getMediaUrl()}content/orgs/${orgUUID}/podcasts/${podcastUUID}/episodes/${episodeUUID}/thumbnails/${fileId}`
  return uri
}

/**
 * Get the direct media URL for a podcast episode audio file.
 */
export function getEpisodeAudioMediaDirectory(
  orgUUID: string,
  podcastUUID: string,
  episodeUUID: string,
  fileId: string
) {
  let uri = `${getMediaUrl()}content/orgs/${orgUUID}/podcasts/${podcastUUID}/episodes/${episodeUUID}/audio/${fileId}`
  return uri
}

/**
 * Get the streaming URL for a podcast episode audio file.
 * Uses the optimized streaming endpoint with proper Range request support.
 */
export function getPodcastAudioStreamUrl(
  orgUUID: string,
  podcastUUID: string,
  episodeUUID: string,
  filename: string
) {
  return `${getApiUrl()}api/v1/stream/audio/${orgUUID}/${podcastUUID}/${episodeUUID}/${filename}`
}
