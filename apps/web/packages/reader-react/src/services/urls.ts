export function normalizeBaseUrl(baseApiUrl: string): string {
  return baseApiUrl.endsWith('/') ? baseApiUrl : baseApiUrl + '/'
}

export function stripPrefix(value: string, prefix: string): string {
  return value.startsWith(prefix) ? value.slice(prefix.length) : value
}

export function activityIdWithPrefix(activityId: string): string {
  return activityId.startsWith('activity_')
    ? activityId
    : `activity_${activityId}`
}

export function courseUuidWithPrefix(courseUuid: string): string {
  return courseUuid.startsWith('course_') ? courseUuid : `course_${courseUuid}`
}
