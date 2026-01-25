import { NodeViewWrapper } from '@tiptap/react'
import React, { useEffect } from 'react'
import { Resizable } from 're-resizable'
import { Image, Download, AlignLeft, AlignCenter, AlignRight, Expand, Upload, Loader2 } from 'lucide-react'
import { uploadNewImageFile } from '../../../../../services/blocks/Image/images'
import { getActivityBlockMediaDirectory } from '@services/media/media'
import { useOrg } from '@components/Contexts/OrgContext'
import { useCourse } from '@components/Contexts/CourseContext'
import { useEditorProvider } from '@components/Contexts/Editor/EditorContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { constructAcceptValue } from '@/lib/constants';
import Modal from '@components/Objects/StyledElements/Modal/Modal'

const SUPPORTED_FILES = constructAcceptValue(['jpg', 'png', 'webp', 'gif'])

function ImageBlockComponent(props: any) {
  const org = useOrg() as any
  const course = useCourse() as any
  const editorState = useEditorProvider() as any
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token;
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  const isEditable = editorState.isEditable
  const [image, setImage] = React.useState<File | null>(null)
  const [isLoading, setIsLoading] = React.useState(false)
  const [isDragging, setIsDragging] = React.useState(false)
  const [blockObject, setblockObject] = React.useState(
    props.node.attrs.blockObject
  )
  const [imageSize, setImageSize] = React.useState({
    width: props.node.attrs.size ? props.node.attrs.size.width : 300,
  })
  const [alignment, setAlignment] = React.useState(props.node.attrs.alignment || 'center')
  const [isModalOpen, setIsModalOpen] = React.useState(false)

  const fileId = blockObject
    ? `${blockObject.content.file_id}.${blockObject.content.file_format}`
    : null

  const handleImageChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) {
      setImage(file)
      handleUpload(file)
    }
  }

  const handleUpload = async (file: File) => {
    if (!access_token) return
    setIsLoading(true)
    let object = await uploadNewImageFile(
      file,
      props.extension.options.activity.activity_uuid,
      access_token
    )
    setIsLoading(false)
    setblockObject(object)
    props.updateAttributes({
      blockObject: object,
      size: imageSize,
      alignment: alignment,
    })
    setImage(null)
  }

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file && ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) {
      setImage(file)
      handleUpload(file)
    }
  }

  const handleDownload = () => {
    if (!fileId) return;

    const imageUrl = getActivityBlockMediaDirectory(
      org?.org_uuid,
      course?.courseStructure.course_uuid,
      blockObject.content.activity_uuid || props.extension.options.activity.activity_uuid,
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

  const handleExpand = () => {
    setIsModalOpen(true);
  };

  const handleAlignmentChange = (newAlignment: string) => {
    setAlignment(newAlignment);
    props.updateAttributes({
      alignment: newAlignment,
    });
  };

  const imageUrl = blockObject ? getActivityBlockMediaDirectory(
    org?.org_uuid,
    course?.courseStructure.course_uuid,
    blockObject.content.activity_uuid || props.extension.options.activity.activity_uuid,
    blockObject.block_uuid,
    fileId || '',
    'imageBlock'
  ) : null;

  useEffect(() => {}, [course, org])

  const getAlignmentClass = () => {
    switch (alignment) {
      case 'left':
        return 'justify-start';
      case 'right':
        return 'justify-end';
      default:
        return 'justify-center';
    }
  };

  return (
    <>
      <NodeViewWrapper className="block-image w-full">
        <div className="rounded-xl px-3 sm:px-5 py-4 bg-slate-100 transition-all ease-linear">
          {/* Header */}
          <div className="flex flex-wrap gap-2 items-center text-sm mb-3">
            <div className="flex space-x-2 items-center">
              <Image className="text-slate-400" size={15} />
              <p className="uppercase tracking-widest text-xs font-bold text-slate-400">
                Image
              </p>
            </div>
            <div className="grow"></div>
          </div>

          {/* Upload Zone - shown when no image */}
          {!blockObject && isEditable && (
            <div
              onClick={() => fileInputRef.current?.click()}
              onDragEnter={handleDragEnter}
              onDragOver={handleDragEnter}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`
                border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-all
                ${isDragging ? 'border-blue-400 bg-blue-50' : 'border-slate-300 bg-white hover:border-blue-400 hover:bg-blue-50/50'}
              `}
            >
              <input
                ref={fileInputRef}
                type="file"
                onChange={handleImageChange}
                accept={SUPPORTED_FILES}
                className="hidden"
              />
              {isLoading ? (
                <div className="space-y-3">
                  <Loader2 className="w-8 h-8 animate-spin mx-auto text-blue-500" />
                  <p className="text-sm text-slate-600">Uploading image...</p>
                </div>
              ) : (
                <div className="space-y-3">
                  <Upload className="w-8 h-8 mx-auto text-slate-400" />
                  <div>
                    <p className="text-sm font-medium text-slate-700">
                      Drop your image here or click to browse
                    </p>
                    <p className="text-xs text-slate-500 mt-1">
                      Supports JPG, PNG, WebP, and GIF
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Empty state for non-editable */}
          {!blockObject && !isEditable && (
            <div className="flex items-center justify-center gap-3 py-8 bg-white rounded-lg">
              <Image className="text-slate-300" size={32} />
              <p className="text-slate-500">No image available</p>
            </div>
          )}

          {/* Image display - edit mode */}
          {blockObject && isEditable && (
            <div className={`w-full flex ${getAlignmentClass()}`}>
              <Resizable
                defaultSize={{ width: imageSize.width, height: '100%' }}
                handleStyles={{
                  right: {
                    position: 'unset',
                    width: 7,
                    height: 30,
                    borderRadius: 20,
                    cursor: 'col-resize',
                    backgroundColor: '#94a3b8',
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
                <div className="relative">
                  <img
                    src={imageUrl || ''}
                    alt=""
                    className="rounded-lg shadow-sm max-w-full h-auto"
                    style={{ width: '100%' }}
                  />
                  <div className="absolute top-2 right-2 flex items-center gap-1 bg-white/90 backdrop-blur-sm rounded-lg p-1 shadow-sm opacity-80 hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => handleAlignmentChange('left')}
                      className={`p-1.5 rounded-md transition-colors ${alignment === 'left' ? 'bg-slate-200 text-slate-700' : 'hover:bg-slate-100 text-slate-500'}`}
                      title="Align left"
                    >
                      <AlignLeft size={14} />
                    </button>
                    <button
                      onClick={() => handleAlignmentChange('center')}
                      className={`p-1.5 rounded-md transition-colors ${alignment === 'center' ? 'bg-slate-200 text-slate-700' : 'hover:bg-slate-100 text-slate-500'}`}
                      title="Center align"
                    >
                      <AlignCenter size={14} />
                    </button>
                    <button
                      onClick={() => handleAlignmentChange('right')}
                      className={`p-1.5 rounded-md transition-colors ${alignment === 'right' ? 'bg-slate-200 text-slate-700' : 'hover:bg-slate-100 text-slate-500'}`}
                      title="Align right"
                    >
                      <AlignRight size={14} />
                    </button>
                    <div className="w-px h-4 bg-slate-200 mx-0.5"></div>
                    <button
                      onClick={handleExpand}
                      className="p-1.5 rounded-md hover:bg-slate-100 text-slate-500 transition-colors"
                      title="Expand image"
                    >
                      <Expand size={14} />
                    </button>
                  </div>
                </div>
              </Resizable>
            </div>
          )}

          {/* Image display - view mode */}
          {blockObject && !isEditable && (
            <div className={`w-full flex ${getAlignmentClass()}`}>
              <div className="relative group">
                <img
                  src={imageUrl || ''}
                  alt=""
                  className="rounded-lg shadow-sm max-w-full h-auto"
                  style={{ width: imageSize.width, maxWidth: '100%' }}
                />
                <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={handleExpand}
                    className="p-2 bg-black/50 hover:bg-black/70 rounded-lg transition-colors"
                    title="Expand image"
                  >
                    <Expand className="w-4 h-4 text-white" />
                  </button>
                  <button
                    onClick={handleDownload}
                    className="p-2 bg-black/50 hover:bg-black/70 rounded-lg transition-colors"
                    title="Download image"
                  >
                    <Download className="w-4 h-4 text-white" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </NodeViewWrapper>

      {blockObject && imageUrl && (
        <Modal
          isDialogOpen={isModalOpen}
          onOpenChange={setIsModalOpen}
          dialogTitle="Image Viewer"
          minWidth="lg"
          minHeight="lg"
          dialogContent={
            <div className="w-full flex items-center justify-center">
              <img
                src={imageUrl}
                alt=""
                className="max-w-full max-h-[80vh] object-contain rounded-lg shadow-lg"
              />
            </div>
          }
        />
      )}
    </>
  )
}

export default ImageBlockComponent