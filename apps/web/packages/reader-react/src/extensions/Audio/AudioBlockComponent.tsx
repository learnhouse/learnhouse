'use client'

import { NodeViewWrapper } from '@tiptap/react'
import { useReaderConfig } from '../../Reader/ReaderProvider'
import { useCourse } from '../../contexts/CourseContext'
import { getStreamUrl } from '../../services/mediaUrls'
import { stripPrefix } from '../../services/urls'

const AUDIO_MAX_WIDTH: Record<string, number | string> = {
  small: 400,
  medium: 600,
  large: 800,
  full: '100%',
}

export default function AudioBlockComponent(props: any) {
  const { orgUuid, baseApiUrl } = useReaderConfig()
  const course = useCourse() as any
  const blockObject = props.node.attrs.blockObject
  const courseUuid: string | undefined = course?.courseStructure?.course_uuid
  const activityUuid: string | undefined =
    blockObject?.content?.activity_uuid ?? props.extension.options.activity?.activity_uuid

  if (!blockObject) return null

  // v0: only the uploaded-file source type renders a player; podcast
  // sources require app-specific catalog data we don't ship in the package.
  const sourceType: string | undefined = blockObject.source_type
  if (sourceType && sourceType !== 'upload') {
    return (
      <NodeViewWrapper className="block-audio w-full">
        <div className="rounded-lg bg-gray-50 px-4 py-3 text-sm text-gray-500">
          Podcast audio block — open this activity in LearnHouse to listen.
        </div>
      </NodeViewWrapper>
    )
  }

  if (!orgUuid || !courseUuid || !activityUuid || !blockObject.block_uuid) {
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
    kind: 'audio-block',
  })

  const sizeKey: string = typeof blockObject.size === 'string' ? blockObject.size : 'medium'
  const maxWidth = AUDIO_MAX_WIDTH[sizeKey] ?? AUDIO_MAX_WIDTH.medium

  return (
    <NodeViewWrapper className="block-audio w-full">
      <div
        className="w-full"
        style={{ maxWidth: typeof maxWidth === 'number' ? `${maxWidth}px` : maxWidth }}
      >
        <audio src={streamUrl} controls preload="metadata" className="w-full" />
      </div>
    </NodeViewWrapper>
  )
}
