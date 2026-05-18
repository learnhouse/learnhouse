'use client'

import { useReaderConfig } from '../../Reader/ReaderProvider'
import { getActivityMediaUrl } from '../../services/mediaUrls'
import { stripPrefix } from '../../services/urls'

export interface DocumentPdfActivityProps {
  activity: {
    activity_uuid: string
    content: { filename?: string }
  }
  course: { course_uuid: string }
}

export function DocumentPdfActivity({ activity, course }: DocumentPdfActivityProps) {
  const { orgUuid, mediaBaseUrl, baseApiUrl } = useReaderConfig()
  if (!orgUuid || !activity.content?.filename) return null

  const src = getActivityMediaUrl({
    mediaBaseUrl: mediaBaseUrl ?? baseApiUrl,
    orgUuid,
    courseUuid: stripPrefix(course.course_uuid, 'course_'),
    activityUuid: stripPrefix(activity.activity_uuid, 'activity_'),
    fileId: activity.content.filename,
    activityKind: 'documentpdf',
  })

  return (
    <div className="m-0 sm:m-8 bg-zinc-900 sm:rounded-md mt-0 sm:mt-14">
      <iframe
        title="Document PDF"
        src={src}
        className="sm:rounded-lg w-full h-[85vh] sm:h-[900px] border-0"
      />
    </div>
  )
}

export default DocumentPdfActivity
