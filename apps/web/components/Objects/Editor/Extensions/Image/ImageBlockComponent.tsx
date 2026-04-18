import { NodeViewWrapper } from '@tiptap/react'
import React, { useEffect } from 'react'
import { Resizable } from 're-resizable'
import { Image, Download, AlignLeft, AlignCenter, AlignRight, Expand, Upload, Loader2, AlertCircle } from 'lucide-react'
import toast from 'react-hot-toast'
import { uploadNewImageFile } from '../../../../../services/blocks/Image/images'
import { getActivityBlockMediaDirectory } from '@services/media/media'
import { useOrg } from '@components/Contexts/OrgContext'
import { useCourse } from '@components/Contexts/CourseContext'
import { useEditorProvider } from '@components/Contexts/Editor/EditorContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { constructAcceptValue } from '@/lib/constants';
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import { useTranslation } from 'react-i18next'

const SUPPORTED_FILES = constructAcceptValue(['jpg', 'png', 'webp', 'gif'])

function ImageBlockComponent(props: any) {
  const { t } = useTranslation()
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
  const [error, setError] = React.useState<string | null>(null)
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
    setError(null)
    try {
      let object = await uploadNewImageFile(
        file,
        props.extension.options.activity.activity_uuid,
        access_token
      )
      setblockObject(object)
      props.updateAttributes({
        blockObject: object,
        size: imageSize,
        alignment: alignment,
      })
      setImage(null)
    } catch (err: any) {
      const errorMessage = err?.message || 'Failed to upload image. Please try again.'
      setError(errorMessage)
      toast.error(errorMessage)
    } finally {
      setIsLoading(false)
    }
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
      course?.courseStructure?.course_uuid,
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
    course?.courseStructure?.course_uuid,
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

  // Activity view mode - show only the image without block wrapper
  if (!isEditable && blockObject && imageUrl) {
    return (
      <>
        <NodeViewWrapper className="block-image w-full">
          <div className={`w-full flex ${getAlignmentClass()}`}>
            <div className="relative group">
              <img
                src={imageUrl}
                alt=""
                className="rounded-lg max-w-full h-auto"
                style={{ width: imageSize.width, maxWidth: '100%' }}
              />
              <div className="absolute top-2 end-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={handleExpand}
                  className="p-2 outline-none bg-black/50 hover:bg-black/70 rounded-lg transition-colors"
                  title={t('editor.blocks.image_block.expand_image')}
                >
                  <Expand className="w-4 h-4 text-white" />
                </button>
                <button
                  onClick={handleDownload}
                  className="p-2 outline-none bg-black/50 hover:bg-black/70 rounded-lg transition-colors"
                  title={t('editor.blocks.image_block.download_image')}
                >
                  <Download className="w-4 h-4 text-white" />
                </button>
              </div>
            </div>
          </div>
        </NodeViewWrapper>

        <Modal
          isDialogOpen={isModalOpen}
          onOpenChange={setIsModalOpen}
          dialogTitle={t('editor.blocks.image_block.viewer_title')}
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
      </>
    )
  }

  // Activity view mode - no image available
  if (!isEditable && !blockObject) {
    return null
  }

  return (
    <>
      <NodeViewWrapper className="block-image w-full">
        <div className="bg-neutral-50 rounded-xl px-5 py-4 nice-shadow transition-all ease-linear">
          {/* Header */}
          <div className="flex items-center gap-2 mb-3">
            <Image className="text-neutral-400" size={16} />
            <span className="uppercase tracking-widest text-xs font-bold text-neutral-400">
              {t('editor.blocks.image')}
            </span>
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
                ${isDragging ? 'border-neutral-400 bg-neutral-100' : 'border-neutral-200 bg-white hover:border-neutral-400 hover:bg-neutral-50'}
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
                  <Loader2 className="w-8 h-8 animate-spin mx-auto text-neutral-500" />
                  <p className="text-sm text-neutral-600">{t('editor.blocks.image_block.uploading')}</p>
                </div>
              ) : (
                <div className="space-y-3">
                  <Upload className="w-8 h-8 mx-auto text-neutral-400" />
                  <div>
                    <p className="text-sm font-medium text-neutral-700">
                      {t('editor.blocks.image_block.drop_or_browse')}
                    </p>
                    <p className="text-xs text-neutral-500 mt-1">
                      {t('editor.blocks.image_block.supported_formats')}
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Error display */}
          {error && (
            <div className="mt-3 flex items-center gap-2 text-sm text-red-500 font-medium bg-red-50 rounded-lg p-3">
              <AlertCircle size={16} />
              {error}
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
                    className="rounded-lg nice-shadow max-w-full h-auto"
                    style={{ width: '100%' }}
                  />
                  <div className="absolute top-2 end-2 flex items-center gap-1 bg-white/90 backdrop-blur-sm rounded-lg p-1 opacity-80 hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => handleAlignmentChange('left')}
                      className={`p-1.5 rounded-md transition-colors outline-none ${alignment === 'left' ? 'bg-neutral-200 text-neutral-700' : 'hover:bg-neutral-100 text-neutral-500'}`}
                      title={t('editor.blocks.common.align_left')}
                    >
                      <AlignLeft size={14} />
                    </button>
                    <button
                      onClick={() => handleAlignmentChange('center')}
                      className={`p-1.5 rounded-md transition-colors outline-none ${alignment === 'center' ? 'bg-neutral-200 text-neutral-700' : 'hover:bg-neutral-100 text-neutral-500'}`}
                      title={t('editor.blocks.common.align_center')}
                    >
                      <AlignCenter size={14} />
                    </button>
                    <button
                      onClick={() => handleAlignmentChange('right')}
                      className={`p-1.5 rounded-md transition-colors outline-none ${alignment === 'right' ? 'bg-neutral-200 text-neutral-700' : 'hover:bg-neutral-100 text-neutral-500'}`}
                      title={t('editor.blocks.common.align_right')}
                    >
                      <AlignRight size={14} />
                    </button>
                    <div className="w-px h-4 bg-neutral-200 mx-0.5"></div>
                    <button
                      onClick={handleExpand}
                      className="p-1.5 rounded-md hover:bg-neutral-100 text-neutral-500 transition-colors outline-none"
                      title={t('editor.blocks.image_block.expand_image')}
                    >
                      <Expand size={14} />
                    </button>
                  </div>
                </div>
              </Resizable>
            </div>
          )}

        </div>
      </NodeViewWrapper>

      {blockObject && imageUrl && (
        <Modal
          isDialogOpen={isModalOpen}
          onOpenChange={setIsModalOpen}
          dialogTitle={t('editor.blocks.image_block.viewer_title')}
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
