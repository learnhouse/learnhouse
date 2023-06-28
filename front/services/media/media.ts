import { getBackendUrl } from "@services/config/config";

export function getCourseThumbnailMediaDirectory(orgId: string, courseId: string, fileId: string) {
  let uri = `${getBackendUrl()}content/${orgId}/courses/${courseId}/thumbnails/${fileId}`;
  return uri;
}

export function getActivityBlockMediaDirectory(orgId: string, courseId: string, activityId: string, blockId: any, fileId: any, type: string) {
  if (type == "pdfBlock") {
    let uri = `${getBackendUrl()}content/${orgId}/courses/${courseId}/activities/${activityId}/dynamic/blocks/pdfBlock/${blockId}/${fileId}`;
    return uri;
  }
  if (type == "videoBlock") {
    let uri = `${getBackendUrl()}content/${orgId}/courses/${courseId}/activities/${activityId}/dynamic/blocks/videoBlock/${blockId}/${fileId}`;
    return uri;
  }
  if (type == "imageBlock") {
    let uri = `${getBackendUrl()}content/${orgId}/courses/${courseId}/activities/${activityId}/dynamic/blocks/imageBlock/${blockId}/${fileId}`;
    return uri;
  }
}

export function getActivityMediaDirectory(orgId: string, courseId: string, activityId: string, fileId: string, activityType: string) {
  if (activityType == "video") {
    let uri = `${getBackendUrl()}content/${orgId}/courses/${courseId}/activities/${activityId}/video/${fileId}`;
    return uri;
  }
  if (activityType == "documentpdf") {
    let uri = `${getBackendUrl()}content/${orgId}/courses/${courseId}/activities/${activityId}/documentpdf/${fileId}`;
    return uri;
  }
}

export function getOrgLogoMediaDirectory(orgId: string, fileId: string) {
  let uri = `${getBackendUrl()}content/${orgId}/logos/${fileId}`;
  return uri;
}
