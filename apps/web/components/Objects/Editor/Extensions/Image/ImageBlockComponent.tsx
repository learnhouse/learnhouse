import { NodeViewWrapper } from '@tiptap/react'
import React, { useEffect } from 'react'
import { Resizable } from 're-resizable'
import { AlertTriangle, Image } from 'lucide-react'
import { uploadNewImageFile } from '../../../../../services/blocks/Image/images'
import { getActivityBlockMediaDirectory } from '@services/media/media'
import { useOrg } from '@components/Contexts/OrgContext'
import { useCourse } from '@components/Contexts/CourseContext'
import { useEditorProvider } from '@components/Contexts/Editor/EditorContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { FileUploadBlock, FileUploadBlockButton, FileUploadBlockInput } from '../../FileUploadBlock'

function ImageBlockComponent(props: any) {
  const org = useOrg() as any
  const course = useCourse() as any
  const editorState = useEditorProvider() as any
  const session = useLHSession() as any
    const access_token = session?.data?.tokens?.access_token;

  const isEditable = editorState.isEditable
  const [image, setImage] = React.useState(null)
  const [isLoading, setIsLoading] = React.useState(false)
  const [blockObject, setblockObject] = React.useState(
    props.node.attrs.blockObject
  )
  const [imageSize, setImageSize] = React.useState({
    width: props.node.attrs.size ? props.node.attrs.size.width : 300,
  })
  const fileId = blockObject
    ? `${blockObject.content.file_id}.${blockObject.content.file_format}`
    : null
  const handleImageChange = (event: React.ChangeEvent<any>) => {
    setImage(event.target.files[0])
  }

  const handleSubmit = async (e: any) => {
    e.preventDefault()
    setIsLoading(true)
    let object = await uploadNewImageFile(
      image,
      props.extension.options.activity.activity_uuid,access_token
    )
    setIsLoading(false)
    setblockObject(object)
    props.updateAttributes({
      blockObject: object,
      size: imageSize,
    })
  }

  useEffect(() => {}, [course, org])

  return (
    <NodeViewWrapper className="block-image">
     <FileUploadBlock isEditable={isEditable} isLoading={isLoading} isEmpty={!blockObject} Icon={Image}>
        <FileUploadBlockInput onChange={handleImageChange} accept="image/*" />
        <FileUploadBlockButton onClick={handleSubmit} disabled={!image}/>
      </FileUploadBlock>
      
      {blockObject && (
        <Resizable
          defaultSize={{ width: imageSize.width, height: '100%' }}
          handleStyles={{
            right: {
              position: 'unset',
              width: 7,
              height: 30,
              borderRadius: 20,
              cursor: 'col-resize',
              backgroundColor: 'black',
              opacity: '0.3',
              margin: 'auto',
              marginLeft: 5,
            },
          }}
          style={{
            margin: 'auto',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            height: '100%',
          }}
          maxWidth={1000}
          minWidth={200}
          onResizeStop={(e, direction, ref, d) => {
            props.updateAttributes({
              size: {
                width: imageSize.width + d.width,
              },
            })
            setImageSize({
              width: imageSize.width + d.width,
            })
          }}
        >
          <img
            src={`${getActivityBlockMediaDirectory(
              org?.org_uuid,
              course?.courseStructure.course_uuid,
              props.extension.options.activity.activity_uuid,
              blockObject.block_uuid,
              blockObject ? fileId : ' ',
              'imageBlock'
            )}`}
            alt=""
            className="rounded-lg shadow "
          />
        </Resizable>
      )}
      {isLoading && (
        <div>
          <AlertTriangle color="#e1e0e0" size={50} />
        </div>
      )}
    </NodeViewWrapper>
  )
}

export default ImageBlockComponent