import { NodeViewProps, NodeViewWrapper } from '@tiptap/react'
import { Node } from '@tiptap/core'
import {
  Loader2, Video, Upload, X, ArrowLeftRight,
  CheckCircle2, AlertCircle, Expand,
} from 'lucide-react'
import React from 'react'
import toast from 'react-hot-toast'
import { uploadNewVideoFile } from '../../../../../services/blocks/Video/video'
import { getVideoBlockStreamUrl } from '@services/media/media'
import { useOrg } from '@components/Contexts/OrgContext'
import { useCourse } from '@components/Contexts/CourseContext'
import { useEditorProvider } from '@components/Contexts/Editor/EditorContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { constructAcceptValue } from '@/lib/constants'
import { cn } from '@/lib/utils'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import LearnHousePlayer from '@components/Objects/Activities/Video/LearnHousePlayer'
import { useTranslation } from 'react-i18next'

const SUPPORTED_FILES = constructAcceptValue(['webm', 'mp4'])

const VIDEO_SIZES = {
  small: { width: 480, label: 'Small' },
  medium: { width: 720, label: 'Medium' },
  large: { width: 960, label: 'Large' },
} as const

type VideoSize = keyof typeof VIDEO_SIZES

// Helper function to determine video size from width
const getVideoSizeFromWidth = (width: number | string | undefined): VideoSize => {
  if (!width) return 'medium'
  if (width === '100%') return 'large'

  const numWidth = typeof width === 'string' ? parseInt(width) : width

  if (numWidth <= VIDEO_SIZES.small.width) return 'small'
  if (numWidth <= VIDEO_SIZES.medium.width) return 'medium'
  return 'large'
}

interface Organization {
  org_uuid: string
}

interface Course {
  courseStructure: {
    course_uuid: string
  }
}

interface EditorState {
  isEditable: boolean
}

interface Session {
  data?: {
    tokens?: {
      access_token?: string
    }
  }
}

// Legacy interface for backward compatibility
interface LegacyVideoBlockObject {
  block_uuid: string
  content: {
    file_id: string
    file_format: string
    activity_uuid?: string
  }
  size?: {
    width?: number | string
  }
}

interface VideoBlockObject {
  block_uuid: string
  content: {
    file_id: string
    file_format: string
    activity_uuid?: string
  }
  size: VideoSize
}

interface ExtendedNodeViewProps extends Omit<NodeViewProps, 'extension'> {
  extension: Node & {
    options: {
      activity: {
        activity_uuid: string
      }
    }
  }
}

function VideoBlockComponent(props: ExtendedNodeViewProps) {
  const { t } = useTranslation()
  const { node, extension, updateAttributes } = props
  const org = useOrg() as Organization | null
  const course = useCourse() as Course | null
  const editorState = useEditorProvider() as EditorState
  const session = useLHSession() as Session
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const uploadZoneRef = React.useRef<HTMLDivElement>(null)

  // Convert legacy block object to new format
  const convertLegacyBlock = React.useCallback((block: LegacyVideoBlockObject): VideoBlockObject => {
    const videoSize = getVideoSizeFromWidth(block.size?.width)
    return {
      ...block,
      size: videoSize
    }
  }, [])

  const initialBlockObject = React.useMemo(() => {
    if (!node.attrs.blockObject) return null
    if ('size' in node.attrs.blockObject && typeof node.attrs.blockObject.size === 'string') {
      const block = node.attrs.blockObject as VideoBlockObject
      if ((block.size as string) === 'full') {
        return { ...block, size: 'large' as VideoSize }
      }
      return block
    }
    return convertLegacyBlock(node.attrs.blockObject as LegacyVideoBlockObject)
  }, [node.attrs.blockObject, convertLegacyBlock])

  const [video, setVideo] = React.useState<File | null>(null)
  const [isLoading, setIsLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [isDragging, setIsDragging] = React.useState(false)
  const [uploadProgress, setUploadProgress] = React.useState(0)
  const [blockObject, setBlockObject] = React.useState<VideoBlockObject | null>(initialBlockObject)
  const [selectedSize, setSelectedSize] = React.useState<VideoSize>(initialBlockObject?.size || 'medium')
  const [isModalOpen, setIsModalOpen] = React.useState(false)

  // Update block object when size changes
  React.useEffect(() => {
    if (blockObject && blockObject.size !== selectedSize) {
      const newBlockObject = {
        ...blockObject,
        size: selectedSize
      }
      setBlockObject(newBlockObject)
      updateAttributes({ blockObject: newBlockObject })
    }
  }, [selectedSize])

  const isEditable = editorState?.isEditable
  const access_token = session?.data?.tokens?.access_token
  const fileId = blockObject?.content?.file_id ? `${blockObject.content.file_id}.${blockObject.content.file_format}` : null

  const handleVideoChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) {
      setVideo(file)
      setError(null)
      handleUpload(file)
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
    if (e.currentTarget === uploadZoneRef.current) {
      setIsDragging(false)
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)

    const file = e.dataTransfer.files[0]
    const fileExtension = file?.name.split('.').pop()?.toLowerCase()

    if (file && fileExtension && ['mp4', 'webm'].includes(fileExtension)) {
      setVideo(file)
      setError(null)
      handleUpload(file)
    } else {
      setError('Please upload a supported video format (MP4 or WebM)')
    }
  }

  const handleUpload = async (file: File) => {
    if (!access_token) return

    try {
      setIsLoading(true)
      setError(null)
      setUploadProgress(0)

      const progressInterval = setInterval(() => {
        setUploadProgress(prev => Math.min(prev + 10, 90))
      }, 200)

      const object = await uploadNewVideoFile(
        file,
        extension.options.activity.activity_uuid,
        access_token
      )

      clearInterval(progressInterval)
      setUploadProgress(100)

      const newBlockObject = {
        ...object,
        size: selectedSize
      }
      setBlockObject(newBlockObject)
      updateAttributes({ blockObject: newBlockObject })
      setVideo(null)

      setTimeout(() => {
        setUploadProgress(0)
      }, 1000)
    } catch (err: any) {
      const errorMessage = err?.message || 'Failed to upload video. Please try again.'
      setError(errorMessage)
      toast.error(errorMessage)
    } finally {
      setIsLoading(false)
    }
  }

  const handleRemove = () => {
    setBlockObject(null)
    updateAttributes({ blockObject: null })
    setVideo(null)
    setError(null)
    setUploadProgress(0)
  }

  const handleSizeChange = (size: VideoSize) => {
    setSelectedSize(size)
  }

  const videoUrl = blockObject && org?.org_uuid && course?.courseStructure.course_uuid ? getVideoBlockStreamUrl(
    org.org_uuid,
    course.courseStructure.course_uuid,
    blockObject.content.activity_uuid || extension.options.activity.activity_uuid,
    blockObject.block_uuid,
    fileId || ''
  ) : null

  const handleExpand = () => {
    setIsModalOpen(true);
  };

  // If we're in preview mode and have a video, show only the video player
  if (!isEditable && blockObject && videoUrl) {
    const width = VIDEO_SIZES[blockObject.size].width
    return (
      <>
        <NodeViewWrapper className="block-video w-full">
          <div className="w-full flex justify-center relative">
            <div
              style={{
                maxWidth: typeof width === 'number' ? width : '100%',
                width: '100%'
              }}
            >
              <div className="relative group">
                <LearnHousePlayer src={videoUrl} />
                <div className="absolute top-2 right-2 z-40 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={handleExpand}
                    className="p-2 outline-none bg-black/50 hover:bg-black/70 rounded-lg transition-colors"
                    title={t('editor.blocks.video_block.expand_video')}
                  >
                    <Expand className="w-4 h-4 text-white" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </NodeViewWrapper>

        <Modal
          isDialogOpen={isModalOpen}
          onOpenChange={setIsModalOpen}
          dialogTitle={t('editor.blocks.video_block.player_title')}
          minWidth="lg"
          minHeight="lg"
          dialogContent={
            <div className="w-full">
              <LearnHousePlayer
                key={isModalOpen ? videoUrl : undefined}
                src={videoUrl}
                details={{ autoplay: true }}
              />
            </div>
          }
        />
      </>
    )
  }

  // If we're in preview mode but don't have a video, show nothing
  if (!isEditable && (!blockObject || !videoUrl)) {
    return null
  }

  // Show the full editor UI when in edit mode
  return (
    <NodeViewWrapper className="block-video w-full">
      <div className="bg-neutral-50 rounded-xl px-5 py-4 nice-shadow transition-all ease-linear">
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Video className="text-neutral-400" size={16} />
            <span className="uppercase tracking-widest text-xs font-bold text-neutral-400">
              {t('editor.blocks.video')}
            </span>
          </div>
          {blockObject && (
            <button
              onClick={handleRemove}
              className="text-neutral-400 hover:text-red-500 transition-colors"
            >
              <X size={16} />
            </button>
          )}
        </div>

        {/* Upload Zone */}
        {(!blockObject || !videoUrl) && (
          <div className="space-y-4">
            <input
              ref={fileInputRef}
              type="file"
              onChange={handleVideoChange}
              accept={SUPPORTED_FILES}
              className="hidden"
            />

            <div
              ref={uploadZoneRef}
              onClick={() => fileInputRef.current?.click()}
              onDragEnter={handleDragEnter}
              onDragOver={handleDragEnter}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={cn(
                "border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-all",
                isDragging
                  ? "border-blue-400 bg-blue-50"
                  : "border-neutral-200 bg-white hover:border-blue-400 hover:bg-blue-50/50"
              )}
            >
              {isLoading ? (
                <div className="space-y-3">
                  <Loader2 className="w-8 h-8 animate-spin mx-auto text-blue-500" />
                  <p className="text-sm text-neutral-600">{t('editor.blocks.video_block.uploading')} {uploadProgress}%</p>
                  <div className="w-48 h-1 bg-neutral-200 rounded-full mx-auto overflow-hidden">
                    <div
                      className="h-full bg-blue-500 rounded-full transition-all duration-200"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <Upload className="w-8 h-8 mx-auto text-neutral-400" />
                  <div>
                    <p className="text-sm font-medium text-neutral-700">
                      {t('editor.blocks.video_block.drop_or_browse')}
                    </p>
                    <p className="text-xs text-neutral-500 mt-1">
                      {t('editor.blocks.video_block.supported_formats')}
                    </p>
                  </div>
                </div>
              )}
            </div>

            {error && (
              <div className="flex items-center gap-2 text-sm text-red-500 font-medium bg-red-50 rounded-lg p-3">
                <AlertCircle size={16} />
                {error}
              </div>
            )}
          </div>
        )}

        {/* Video Preview with Controls */}
        {blockObject && videoUrl && (
          <div className="space-y-4">
            {/* Size Controls */}
            <div className="flex items-center gap-2 flex-wrap">
              <div className="text-sm text-neutral-500 font-medium flex items-center gap-1">
                <ArrowLeftRight size={14} />
                {t('editor.blocks.common.size')}:
              </div>
              {(Object.keys(VIDEO_SIZES) as VideoSize[]).map((size) => (
                <button
                  key={size}
                  onClick={() => handleSizeChange(size)}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors outline-none",
                    selectedSize === size
                      ? "bg-neutral-700 text-white"
                      : "bg-neutral-200 text-neutral-700 hover:bg-neutral-300"
                  )}
                >
                  {size === selectedSize && <CheckCircle2 size={14} />}
                  {t(`editor.blocks.common.${size}`)}
                </button>
              ))}
            </div>

            {/* Video Player */}
            <div className="flex justify-center">
              <div
                style={{
                  maxWidth: typeof VIDEO_SIZES[selectedSize].width === 'number'
                    ? VIDEO_SIZES[selectedSize].width
                    : '100%',
                  width: '100%'
                }}
              >
                <div className="relative rounded-lg overflow-hidden bg-black/5 nice-shadow">
                  {isLoading && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/10 backdrop-blur-sm">
                      <Loader2 className="w-8 h-8 animate-spin text-white" />
                    </div>
                  )}
                  <video
                    controls
                    preload="metadata"
                    className={cn(
                      "w-full aspect-video object-contain bg-black/95 transition-all duration-200",
                      isLoading && "opacity-50 blur-sm"
                    )}
                    src={videoUrl}
                  />
                  <div className="absolute top-2 right-2 flex gap-1">
                    <button
                      onClick={handleExpand}
                      className="p-2 outline-none bg-black/50 hover:bg-black/70 rounded-lg transition-colors"
                      title={t('editor.blocks.video_block.expand_video')}
                    >
                      <Expand className="w-4 h-4 text-white" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {blockObject && videoUrl && (
        <Modal
          isDialogOpen={isModalOpen}
          onOpenChange={setIsModalOpen}
          dialogTitle={t('editor.blocks.video_block.player_title')}
          minWidth="lg"
          minHeight="lg"
          dialogContent={
            <div className="w-full">
              <video
                key={isModalOpen ? videoUrl : undefined}
                controls
                autoPlay
                preload="metadata"
                className="w-full aspect-video object-contain rounded-lg shadow-lg bg-black"
                src={videoUrl}
              />
            </div>
          }
        />
      )}
    </NodeViewWrapper>
  )
}

export default VideoBlockComponent
