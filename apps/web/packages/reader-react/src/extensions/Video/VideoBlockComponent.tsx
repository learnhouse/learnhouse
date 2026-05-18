'use client'

import { NodeViewWrapper } from '@tiptap/react'
import { useReaderConfig } from '../../Reader/ReaderProvider'
import { useCourse } from '../../contexts/CourseContext'
import { getStreamUrl } from '../../services/mediaUrls'
import { stripPrefix } from '../../services/urls'

const VIDEO_SIZE_PX: Record<string, number | string> = {
  small: 480,
  medium: 720,
  large: 960,
  full: '100%',
}

export default function VideoBlockComponent(props: any) {
  const { orgUuid, baseApiUrl } = useReaderConfig()
  const course = useCourse() as any
  const blockObject = props.node.attrs.blockObject
  const courseUuid: string | undefined = course?.courseStructure?.course_uuid
  const activityUuid: string | undefined =
    blockObject?.content?.activity_uuid ?? props.extension.options.activity?.activity_uuid

  if (!blockObject || !orgUuid || !courseUuid || !activityUuid || !blockObject.block_uuid) {
    return null
  }

  const filename = `${blockObject.content.file_id}.${blockObject.content.file_format}`
  const streamUrl = getStreamUrl({
    baseApiUrl,
    orgUuid,
    courseUuid: stripPrefix(courseUuid, 'course_'),
    activityUuid: stripPrefix(activityUuid, 'activity_'),
    blockUuid: blockObject.block_uuid,
    filename,
    kind: 'video-block',
  })

  const sizeKey: string =
    typeof blockObject.size === 'string'
      ? blockObject.size
      : 'medium'
  const widthValue = VIDEO_SIZE_PX[sizeKey] ?? VIDEO_SIZE_PX.medium

  return (
    <NodeViewWrapper className="block-video w-full">
      <div className="w-full flex justify-center">
        <video
          src={streamUrl}
          controls
          playsInline
          className="rounded-lg max-w-full"
          style={{ width: typeof widthValue === 'number' ? `${widthValue}px` : widthValue }}
        />
      </div>
    </NodeViewWrapper>
  )
}
