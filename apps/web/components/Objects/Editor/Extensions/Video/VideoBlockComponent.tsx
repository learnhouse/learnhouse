import { constructAcceptValue } from '@/lib/constants'
import { useCourse } from '@components/Contexts/CourseContext'
import { useEditorProvider } from '@components/Contexts/Editor/EditorContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { getActivityBlockMediaDirectory } from '@services/media/media'
import { NodeViewWrapper } from '@tiptap/react'
import { Video } from 'lucide-react'
import type { ChangeEvent } from 'react'
import { useState, useEffect } from 'react'
import styled from 'styled-components'
import { uploadNewVideoFile } from '@services/blocks/Video/video'
import {
  FileUploadBlock,
  FileUploadBlockButton,
  FileUploadBlockInput,
} from '@components/Objects/Editor/FileUploadBlock'

const SUPPORTED_FILES = constructAcceptValue(['webm', 'mp4'])

function VideoBlockComponents(props: any) {
  const org = useOrg() as any
  const course = useCourse() as any
  const editorState = useEditorProvider() as any
  const isEditable = editorState.isEditable
  const [video, setVideo] = useState(null)
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const [isLoading, setIsLoading] = useState(false)
  const [blockObject, setblockObject] = useState(props.node.attrs.blockObject)
  const fileId = blockObject
    ? `${blockObject.content.file_id}.${blockObject.content.file_format}`
    : null

  const handleVideoChange = (event: ChangeEvent<any>) => {
    setVideo(event.target.files[0])
  }

  const handleSubmit = async (e: any) => {
    e.preventDefault()
    setIsLoading(true)
    const object = await uploadNewVideoFile(
      video,
      props.extension.options.activity.activity_uuid,
      access_token
    )
    setIsLoading(false)
    setblockObject(object)
    props.updateAttributes({
      blockObject: object,
    })
  }

  useEffect(() => {}, [course, org])

  console.log(blockObject)

  return (
    <NodeViewWrapper className="block-video">
      <FileUploadBlock
        isEditable={isEditable}
        isLoading={isLoading}
        isEmpty={!blockObject}
        Icon={Video}
      >
        <FileUploadBlockInput
          onChange={handleVideoChange}
          accept={SUPPORTED_FILES}
        />
        <FileUploadBlockButton onClick={handleSubmit} disabled={!video} />
      </FileUploadBlock>

      {blockObject && (
        <BlockVideo>
          <video
            controls
            className="h-96 w-full rounded-lg bg-black object-scale-down shadow-sm"
            src={`${getActivityBlockMediaDirectory(
              org?.org_uuid,
              course?.courseStructure.course_uuid,
              props.extension.options.activity.activity_uuid,
              blockObject.block_uuid,
              blockObject ? fileId : ' ',
              'videoBlock'
            )}`}
          ></video>
        </BlockVideo>
      )}
    </NodeViewWrapper>
  )
}

const BlockVideo = styled.div`
  display: flex;
  flex-direction: column;
`
export default VideoBlockComponents
