'use client'
import { constructAcceptValue } from '@/lib/constants'
import { cn } from '@/lib/utils'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { Button } from '@components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@components/ui/dialog'
import { Input } from '@components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@components/ui/tabs'
import {
  DragDropContext,
  Draggable,
  type DropResult,
  Droppable,
} from '@hello-pangea/dnd'
import { SiLoom, SiYoutube } from '@icons-pack/react-simple-icons'
import {
  getOrgLogoMediaDirectory,
  getOrgPreviewMediaDirectory,
  getOrgThumbnailMediaDirectory,
} from '@services/media/media'
import {
  updateOrganization,
  uploadOrganizationLogo,
  uploadOrganizationPreview,
  uploadOrganizationThumbnail,
} from '@services/settings/org'
import {
  GripVertical,
  ImageIcon,
  Images,
  Info,
  Plus,
  StarIcon,
  UploadCloud,
  X,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import type React from 'react'
import { useState } from 'react'
import { toast } from 'react-hot-toast'

const SUPPORTED_FILES = constructAcceptValue(['png', 'jpg'])

type Preview = {
  id: string
  url: string
  type: 'image' | 'youtube' | 'loom'
  filename?: string
  thumbnailUrl?: string
  order: number
}

// Update the height constant
const PREVIEW_HEIGHT = 'h-28' // Reduced height

// Add this type for the video service selection
type VideoService = 'youtube' | 'loom' | null

// Add this constant for consistent sizing
const DIALOG_ICON_SIZE = 'w-16 h-16'

// Add this constant at the top with other constants
const ADD_PREVIEW_OPTIONS = [
  {
    id: 'image',
    title: 'Upload Images',
    description: 'PNG, JPG (max 5MB)',
    icon: UploadCloud,
    color: 'blue',
    onClick: () => document.getElementById('previewInput')?.click(),
  },
  {
    id: 'youtube',
    title: 'YouTube',
    description: 'Add YouTube video',
    icon: SiYoutube,
    color: 'red',
    onClick: (setSelectedService: Function) => setSelectedService('youtube'),
  },
  {
    id: 'loom',
    title: 'Loom',
    description: 'Add Loom video',
    icon: SiLoom,
    color: 'blue',
    onClick: (setSelectedService: Function) => setSelectedService('loom'),
  },
] as const

export default function OrgEditImages() {
  const router = useRouter()
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const org = useOrg() as any
  const [localLogo, setLocalLogo] = useState<string | null>(null)
  const [localThumbnail, setLocalThumbnail] = useState<string | null>(null)
  const [isLogoUploading, setIsLogoUploading] = useState(false)
  const [isThumbnailUploading, setIsThumbnailUploading] = useState(false)
  const [previews, setPreviews] = useState<Preview[]>(() => {
    // Initialize with image previews
    const imagePreviews = (org?.previews?.images || [])
      .filter((item: any) => item?.filename) // Filter out empty filenames
      .map((item: any, index: number) => ({
        id: item.filename,
        url: getOrgThumbnailMediaDirectory(org?.org_uuid, item.filename),
        filename: item.filename,
        type: 'image' as const,
        order: item.order ?? index, // Use existing order or fallback to index
      }))

    // Initialize with video previews
    const videoPreviews = (org?.previews?.videos || [])
      .filter((video: any) => video && video.id)
      .map((video: any, index: number) => ({
        id: video.id,
        url: video.url,
        type: video.type as 'youtube' | 'loom',
        thumbnailUrl:
          video.type === 'youtube'
            ? `https://img.youtube.com/vi/${video.id}/maxresdefault.jpg`
            : '',
        filename: '',
        order: video.order ?? imagePreviews.length + index, // Use existing order or fallback to index after images
      }))

    const allPreviews = [...imagePreviews, ...videoPreviews]
    return allPreviews.sort((a, b) => a.order - b.order)
  })
  const [isPreviewUploading, setIsPreviewUploading] = useState(false)
  const [videoUrl, setVideoUrl] = useState('')
  const [videoDialogOpen, setVideoDialogOpen] = useState(false)
  const [selectedService, setSelectedService] = useState<VideoService>(null)

  const handleFileChange = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    if (event.target.files && event.target.files.length > 0) {
      const file = event.target.files[0]
      setLocalLogo(URL.createObjectURL(file))
      setIsLogoUploading(true)
      const loadingToast = toast.loading('Uploading logo...')
      try {
        await uploadOrganizationLogo(org.id, file, access_token)
        await new Promise((r) => setTimeout(r, 1500))
        toast.success('Logo Updated', { id: loadingToast })
        router.refresh()
      } catch (err) {
        toast.error('Failed to upload logo', { id: loadingToast })
      } finally {
        setIsLogoUploading(false)
      }
    }
  }

  const handleThumbnailChange = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    if (event.target.files && event.target.files.length > 0) {
      const file = event.target.files[0]
      setLocalThumbnail(URL.createObjectURL(file))
      setIsThumbnailUploading(true)
      const loadingToast = toast.loading('Uploading thumbnail...')
      try {
        await uploadOrganizationThumbnail(org.id, file, access_token)
        await new Promise((r) => setTimeout(r, 1500))
        toast.success('Thumbnail Updated', { id: loadingToast })
        router.refresh()
      } catch (err) {
        toast.error('Failed to upload thumbnail', { id: loadingToast })
      } finally {
        setIsThumbnailUploading(false)
      }
    }
  }

  const handleImageButtonClick =
    (inputId: string) => (event: React.MouseEvent) => {
      event.preventDefault()
      document.getElementById(inputId)?.click()
    }

  const handlePreviewUpload = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    if (event.target.files && event.target.files.length > 0) {
      const files = Array.from(event.target.files)
      const remainingSlots = 4 - previews.length

      if (files.length > remainingSlots) {
        toast.error(
          `You can only upload ${remainingSlots} more preview${remainingSlots === 1 ? '' : 's'}`
        )
        return
      }

      setIsPreviewUploading(true)
      const loadingToast = toast.loading(
        `Uploading ${files.length} preview${files.length === 1 ? '' : 's'}...`
      )

      try {
        const uploadPromises = files.map(async (file) => {
          const response = await uploadOrganizationPreview(
            org.id,
            file,
            access_token
          )
          return {
            id: response.name_in_disk,
            url: URL.createObjectURL(file),
            filename: response.name_in_disk,
            type: 'image' as const,
            order: previews.length, // Add new items at the end
          }
        })

        const newPreviews = await Promise.all(uploadPromises)
        const updatedPreviews = [...previews, ...newPreviews]

        await updateOrganization(
          org.id,
          {
            previews: {
              images: updatedPreviews
                .filter((p) => p.type === 'image')
                .map((p) => ({
                  filename: p.filename,
                  order: p.order,
                })),
              videos: updatedPreviews
                .filter((p) => p.type === 'youtube' || p.type === 'loom')
                .map((p) => ({
                  type: p.type,
                  url: p.url,
                  id: p.id,
                  order: p.order,
                })),
            },
          },
          access_token
        )

        setPreviews(updatedPreviews)
        toast.success(
          `${files.length} preview${files.length === 1 ? '' : 's'} added`,
          { id: loadingToast }
        )
        router.refresh()
      } catch (err) {
        toast.error('Failed to upload previews', { id: loadingToast })
      } finally {
        setIsPreviewUploading(false)
      }
    }
  }

  const removePreview = async (id: string) => {
    const loadingToast = toast.loading('Removing preview...')
    try {
      const updatedPreviews = previews.filter((p) => p.id !== id)
      const updatedPreviewFilenames = updatedPreviews.map((p) => p.filename)

      await updateOrganization(
        org.id,
        {
          previews: {
            images: updatedPreviewFilenames,
          },
        },
        access_token
      )

      setPreviews(updatedPreviews)
      toast.success('Preview removed', { id: loadingToast })
      router.refresh()
    } catch (err) {
      toast.error('Failed to remove preview', { id: loadingToast })
    }
  }

  const extractVideoId = (
    url: string,
    type: 'youtube' | 'loom'
  ): string | null => {
    if (type === 'youtube') {
      const regex =
        /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/
      const match = url.match(regex)
      return match ? match[1] : null
    } else if (type === 'loom') {
      const regex = /(?:loom\.com\/(?:share|embed)\/)([a-zA-Z0-9]+)/
      const match = url.match(regex)
      return match ? match[1] : null
    }
    return null
  }

  const handleVideoSubmit = async (type: 'youtube' | 'loom') => {
    const videoId = extractVideoId(videoUrl, type)
    if (!videoId) {
      toast.error(`Invalid ${type} URL`)
      return
    }

    // Check if video already exists
    if (previews.some((preview) => preview.id === videoId)) {
      toast.error('This video has already been added')
      return
    }

    const loadingToast = toast.loading('Adding video preview...')

    try {
      const thumbnailUrl =
        type === 'youtube'
          ? `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`
          : ''

      const newPreview: Preview = {
        id: videoId,
        url: videoUrl,
        type,
        thumbnailUrl,
        filename: '',
        order: previews.length, // Add new items at the end
      }

      const updatedPreviews = [...previews, newPreview]

      await updateOrganization(
        org.id,
        {
          previews: {
            images: updatedPreviews
              .filter((p) => p.type === 'image')
              .map((p) => ({
                filename: p.filename,
                order: p.order,
              })),
            videos: updatedPreviews
              .filter((p) => p.type === 'youtube' || p.type === 'loom')
              .map((p) => ({
                type: p.type,
                url: p.url,
                id: p.id,
                order: p.order,
              })),
          },
        },
        access_token
      )

      setPreviews(updatedPreviews)
      setVideoUrl('')
      setVideoDialogOpen(false)
      toast.success('Video preview added', { id: loadingToast })
      router.refresh()
    } catch (err) {
      toast.error('Failed to add video preview', { id: loadingToast })
    }
  }

  const handleDragEnd = async (result: DropResult) => {
    if (!result.destination) return

    const items = Array.from(previews)
    const [reorderedItem] = items.splice(result.source.index, 1)
    items.splice(result.destination.index, 0, reorderedItem)

    // Update order numbers
    const reorderedItems = items.map((item, index) => ({
      ...item,
      order: index,
    }))

    setPreviews(reorderedItems)

    // Update the order in the backend
    const loadingToast = toast.loading('Updating preview order...')
    try {
      await updateOrganization(
        org.id,
        {
          previews: {
            images: reorderedItems
              .filter((p) => p.type === 'image')
              .map((p) => ({
                filename: p.filename,
                order: p.order,
              })),
            videos: reorderedItems
              .filter((p) => p.type === 'youtube' || p.type === 'loom')
              .map((p) => ({
                type: p.type,
                url: p.url,
                id: p.id,
                order: p.order,
              })),
          },
        },
        access_token
      )

      toast.success('Preview order updated', { id: loadingToast })
      router.refresh()
    } catch (err) {
      toast.error('Failed to update preview order', { id: loadingToast })
      setPreviews(previews)
    }
  }

  // Add function to reset video dialog state
  const resetVideoDialog = () => {
    setSelectedService(null)
    setVideoUrl('')
  }

  return (
    <div className="nice-shadow mx-0 mb-16 rounded-xl bg-white px-3 py-3 sm:mx-10 sm:mb-0">
      <div className="mb-2 flex flex-col -space-y-1 rounded-md bg-gray-50 px-5 py-3">
        <h1 className="text-xl font-bold text-gray-800">Images & Previews</h1>
        <h2 className="text-md text-gray-500">
          Manage your organization's logo, thumbnail, and preview images
        </h2>
      </div>
      <Tabs defaultValue="logo" className="w-full">
        <TabsList className="grid w-full grid-cols-3 rounded-lg bg-gray-100 p-1">
          <TabsTrigger
            value="logo"
            className="flex items-center space-x-2 transition-all data-[state=active]:bg-white data-[state=active]:shadow-xs"
          >
            <StarIcon size={16} />
            <span>Logo</span>
          </TabsTrigger>
          <TabsTrigger
            value="thumbnail"
            className="flex items-center space-x-2 transition-all data-[state=active]:bg-white data-[state=active]:shadow-xs"
          >
            <ImageIcon size={16} />
            <span>Thumbnail</span>
          </TabsTrigger>
          <TabsTrigger
            value="previews"
            className="flex items-center space-x-2 transition-all data-[state=active]:bg-white data-[state=active]:shadow-xs"
          >
            <Images size={16} />
            <span>Previews</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="logo" className="mt-2">
          <div className="flex w-full flex-col space-y-5">
            <div className="w-full rounded-xl bg-linear-to-b from-gray-50 to-white py-8 transition-all duration-300">
              <div className="flex flex-col items-center justify-center space-y-8">
                <div className="group relative">
                  <div
                    className={cn(
                      'h-[100px] w-[200px] rounded-lg bg-white bg-contain bg-center bg-no-repeat shadow-md sm:h-[125px] sm:w-[250px]',
                      'border-2 border-gray-100 transition-all duration-300 hover:border-blue-200',
                      isLogoUploading && 'opacity-50'
                    )}
                    style={{
                      backgroundImage: `url(${localLogo || getOrgLogoMediaDirectory(org?.org_uuid, org?.logo_image)})`,
                    }}
                  />
                </div>

                <div className="flex flex-col items-center space-y-4">
                  <input
                    type="file"
                    id="fileInput"
                    accept={SUPPORTED_FILES}
                    className="hidden"
                    onChange={handleFileChange}
                  />
                  <button
                    type="button"
                    disabled={isLogoUploading}
                    className={cn(
                      'rounded-full px-6 py-2.5 text-sm font-medium',
                      'bg-linear-to-r from-blue-500 to-blue-600 text-white',
                      'hover:from-blue-600 hover:to-blue-700',
                      'shadow-xs transition-all duration-300 hover:shadow-sm',
                      'flex items-center space-x-2',
                      isLogoUploading && 'cursor-not-allowed opacity-75'
                    )}
                    onClick={handleImageButtonClick('fileInput')}
                  >
                    <UploadCloud
                      size={18}
                      className={cn('', isLogoUploading && 'animate-bounce')}
                    />
                    <span>
                      {isLogoUploading ? 'Uploading...' : 'Upload New Logo'}
                    </span>
                  </button>

                  <div className="flex flex-col items-center space-y-2 text-xs text-gray-500">
                    <div className="flex items-center space-x-2 rounded-full bg-blue-50 px-3 py-1.5 text-blue-700">
                      <Info size={14} />
                      <p className="font-medium">Accepts PNG, JPG (max 5MB)</p>
                    </div>
                    <p className="text-gray-400">
                      Recommended size: 200x100 pixels
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="thumbnail" className="mt-2">
          <div className="flex w-full flex-col space-y-5">
            <div className="w-full rounded-xl bg-linear-to-b from-gray-50 to-white py-8 transition-all duration-300">
              <div className="flex flex-col items-center justify-center space-y-8">
                <div className="group relative">
                  <div
                    className={cn(
                      'h-[100px] w-[200px] rounded-lg bg-white bg-contain bg-center bg-no-repeat shadow-md sm:h-[125px] sm:w-[250px]',
                      'border-2 border-gray-100 transition-all duration-300 hover:border-purple-200',
                      isThumbnailUploading && 'opacity-50'
                    )}
                    style={{
                      backgroundImage: `url(${localThumbnail || getOrgThumbnailMediaDirectory(org?.org_uuid, org?.thumbnail_image)})`,
                    }}
                  />
                </div>

                <div className="flex flex-col items-center space-y-4">
                  <input
                    type="file"
                    id="thumbnailInput"
                    accept={SUPPORTED_FILES}
                    className="hidden"
                    onChange={handleThumbnailChange}
                  />
                  <button
                    type="button"
                    disabled={isThumbnailUploading}
                    className={cn(
                      'rounded-full px-6 py-2.5 text-sm font-medium',
                      'bg-linear-to-r from-purple-500 to-purple-600 text-white',
                      'hover:from-purple-600 hover:to-purple-700',
                      'shadow-xs transition-all duration-300 hover:shadow-sm',
                      'flex items-center space-x-2',
                      isThumbnailUploading && 'cursor-not-allowed opacity-75'
                    )}
                    onClick={handleImageButtonClick('thumbnailInput')}
                  >
                    <UploadCloud
                      size={18}
                      className={cn(
                        '',
                        isThumbnailUploading && 'animate-bounce'
                      )}
                    />
                    <span>
                      {isThumbnailUploading
                        ? 'Uploading...'
                        : 'Upload New Thumbnail'}
                    </span>
                  </button>

                  <div className="flex flex-col items-center space-y-2 text-xs text-gray-500">
                    <div className="flex items-center space-x-2 rounded-full bg-purple-50 px-3 py-1.5 text-purple-700">
                      <Info size={14} />
                      <p className="font-medium">Accepts PNG, JPG (max 5MB)</p>
                    </div>
                    <p className="text-gray-400">
                      Recommended size: 200x100 pixels
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="previews" className="mt-4">
          <div className="flex w-full flex-col space-y-5">
            <div className="w-full rounded-xl bg-linear-to-b from-gray-50 to-white py-6 transition-all duration-300">
              <div className="flex flex-col items-center justify-center space-y-6">
                <DragDropContext onDragEnd={handleDragEnd}>
                  <Droppable droppableId="previews" direction="horizontal">
                    {(provided) => (
                      <div
                        className={cn(
                          'flex w-full max-w-5xl gap-4 overflow-x-auto p-4 pb-6',
                          previews.length === 0 && 'justify-center'
                        )}
                        {...provided.droppableProps}
                        ref={provided.innerRef}
                      >
                        {previews.map((preview, index) => (
                          <Draggable
                            key={preview.id}
                            draggableId={preview.id}
                            index={index}
                          >
                            {(provided, snapshot) => (
                              <div
                                ref={provided.innerRef}
                                {...provided.draggableProps}
                                className={cn(
                                  'group relative shrink-0',
                                  'w-48',
                                  snapshot.isDragging
                                    ? 'z-50 scale-105'
                                    : 'hover:scale-102'
                                )}
                              >
                                <button
                                  onClick={() => removePreview(preview.id)}
                                  className={cn(
                                    'absolute -top-2 -right-2 rounded-full bg-red-500 p-1.5 text-white hover:bg-red-600',
                                    'z-10 opacity-0 shadow-xs group-hover:opacity-100',
                                    'transition-opacity duration-200'
                                  )}
                                >
                                  <X size={14} />
                                </button>
                                <div
                                  {...provided.dragHandleProps}
                                  className={cn(
                                    'absolute -top-2 -left-2 rounded-full bg-gray-600 p-1.5 text-white hover:bg-gray-700',
                                    'z-10 cursor-grab opacity-0 shadow-xs group-hover:opacity-100 active:cursor-grabbing',
                                    'transition-opacity duration-200'
                                  )}
                                >
                                  <GripVertical size={14} />
                                </div>
                                {preview.type === 'image' ? (
                                  <div
                                    className={cn(
                                      `w-full ${PREVIEW_HEIGHT} rounded-xl bg-white bg-contain bg-center bg-no-repeat`,
                                      'border border-gray-200 hover:border-gray-300',
                                      'transition-colors duration-200',
                                      snapshot.isDragging
                                        ? 'shadow-lg'
                                        : 'shadow-xs hover:shadow-md'
                                    )}
                                    style={{
                                      backgroundImage: `url(${getOrgPreviewMediaDirectory(org?.org_uuid, preview.id)})`,
                                    }}
                                  />
                                ) : (
                                  <div
                                    className={cn(
                                      `w-full ${PREVIEW_HEIGHT} relative overflow-hidden rounded-xl`,
                                      'border border-gray-200 transition-colors duration-200 hover:border-gray-300',
                                      snapshot.isDragging
                                        ? 'shadow-lg'
                                        : 'shadow-xs hover:shadow-md'
                                    )}
                                  >
                                    <div
                                      className="absolute inset-0 bg-cover bg-center"
                                      style={{
                                        backgroundImage: `url(${preview.thumbnailUrl})`,
                                      }}
                                    />
                                    <div className="bg-opacity-40 absolute inset-0 flex items-center justify-center bg-black backdrop-blur-[2px]">
                                      {preview.type === 'youtube' ? (
                                        <SiYoutube className="h-10 w-10 text-red-500" />
                                      ) : (
                                        <SiLoom className="h-10 w-10 text-blue-500" />
                                      )}
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
                          </Draggable>
                        ))}
                        {provided.placeholder}
                        {previews.length < 4 && (
                          <div
                            className={cn(
                              'w-48 shrink-0',
                              previews.length === 0 && 'm-0'
                            )}
                          >
                            <Dialog
                              open={videoDialogOpen}
                              onOpenChange={(open) => {
                                setVideoDialogOpen(open)
                                if (!open) resetVideoDialog()
                              }}
                            >
                              <DialogTrigger asChild>
                                <button
                                  className={cn(
                                    `w-full ${PREVIEW_HEIGHT}`,
                                    'rounded-xl border-2 border-dashed border-gray-200',
                                    'transition-all duration-200 hover:border-blue-300 hover:bg-blue-50/50',
                                    'group flex flex-col items-center justify-center space-y-2'
                                  )}
                                >
                                  <div className="rounded-full bg-blue-50 p-2 transition-colors duration-200 group-hover:bg-blue-100">
                                    <Plus size={20} className="text-blue-500" />
                                  </div>
                                  <span className="text-sm font-medium text-gray-600">
                                    Add Preview
                                  </span>
                                </button>
                              </DialogTrigger>
                              <DialogContent className="sm:max-w-[600px]">
                                <DialogHeader>
                                  <DialogTitle>Add Preview</DialogTitle>
                                </DialogHeader>
                                <div
                                  className={cn(
                                    'p-6',
                                    selectedService
                                      ? 'space-y-4'
                                      : 'grid grid-cols-3 gap-6'
                                  )}
                                >
                                  {!selectedService ? (
                                    <>
                                      {ADD_PREVIEW_OPTIONS.map((option) => (
                                        <button
                                          key={option.id}
                                          onClick={() =>
                                            option.id === 'image'
                                              ? option.onClick()
                                              : option.onClick(
                                                  setSelectedService
                                                )
                                          }
                                          className={cn(
                                            'aspect-square w-full rounded-2xl border-2 border-dashed',
                                            `hover:border-${option.color}-300 hover:bg-${option.color}-50/50`,
                                            'transition-all duration-200',
                                            'flex flex-col items-center justify-center space-y-4',
                                            option.id === 'image' &&
                                              isPreviewUploading &&
                                              'cursor-not-allowed opacity-50'
                                          )}
                                        >
                                          <div
                                            className={cn(
                                              DIALOG_ICON_SIZE,
                                              `rounded-full bg-${option.color}-50`,
                                              'flex items-center justify-center'
                                            )}
                                          >
                                            <option.icon
                                              className={`h-8 w-8 text-${option.color}-500`}
                                            />
                                          </div>
                                          <div className="text-center">
                                            <p className="font-medium text-gray-700">
                                              {option.title}
                                            </p>
                                            <p className="mt-1 text-sm text-gray-500">
                                              {option.description}
                                            </p>
                                          </div>
                                        </button>
                                      ))}
                                      <input
                                        type="file"
                                        id="previewInput"
                                        accept={SUPPORTED_FILES}
                                        className="hidden"
                                        onChange={handlePreviewUpload}
                                        multiple
                                      />
                                    </>
                                  ) : (
                                    <div className="space-y-4">
                                      <div className="flex items-center justify-between">
                                        <div className="flex items-center space-x-3">
                                          <div
                                            className={cn(
                                              'flex h-10 w-10 items-center justify-center rounded-full',
                                              selectedService === 'youtube'
                                                ? 'bg-red-50'
                                                : 'bg-blue-50'
                                            )}
                                          >
                                            {selectedService === 'youtube' ? (
                                              <SiYoutube className="h-5 w-5 text-red-500" />
                                            ) : (
                                              <SiLoom className="h-5 w-5 text-blue-500" />
                                            )}
                                          </div>
                                          <div>
                                            <h3 className="font-medium text-gray-900">
                                              {selectedService === 'youtube'
                                                ? 'Add YouTube Video'
                                                : 'Add Loom Video'}
                                            </h3>
                                            <p className="text-sm text-gray-500">
                                              {selectedService === 'youtube'
                                                ? 'Paste your YouTube video URL'
                                                : 'Paste your Loom video URL'}
                                            </p>
                                          </div>
                                        </div>
                                        <button
                                          onClick={() =>
                                            setSelectedService(null)
                                          }
                                          className="text-gray-400 transition-colors hover:text-gray-500"
                                        >
                                          <X size={20} />
                                        </button>
                                      </div>

                                      <div className="space-y-3">
                                        <Input
                                          id="videoUrlInput"
                                          placeholder={
                                            selectedService === 'youtube'
                                              ? 'https://youtube.com/watch?v=...'
                                              : 'https://www.loom.com/share/...'
                                          }
                                          value={videoUrl}
                                          onChange={(e) =>
                                            setVideoUrl(e.target.value)
                                          }
                                          className="w-full"
                                          autoFocus
                                        />
                                        <Button
                                          onClick={() =>
                                            handleVideoSubmit(selectedService)
                                          }
                                          className={cn(
                                            'w-full',
                                            selectedService === 'youtube'
                                              ? 'bg-red-500 hover:bg-red-600'
                                              : 'bg-blue-500 hover:bg-blue-600'
                                          )}
                                          disabled={!videoUrl}
                                        >
                                          Add Video
                                        </Button>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </DialogContent>
                            </Dialog>
                          </div>
                        )}
                      </div>
                    )}
                  </Droppable>
                </DragDropContext>

                <div className="flex items-center space-x-2 rounded-full bg-gray-50 px-4 py-2 text-gray-600">
                  <Info size={14} />
                  <p className="text-sm">
                    Drag to reorder • Maximum 4 previews • Supports images &
                    videos
                  </p>
                </div>
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
