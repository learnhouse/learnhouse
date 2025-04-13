import { NodeViewWrapper } from '@tiptap/react'
import React, { useEffect } from 'react'
import { Resizable } from 're-resizable'
import { AlertTriangle, Image, Download } from 'lucide-react'
import { uploadNewImageFile } from '../../../../../services/blocks/Image/images'
import { getActivityBlockMediaDirectory } from '@services/media/media'
import { useOrg } from '@components/Contexts/OrgContext'
import { useCourse } from '@components/Contexts/CourseContext'
import { useEditorProvider } from '@components/Contexts/Editor/EditorContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { FileUploadBlock, FileUploadBlockButton, FileUploadBlockInput } from '../../FileUploadBlock'
import { constructAcceptValue } from '@/lib/constants';

const SUPPORTED_FILES = constructAcceptValue(['image'])

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

  const handleDownload = () => {
    if (!fileId) return;
    
    const imageUrl = getActivityBlockMediaDirectory(
      org?.org_uuid,
      course?.courseStructure.course_uuid,
      props.extension.options.activity.activity_uuid,
      blockObject.block_uuid,
      fileId,
      'imageBlock'
    );
    
    const link = document.createElement('a');
    link.href = imageUrl || '';
    link.download = `image-${blockObject?.block_uuid || 'download'}.${blockObject?.content.file_format || 'jpg'}`;
    link.setAttribute('download', '');
    link.setAttribute('target', '_blank');
    link.setAttribute('rel', 'noopener noreferrer');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  useEffect(() => {}, [course, org])

  return (
    <NodeViewWrapper className="block-image w-full">
     <FileUploadBlock isEditable={isEditable} isLoading={isLoading} isEmpty={!blockObject} Icon={Image}>
        <FileUploadBlockInput onChange={handleImageChange} accept={SUPPORTED_FILES} />
        <FileUploadBlockButton onClick={handleSubmit} disabled={!image}/>
      </FileUploadBlock>
      
      {blockObject && isEditable && (
        <div className="w-full flex justify-center">
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
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              height: '100%',
              maxWidth: '100%',
            }}
            maxWidth="100%"
            minWidth={200}
            enable={{ right: true }}
            onResizeStop={(e, direction, ref, d) => {
              const newWidth = Math.min(imageSize.width + d.width, ref.parentElement?.clientWidth || 1000);
              props.updateAttributes({
                size: {
                  width: newWidth,
                },
              })
              setImageSize({
                width: newWidth,
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
              className="rounded-lg shadow-sm max-w-full h-auto"
              style={{ width: '100%' }}
            />
          </Resizable>
        </div>
      )}

      {blockObject && !isEditable && (
        <div className="w-full flex justify-center">
          <div className="relative">
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
              className="rounded-lg shadow-sm max-w-full h-auto"
              style={{ width: imageSize.width, maxWidth: '100%' }}
            />
            <button
              onClick={handleDownload}
              className="absolute top-2 right-2 p-2 bg-black/50 hover:bg-black/70 rounded-full transition-colors"
              title="Download image"
            >
              <Download className="w-4 h-4 text-white" />
            </button>
          </div>
        </div>
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