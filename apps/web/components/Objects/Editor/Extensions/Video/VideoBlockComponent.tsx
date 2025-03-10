import { NodeViewWrapper } from '@tiptap/react'
import { Video } from 'lucide-react'
import React, { useEffect } from 'react'
import styled from 'styled-components'
import { uploadNewVideoFile } from '../../../../../services/blocks/Video/video'
import { getActivityBlockMediaDirectory } from '@services/media/media'
import { useOrg } from '@components/Contexts/OrgContext'
import { useCourse } from '@components/Contexts/CourseContext'
import { useEditorProvider } from '@components/Contexts/Editor/EditorContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { FileUploadBlock, FileUploadBlockButton, FileUploadBlockInput } from '../../FileUploadBlock'
import { constructAcceptValue } from '@/lib/constants';

const SUPPORTED_FILES = constructAcceptValue(['webm', 'mp4'])

function VideoBlockComponents(props: any) {
  const org = useOrg() as any
  const course = useCourse() as any
  const editorState = useEditorProvider() as any
  const isEditable = editorState.isEditable
  const [video, setVideo] = React.useState(null)
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token;
  const [isLoading, setIsLoading] = React.useState(false)
  const [blockObject, setblockObject] = React.useState(
    props.node.attrs.blockObject
  )
  const fileId = blockObject
    ? `${blockObject.content.file_id}.${blockObject.content.file_format}`
    : null

  const handleVideoChange = (event: React.ChangeEvent<any>) => {
    setVideo(event.target.files[0])
  }

  const handleSubmit = async (e: any) => {
    e.preventDefault()
    setIsLoading(true)
    let object = await uploadNewVideoFile(
      video,
      props.extension.options.activity.activity_uuid, access_token
    )
    setIsLoading(false)
    setblockObject(object)
    props.updateAttributes({
      blockObject: object,
    })
  }

  useEffect(() => { }, [course, org])

  console.log(blockObject)

  return (
    <NodeViewWrapper className="block-video">    
      <FileUploadBlock isEditable={isEditable} isLoading={isLoading} isEmpty={!blockObject} Icon={Video}>
        <FileUploadBlockInput onChange={handleVideoChange} accept={SUPPORTED_FILES} />
        <FileUploadBlockButton onClick={handleSubmit} disabled={!video}/>
      </FileUploadBlock>

      {blockObject && (
        <BlockVideo>
          <video
            controls
            className="rounded-lg shadow-sm h-96 w-full object-scale-down bg-black"
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
