'use client'
import React, { useState } from 'react'
import { UploadCloud, Info, Plus, X, Video, GripVertical, Image, Layout, Images, StarIcon, ImageIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getOrgLogoMediaDirectory, getOrgPreviewMediaDirectory, getOrgThumbnailMediaDirectory } from '@services/media/media'
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@components/ui/tabs"
import { toast } from 'react-hot-toast'
import { constructAcceptValue } from '@/lib/constants'
import { uploadOrganizationLogo, uploadOrganizationThumbnail, uploadOrganizationPreview, updateOrganization } from '@services/settings/org'
import { cn } from '@/lib/utils'
import { Input } from "@components/ui/input"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@components/ui/dialog"
import { Button } from "@components/ui/button"
import { Label } from "@components/ui/label"
import { SiLoom, SiYoutube } from '@icons-pack/react-simple-icons'
import { DragDropContext, Droppable, Draggable, DropResult } from 'react-beautiful-dnd'

const SUPPORTED_FILES = constructAcceptValue(['png', 'jpg'])

type Preview = {
  id: string;
  url: string;
  type: 'image' | 'youtube' | 'loom';
  filename?: string;
  thumbnailUrl?: string;
  order: number;
};

// Update the height constant
const PREVIEW_HEIGHT = 'h-28' // Reduced height

// Add this type for the video service selection
type VideoService = 'youtube' | 'loom' | null;

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
    onClick: () => document.getElementById('previewInput')?.click()
  },
  {
    id: 'youtube',
    title: 'YouTube',
    description: 'Add YouTube video',
    icon: SiYoutube,
    color: 'red',
    onClick: (setSelectedService: Function) => setSelectedService('youtube')
  },
  {
    id: 'loom',
    title: 'Loom',
    description: 'Add Loom video',
    icon: SiLoom,
    color: 'blue',
    onClick: (setSelectedService: Function) => setSelectedService('loom')
  }
] as const;

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
        order: item.order ?? index // Use existing order or fallback to index
      }));

    // Initialize with video previews
    const videoPreviews = (org?.previews?.videos || [])
      .filter((video: any) => video && video.id)
      .map((video: any, index: number) => ({
        id: video.id,
        url: video.url,
        type: video.type as 'youtube' | 'loom',
        thumbnailUrl: video.type === 'youtube' 
          ? `https://img.youtube.com/vi/${video.id}/maxresdefault.jpg`
          : '',
        filename: '',
        order: video.order ?? (imagePreviews.length + index) // Use existing order or fallback to index after images
      }));

    const allPreviews = [...imagePreviews, ...videoPreviews];
    return allPreviews.sort((a, b) => a.order - b.order);
  });
  const [isPreviewUploading, setIsPreviewUploading] = useState(false)
  const [videoUrl, setVideoUrl] = useState('')
  const [videoDialogOpen, setVideoDialogOpen] = useState(false)
  const [selectedService, setSelectedService] = useState<VideoService>(null)

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
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

  const handleThumbnailChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
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

  const handleImageButtonClick = (inputId: string) => (event: React.MouseEvent) => {
    event.preventDefault()
    document.getElementById(inputId)?.click()
  }

  const handlePreviewUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files.length > 0) {
      const files = Array.from(event.target.files)
      const remainingSlots = 4 - previews.length
      
      if (files.length > remainingSlots) {
        toast.error(`You can only upload ${remainingSlots} more preview${remainingSlots === 1 ? '' : 's'}`)
        return
      }

      setIsPreviewUploading(true)
      const loadingToast = toast.loading(`Uploading ${files.length} preview${files.length === 1 ? '' : 's'}...`)
      
      try {
        const uploadPromises = files.map(async (file) => {
          const response = await uploadOrganizationPreview(org.id, file, access_token)
          return {
            id: response.name_in_disk,
            url: URL.createObjectURL(file),
            filename: response.name_in_disk,
            type: 'image' as const,
            order: previews.length // Add new items at the end
          }
        })

        const newPreviews = await Promise.all(uploadPromises)
        const updatedPreviews = [...previews, ...newPreviews]
        
        await updateOrganization(org.id, {
          previews: {
            images: updatedPreviews
              .filter(p => p.type === 'image')
              .map(p => ({ 
                filename: p.filename,
                order: p.order 
              })),
            videos: updatedPreviews
              .filter(p => p.type === 'youtube' || p.type === 'loom')
              .map(p => ({ 
                type: p.type, 
                url: p.url, 
                id: p.id,
                order: p.order 
              }))
          }
        }, access_token)

        setPreviews(updatedPreviews)
        toast.success(`${files.length} preview${files.length === 1 ? '' : 's'} added`, { id: loadingToast })
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
      const updatedPreviews = previews.filter(p => p.id !== id)
      const updatedPreviewFilenames = updatedPreviews.map(p => p.filename)

      await updateOrganization(org.id, {
        previews: {
          images: updatedPreviewFilenames
        }
      }, access_token)

      setPreviews(updatedPreviews)
      toast.success('Preview removed', { id: loadingToast })
      router.refresh()
    } catch (err) {
      toast.error('Failed to remove preview', { id: loadingToast })
    }
  }

  const extractVideoId = (url: string, type: 'youtube' | 'loom'): string | null => {
    if (type === 'youtube') {
      const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/
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
    const videoId = extractVideoId(videoUrl, type);
    if (!videoId) {
      toast.error(`Invalid ${type} URL`);
      return;
    }

    // Check if video already exists
    if (previews.some(preview => preview.id === videoId)) {
      toast.error('This video has already been added');
      return;
    }

    const loadingToast = toast.loading('Adding video preview...');
    
    try {
      const thumbnailUrl = type === 'youtube' 
        ? `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`
        : '';

      const newPreview: Preview = {
        id: videoId,
        url: videoUrl,
        type,
        thumbnailUrl,
        filename: '',
        order: previews.length // Add new items at the end
      };

      const updatedPreviews = [...previews, newPreview];
      
      await updateOrganization(org.id, {
        previews: {
          images: updatedPreviews
            .filter(p => p.type === 'image')
            .map(p => ({ 
              filename: p.filename,
              order: p.order 
            })),
          videos: updatedPreviews
            .filter(p => p.type === 'youtube' || p.type === 'loom')
            .map(p => ({ 
              type: p.type, 
              url: p.url, 
              id: p.id,
              order: p.order 
            }))
        }
      }, access_token);

      setPreviews(updatedPreviews);
      setVideoUrl('');
      setVideoDialogOpen(false);
      toast.success('Video preview added', { id: loadingToast });
      router.refresh();
    } catch (err) {
      toast.error('Failed to add video preview', { id: loadingToast });
    }
  };

  const handleDragEnd = async (result: DropResult) => {
    if (!result.destination) return;

    const items = Array.from(previews);
    const [reorderedItem] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reorderedItem);

    // Update order numbers
    const reorderedItems = items.map((item, index) => ({
      ...item,
      order: index
    }));

    setPreviews(reorderedItems);

    // Update the order in the backend
    const loadingToast = toast.loading('Updating preview order...');
    try {
      await updateOrganization(org.id, {
        previews: {
          images: reorderedItems
            .filter(p => p.type === 'image')
            .map(p => ({ 
              filename: p.filename,
              order: p.order 
            })),
          videos: reorderedItems
            .filter(p => p.type === 'youtube' || p.type === 'loom')
            .map(p => ({ 
              type: p.type, 
              url: p.url, 
              id: p.id,
              order: p.order 
            }))
        }
      }, access_token);
      
      toast.success('Preview order updated', { id: loadingToast });
      router.refresh();
    } catch (err) {
      toast.error('Failed to update preview order', { id: loadingToast });
      setPreviews(previews);
    }
  };

  // Add function to reset video dialog state
  const resetVideoDialog = () => {
    setSelectedService(null)
    setVideoUrl('')
  }

  return (
    <div className="sm:mx-10 mx-0 bg-white rounded-xl nice-shadow px-3 py-3 sm:mb-0 mb-16">
      <div className="flex flex-col bg-gray-50 -space-y-1 px-5 py-3 mb-2 rounded-md">
        <h1 className="font-bold text-xl text-gray-800">
          Images & Previews
        </h1>
        <h2 className="text-gray-500 text-md">
          Manage your organization's logo, thumbnail, and preview images
        </h2>
      </div>
      <Tabs defaultValue="logo" className="w-full">
        <TabsList className="grid w-full grid-cols-3 p-1 bg-gray-100 rounded-lg">
          <TabsTrigger 
            value="logo" 
            className="data-[state=active]:bg-white data-[state=active]:shadow-sm transition-all flex items-center space-x-2"
          >
            <StarIcon size={16} />
            <span>Logo</span>
          </TabsTrigger>
          <TabsTrigger 
            value="thumbnail"
            className="data-[state=active]:bg-white data-[state=active]:shadow-sm transition-all flex items-center space-x-2"
          >
            <ImageIcon size={16} />
            <span>Thumbnail</span>
          </TabsTrigger>
          <TabsTrigger 
            value="previews"
            className="data-[state=active]:bg-white data-[state=active]:shadow-sm transition-all flex items-center space-x-2"
          >
            <Images size={16} />
            <span>Previews</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="logo" className="mt-2">
          <div className="flex flex-col space-y-5 w-full">
            <div className="w-full bg-gradient-to-b from-gray-50 to-white rounded-xl  transition-all duration-300 py-8">
              <div className="flex flex-col justify-center items-center space-y-8">
                <div className="relative group">
                  <div
                    className={cn(
                      "w-[200px] sm:w-[250px] h-[100px] sm:h-[125px] bg-contain bg-no-repeat bg-center rounded-lg shadow-md bg-white",
                      "border-2 border-gray-100 hover:border-blue-200 transition-all duration-300",
                      isLogoUploading && "opacity-50"
                    )}
                    style={{ backgroundImage: `url(${localLogo || getOrgLogoMediaDirectory(org?.org_uuid, org?.logo_image)})` }}
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
                      "font-medium text-sm px-6 py-2.5 rounded-full",
                      "bg-gradient-to-r from-blue-500 to-blue-600 text-white",
                      "hover:from-blue-600 hover:to-blue-700",
                      "shadow-sm hover:shadow transition-all duration-300",
                      "flex items-center space-x-2",
                      isLogoUploading && "opacity-75 cursor-not-allowed"
                    )}
                    onClick={handleImageButtonClick('fileInput')}
                  >
                    <UploadCloud size={18} className={cn("", isLogoUploading && "animate-bounce")} />
                    <span>{isLogoUploading ? 'Uploading...' : 'Upload New Logo'}</span>
                  </button>

                  <div className="flex flex-col text-xs space-y-2 items-center text-gray-500">
                    <div className="flex items-center space-x-2 bg-blue-50 text-blue-700 px-3 py-1.5 rounded-full">
                      <Info size={14} />
                      <p className="font-medium">Accepts PNG, JPG (max 5MB)</p>
                    </div>
                    <p className="text-gray-400">Recommended size: 200x100 pixels</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="thumbnail" className="mt-2">
          <div className="flex flex-col space-y-5 w-full">
            <div className="w-full bg-gradient-to-b from-gray-50 to-white rounded-xl  transition-all duration-300 py-8">
              <div className="flex flex-col justify-center items-center space-y-8">
                <div className="relative group">
                  <div
                    className={cn(
                      "w-[200px] sm:w-[250px] h-[100px] sm:h-[125px] bg-contain bg-no-repeat bg-center rounded-lg shadow-md bg-white",
                      "border-2 border-gray-100 hover:border-purple-200 transition-all duration-300",
                      isThumbnailUploading && "opacity-50"
                    )}
                    style={{ backgroundImage: `url(${localThumbnail || getOrgThumbnailMediaDirectory(org?.org_uuid, org?.thumbnail_image)})` }}
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
                      "font-medium text-sm px-6 py-2.5 rounded-full",
                      "bg-gradient-to-r from-purple-500 to-purple-600 text-white",
                      "hover:from-purple-600 hover:to-purple-700",
                      "shadow-sm hover:shadow transition-all duration-300",
                      "flex items-center space-x-2",
                      isThumbnailUploading && "opacity-75 cursor-not-allowed"
                    )}
                    onClick={handleImageButtonClick('thumbnailInput')}
                  >
                    <UploadCloud size={18} className={cn("", isThumbnailUploading && "animate-bounce")} />
                    <span>{isThumbnailUploading ? 'Uploading...' : 'Upload New Thumbnail'}</span>
                  </button>

                  <div className="flex flex-col text-xs space-y-2 items-center text-gray-500">
                    <div className="flex items-center space-x-2 bg-purple-50 text-purple-700 px-3 py-1.5 rounded-full">
                      <Info size={14} />
                      <p className="font-medium">Accepts PNG, JPG (max 5MB)</p>
                    </div>
                    <p className="text-gray-400">Recommended size: 200x100 pixels</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="previews" className="mt-4">
          <div className="flex flex-col space-y-5 w-full">
            <div className="w-full bg-gradient-to-b from-gray-50 to-white rounded-xl transition-all duration-300 py-6">
              <div className="flex flex-col justify-center items-center space-y-6">
                <DragDropContext onDragEnd={handleDragEnd}>
                  <Droppable droppableId="previews" direction="horizontal">
                    {(provided) => (
                      <div 
                        className={cn(
                          "flex gap-4 w-full max-w-5xl p-4 overflow-x-auto pb-6",
                          previews.length === 0 && "justify-center"
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
                                  "relative group flex-shrink-0",
                                  "w-48",
                                  snapshot.isDragging ? "scale-105 z-50" : "hover:scale-102",
                                )}
                              >
                                <button
                                  onClick={() => removePreview(preview.id)}
                                  className={cn(
                                    "absolute -top-2 -right-2 bg-red-500 hover:bg-red-600 text-white rounded-full p-1.5",
                                    "opacity-0 group-hover:opacity-100 z-10 shadow-sm",
                                    "transition-opacity duration-200"
                                  )}
                                >
                                  <X size={14} />
                                </button>
                                <div
                                  {...provided.dragHandleProps}
                                  className={cn(
                                    "absolute -top-2 -left-2 bg-gray-600 hover:bg-gray-700 text-white rounded-full p-1.5",
                                    "opacity-0 group-hover:opacity-100 cursor-grab active:cursor-grabbing z-10 shadow-sm",
                                    "transition-opacity duration-200"
                                  )}
                                >
                                  <GripVertical size={14} />
                                </div>
                                {preview.type === 'image' ? (
                                  <div
                                    className={cn(
                                      `w-full ${PREVIEW_HEIGHT} bg-contain bg-no-repeat bg-center rounded-xl bg-white`,
                                      "border border-gray-200 hover:border-gray-300",
                                      "transition-colors duration-200",
                                      snapshot.isDragging ? "shadow-lg" : "shadow-sm hover:shadow-md"
                                    )}
                                    style={{ 
                                      backgroundImage: `url(${getOrgPreviewMediaDirectory(org?.org_uuid, preview.id)})`,
                                    }}
                                  />
                                ) : (
                                  <div className={cn(
                                    `w-full ${PREVIEW_HEIGHT} relative rounded-xl overflow-hidden`,
                                    "border border-gray-200 hover:border-gray-300 transition-colors duration-200",
                                    snapshot.isDragging ? "shadow-lg" : "shadow-sm hover:shadow-md"
                                  )}>
                                    <div
                                      className="absolute inset-0 bg-cover bg-center"
                                      style={{ backgroundImage: `url(${preview.thumbnailUrl})` }}
                                    />
                                    <div className="absolute inset-0 bg-black bg-opacity-40 backdrop-blur-[2px] flex items-center justify-center">
                                      {preview.type === 'youtube' ? (
                                        <SiYoutube className="w-10 h-10 text-red-500" />
                                      ) : (
                                        <SiLoom className="w-10 h-10 text-blue-500" />
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
                          <div className={cn(
                            "flex-shrink-0 w-48",
                            previews.length === 0 && "m-0"
                          )}>
                            <Dialog open={videoDialogOpen} onOpenChange={(open) => {
                              setVideoDialogOpen(open);
                              if (!open) resetVideoDialog();
                            }}>
                              <DialogTrigger asChild>
                                <button
                                  className={cn(
                                    `w-full ${PREVIEW_HEIGHT}`,
                                    "border-2 border-dashed border-gray-200 rounded-xl",
                                    "hover:border-blue-300 hover:bg-blue-50/50 transition-all duration-200",
                                    "flex flex-col items-center justify-center space-y-2 group"
                                  )}
                                >
                                  <div className="bg-blue-50 rounded-full p-2 group-hover:bg-blue-100 transition-colors duration-200">
                                    <Plus size={20} className="text-blue-500" />
                                  </div>
                                  <span className="text-sm font-medium text-gray-600">Add Preview</span>
                                </button>
                              </DialogTrigger>
                              <DialogContent className="sm:max-w-[600px]">
                                <DialogHeader>
                                  <DialogTitle>Add Preview</DialogTitle>
                                </DialogHeader>
                                <div className={cn(
                                  "p-6",
                                  selectedService ? "space-y-4" : "grid grid-cols-3 gap-6"
                                )}>
                                  {!selectedService ? (
                                    <>
                                      {ADD_PREVIEW_OPTIONS.map((option) => (
                                        <button
                                          key={option.id}
                                          onClick={() => option.id === 'image' 
                                            ? option.onClick()
                                            : option.onClick(setSelectedService)
                                          }
                                          className={cn(
                                            "w-full aspect-square rounded-2xl border-2 border-dashed",
                                            `hover:border-${option.color}-300 hover:bg-${option.color}-50/50`,
                                            "transition-all duration-200",
                                            "flex flex-col items-center justify-center space-y-4",
                                            option.id === 'image' && isPreviewUploading && "opacity-50 cursor-not-allowed"
                                          )}
                                        >
                                          <div className={cn(
                                            DIALOG_ICON_SIZE,
                                            `rounded-full bg-${option.color}-50`,
                                            "flex items-center justify-center"
                                          )}>
                                            <option.icon className={`w-8 h-8 text-${option.color}-500`} />
                                          </div>
                                          <div className="text-center">
                                            <p className="font-medium text-gray-700">{option.title}</p>
                                            <p className="text-sm text-gray-500 mt-1">{option.description}</p>
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
                                          <div className={cn(
                                            "w-10 h-10 rounded-full flex items-center justify-center",
                                            selectedService === 'youtube' ? "bg-red-50" : "bg-blue-50"
                                          )}>
                                            {selectedService === 'youtube' ? (
                                              <SiYoutube className="w-5 h-5 text-red-500" />
                                            ) : (
                                              <SiLoom className="w-5 h-5 text-blue-500" />
                                            )}
                                          </div>
                                          <div>
                                            <h3 className="font-medium text-gray-900">
                                              {selectedService === 'youtube' ? 'Add YouTube Video' : 'Add Loom Video'}
                                            </h3>
                                            <p className="text-sm text-gray-500">
                                              {selectedService === 'youtube' 
                                                ? 'Paste your YouTube video URL' 
                                                : 'Paste your Loom video URL'}
                                            </p>
                                          </div>
                                        </div>
                                        <button
                                          onClick={() => setSelectedService(null)}
                                          className="text-gray-400 hover:text-gray-500 transition-colors"
                                        >
                                          <X size={20} />
                                        </button>
                                      </div>

                                      <div className="space-y-3">
                                        <Input
                                          id="videoUrlInput"
                                          placeholder={selectedService === 'youtube' 
                                            ? 'https://youtube.com/watch?v=...' 
                                            : 'https://www.loom.com/share/...'}
                                          value={videoUrl}
                                          onChange={(e) => setVideoUrl(e.target.value)}
                                          className="w-full"
                                          autoFocus
                                        />
                                        <Button
                                          onClick={() => handleVideoSubmit(selectedService)}
                                          className={cn(
                                            "w-full",
                                            selectedService === 'youtube' 
                                              ? "bg-red-500 hover:bg-red-600" 
                                              : "bg-blue-500 hover:bg-blue-600"
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
                
                <div className="flex items-center space-x-2 bg-gray-50 text-gray-600 px-4 py-2 rounded-full">
                  <Info size={14} />
                  <p className="text-sm">Drag to reorder • Maximum 4 previews • Supports images & videos</p>
                </div>
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
