import { NodeViewProps, NodeViewWrapper } from '@tiptap/react'
import { Node } from '@tiptap/core'
import { 
  Loader2, Video, Upload, X, HelpCircle, 
  Maximize2, Minimize2, ArrowLeftRight, 
  CheckCircle2, AlertCircle, Download
} from 'lucide-react'
import React from 'react'
import { uploadNewVideoFile } from '../../../../../services/blocks/Video/video'
import { getActivityBlockMediaDirectory } from '@services/media/media'
import { useOrg } from '@components/Contexts/OrgContext'
import { useCourse } from '@components/Contexts/CourseContext'
import { useEditorProvider } from '@components/Contexts/Editor/EditorContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { constructAcceptValue } from '@/lib/constants'
import { cn } from '@/lib/utils'
import { motion, AnimatePresence } from 'framer-motion'
import styled from 'styled-components'

const SUPPORTED_FILES = constructAcceptValue(['webm', 'mp4'])

const VIDEO_SIZES = {
  small: { width: 480, label: 'Small' },
  medium: { width: 720, label: 'Medium' },
  large: { width: 960, label: 'Large' },
  full: { width: '100%', label: 'Full Width' }
} as const

type VideoSize = keyof typeof VIDEO_SIZES

// Helper function to determine video size from width
const getVideoSizeFromWidth = (width: number | string | undefined): VideoSize => {
  if (!width) return 'medium'
  if (width === '100%') return 'full'
  
  const numWidth = typeof width === 'string' ? parseInt(width) : width
  
  if (numWidth <= VIDEO_SIZES.small.width) return 'small'
  if (numWidth <= VIDEO_SIZES.medium.width) return 'medium'
  if (numWidth <= VIDEO_SIZES.large.width) return 'large'
  return 'full'
}

const VideoWrapper = styled.div`
  transition: all 0.2s ease;
  background-color: #f9f9f9;
  border: 1px solid #eaeaea;
`

const VideoContainer = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  width: 100%;
`

const UploadZone = styled(motion.div)<{ isDragging: boolean }>`
  border: 2px dashed ${props => props.isDragging ? '#3b82f6' : '#e5e7eb'};
  background: ${props => props.isDragging ? 'rgba(59, 130, 246, 0.05)' : '#ffffff'};
  transition: all 0.2s ease;
  border-radius: 0.75rem;
  padding: 2rem;
  text-align: center;
  cursor: pointer;

  &:hover {
    border-color: #3b82f6;
    background: rgba(59, 130, 246, 0.05);
  }
`

const SizeButton = styled(motion.button)<{ isActive: boolean }>`
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  border-radius: 0.375rem;
  font-size: 0.875rem;
  color: ${props => props.isActive ? '#ffffff' : '#4b5563'};
  background: ${props => props.isActive ? '#3b82f6' : 'transparent'};
  border: 1px solid ${props => props.isActive ? '#3b82f6' : '#e5e7eb'};
  transition: all 0.2s ease;

  &:hover {
    background: ${props => props.isActive ? '#2563eb' : '#f9fafb'};
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`

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
  }
  size: VideoSize
}

interface VideoBlockAttrs {
  blockObject: VideoBlockObject | LegacyVideoBlockObject | null
}

interface VideoBlockExtension {
  options: {
    activity: {
      activity_uuid: string
    }
  }
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
      return node.attrs.blockObject as VideoBlockObject
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
  const fileId = blockObject ? `${blockObject.content.file_id}.${blockObject.content.file_format}` : null

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

      // Simulate upload progress
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

      // Reset progress after a delay
      setTimeout(() => {
        setUploadProgress(0)
      }, 1000)
    } catch (err) {
      setError('Failed to upload video. Please try again.')
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

  const videoUrl = blockObject && org?.org_uuid && course?.courseStructure.course_uuid ? getActivityBlockMediaDirectory(
    org.org_uuid,
    course.courseStructure.course_uuid,
    extension.options.activity.activity_uuid,
    blockObject.block_uuid,
    fileId || '',
    'videoBlock'
  ) : null

  const handleDownload = () => {
    if (!videoUrl) return;
    
    // Create a temporary link element
    const link = document.createElement('a');
    link.href = videoUrl;
    link.download = `video-${blockObject?.block_uuid || 'download'}.${blockObject?.content.file_format || 'mp4'}`;
    link.setAttribute('download', '');
    link.setAttribute('target', '_blank');
    link.setAttribute('rel', 'noopener noreferrer');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // If we're in preview mode and have a video, show only the video player
  if (!isEditable && blockObject && videoUrl) {
    const width = VIDEO_SIZES[blockObject.size].width
    return (
      <NodeViewWrapper className="block-video w-full">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
          className="w-full flex justify-center relative"
        >
          <div
            style={{ 
              maxWidth: typeof width === 'number' ? width : '100%',
              width: '100%'
            }}
          >
            <div className="relative">
              <video
                controls
                className="w-full aspect-video object-contain rounded-lg shadow-sm"
                src={videoUrl}
              />
              <button
                onClick={handleDownload}
                className="absolute top-2 right-2 p-2 bg-black/50 hover:bg-black/70 rounded-full transition-colors"
                title="Download video"
              >
                <Download className="w-4 h-4 text-white" />
              </button>
            </div>
          </div>
        </motion.div>
      </NodeViewWrapper>
    )
  }

  // If we're in preview mode but don't have a video, show nothing
  if (!isEditable && (!blockObject || !videoUrl)) {
    return null
  }

  // Show the full editor UI when in edit mode
  return (
    <NodeViewWrapper className="block-video w-full">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <VideoWrapper className="flex flex-col space-y-4 rounded-lg py-6 px-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2 text-sm text-zinc-500">
              <Video size={16} />
              <span className="font-medium">Video Block</span>
            </div>
            {blockObject && (
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={handleRemove}
                className="text-zinc-400 hover:text-red-500 transition-colors"
              >
                <X size={16} />
              </motion.button>
            )}
          </div>

          {(!blockObject || !videoUrl) && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              transition={{ duration: 0.2 }}
              className="space-y-4"
            >
              <input
                ref={fileInputRef}
                type="file"
                onChange={handleVideoChange}
                accept={SUPPORTED_FILES}
                className="hidden"
              />

              <UploadZone
                ref={uploadZoneRef}
                isDragging={isDragging}
                onDragEnter={handleDragEnter}
                onDragOver={handleDragEnter}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className="relative"
              >
                <AnimatePresence>
                  {isLoading ? (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="space-y-3"
                    >
                      <Loader2 className="w-8 h-8 animate-spin mx-auto text-blue-500" />
                      <div className="text-sm text-zinc-600">Uploading video... {uploadProgress}%</div>
                      <div className="w-48 h-1 bg-gray-200 rounded-full mx-auto overflow-hidden">
                        <motion.div
                          className="h-full bg-blue-500 rounded-full"
                          initial={{ width: 0 }}
                          animate={{ width: `${uploadProgress}%` }}
                          transition={{ duration: 0.2 }}
                        />
                      </div>
                    </motion.div>
                  ) : (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="space-y-3"
                    >
                      <Upload className="w-8 h-8 mx-auto text-blue-500" />
                      <div>
                        <div className="text-sm font-medium text-zinc-700">
                          Drop your video here or click to browse
                        </div>
                        <div className="text-xs text-zinc-500 mt-1">
                          Supports MP4 and WebM formats
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </UploadZone>

              {error && (
                <div className="flex items-center gap-2 text-sm text-red-500 font-medium bg-red-50 rounded-lg p-3">
                  <AlertCircle size={16} />
                  {error}
                </div>
              )}
            </motion.div>
          )}

          {blockObject && videoUrl && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3 }}
              className="space-y-4"
            >
              <div className="flex items-center gap-2 flex-wrap">
                <div className="text-sm text-zinc-500 font-medium flex items-center gap-1">
                  <ArrowLeftRight size={14} />
                  Video Size:
                </div>
                {(Object.keys(VIDEO_SIZES) as VideoSize[]).map((size) => (
                  <SizeButton
                    key={size}
                    isActive={selectedSize === size}
                    onClick={() => handleSizeChange(size)}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    {size === selectedSize && <CheckCircle2 size={14} />}
                    {VIDEO_SIZES[size].label}
                  </SizeButton>
                ))}
                <SizeButton
                  isActive={false}
                  onClick={handleDownload}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  className="ml-auto"
                >
                  <Download size={14} />
                  Download
                </SizeButton>
              </div>

              <VideoContainer>
                <div
                  style={{ 
                    maxWidth: typeof VIDEO_SIZES[selectedSize].width === 'number' 
                      ? VIDEO_SIZES[selectedSize].width 
                      : '100%',
                    width: '100%'
                  }}
                >
                  <div className="relative rounded-lg overflow-hidden bg-black/5">
                    {isLoading && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/10 backdrop-blur-sm">
                        <Loader2 className="w-8 h-8 animate-spin text-white" />
                      </div>
                    )}
                    <video
                      controls
                      className={cn(
                        "w-full aspect-video object-contain bg-black/95 shadow-sm transition-all duration-200",
                        isLoading && "opacity-50 blur-sm"
                      )}
                      src={videoUrl}
                    />
                  </div>
                </div>
              </VideoContainer>
            </motion.div>
          )}
        </VideoWrapper>
      </motion.div>
    </NodeViewWrapper>
  )
}

export default VideoBlockComponent
