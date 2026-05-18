import { useReaderConfig } from '../Reader/ReaderProvider'
import { useCourse } from '../contexts/CourseContext'
import {
  getActivityBlockMediaUrl,
  type BlockMediaType,
} from '../services/mediaUrls'
import { stripPrefix } from '../services/urls'

/**
 * Resolve a block-media URL from the active reader context.
 * Returns null if the required ids aren't available yet — callers should
 * render a fallback (e.g. nothing or a spinner) in that case.
 */
export function useResolvedBlockMediaUrl(input: {
  blockObject: any
  activityUuidFallback?: string
  type: BlockMediaType
}): string | null {
  const { orgUuid, mediaBaseUrl, baseApiUrl } = useReaderConfig()
  const course = useCourse() as any
  const courseUuid: string | undefined = course?.courseStructure?.course_uuid
  const activityUuid: string | undefined =
    input.blockObject?.content?.activity_uuid ?? input.activityUuidFallback
  const blockUuid: string | undefined = input.blockObject?.block_uuid
  const fileId =
    input.blockObject?.content?.file_id && input.blockObject?.content?.file_format
      ? `${input.blockObject.content.file_id}.${input.blockObject.content.file_format}`
      : null

  if (!orgUuid || !courseUuid || !activityUuid || !blockUuid || !fileId) {
    return null
  }

  return getActivityBlockMediaUrl({
    mediaBaseUrl: mediaBaseUrl ?? baseApiUrl,
    orgUuid,
    courseUuid: stripPrefix(courseUuid, 'course_'),
    activityUuid: stripPrefix(activityUuid, 'activity_'),
    blockUuid,
    fileId,
    type: input.type,
  })
}
