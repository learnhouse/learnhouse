'use client'
import React, { useState, useRef } from 'react'
import { UploadCloud, Image as ImageIcon, ArrowBigUpDash, X, Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { Community, updateCommunityThumbnail } from '@services/communities/communities'
import { getCommunityThumbnailMediaDirectory } from '@services/media/media'
import { revalidateTags } from '@services/utils/ts/requests'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@components/ui/dialog'
import UnsplashImagePicker from '@components/Dashboard/Pages/Course/EditCourseGeneral/UnsplashImagePicker'
import toast from 'react-hot-toast'
import { SafeImage } from '@components/Objects/SafeImage'

interface CommunityThumbnailModalProps {
  isOpen: boolean
  onClose: () => void
  community: Community
  orgSlug: string
}

const MAX_FILE_SIZE = 8_000_000 // 8MB
const VALID_IMAGE_MIME_TYPES = ['image/jpeg', 'image/jpg', 'image/png'] as const
type ValidImageMimeType = (typeof VALID_IMAGE_MIME_TYPES)[number]

export function CommunityThumbnailModal({
  isOpen,
  onClose,
  community,
  orgSlug,
}: CommunityThumbnailModalProps) {
  const session = useLHSession() as any
  const router = useRouter()
  const org = useOrg() as any
  const accessToken = session?.data?.tokens?.access_token
  const imageInputRef = useRef<HTMLInputElement>(null)

  const [localThumbnail, setLocalThumbnail] = useState<{ file: File; url: string } | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [showUnsplashPicker, setShowUnsplashPicker] = useState(false)

  const showError = (message: string) => {
    toast.error(message, {
      duration: 3000,
      position: 'top-center',
    })
  }

  const validateFile = (file: File): boolean => {
    if (!VALID_IMAGE_MIME_TYPES.includes(file.type as ValidImageMimeType)) {
      showError(`Invalid file type: ${file.type}. Please upload only PNG or JPG/JPEG images`)
      return false
    }

    if (file.size > MAX_FILE_SIZE) {
      showError(`File size (${(file.size / 1024 / 1024).toFixed(2)}MB) exceeds the 8MB limit`)
      return false
    }

    return true
  }

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]

    if (!file) {
      showError('Please select a file')
      return
    }

    if (!validateFile(file)) {
      event.target.value = ''
      return
    }

    const blobUrl = URL.createObjectURL(file)
    setLocalThumbnail({ file, url: blobUrl })
    await uploadThumbnail(file)
  }

  const handleUnsplashSelect = async (imageUrl: string) => {
    try {
      setIsLoading(true)
      const response = await fetch(imageUrl)
      const blob = await response.blob()

      if (!VALID_IMAGE_MIME_TYPES.includes(blob.type as ValidImageMimeType)) {
        throw new Error('Invalid image format from Unsplash')
      }

      const file = new File([blob], `unsplash_${Date.now()}.jpg`, { type: blob.type })

      if (!validateFile(file)) {
        setIsLoading(false)
        return
      }

      const blobUrl = URL.createObjectURL(file)
      setLocalThumbnail({ file, url: blobUrl })
      setShowUnsplashPicker(false)
      await uploadThumbnail(file)
    } catch (err) {
      showError('Failed to process Unsplash image')
      setIsLoading(false)
    }
  }

  const uploadThumbnail = async (file: File) => {
    setIsLoading(true)
    try {
      const formData = new FormData()
      formData.append('thumbnail', file)

      const res = await updateCommunityThumbnail(
        community.community_uuid,
        formData,
        accessToken
      )

      await revalidateTags(['communities'], orgSlug)
      await new Promise((r) => setTimeout(r, 1000))

      if (res.success === false) {
        showError(res.HTTPmessage)
      } else {
        setLocalThumbnail(null)
        toast.success('Thumbnail updated successfully', {
          duration: 3000,
          position: 'top-center',
        })
        router.refresh()
        onClose()
      }
    } catch (err) {
      showError('Failed to update thumbnail')
    } finally {
      setIsLoading(false)
    }
  }

  const getCurrentThumbnailUrl = () => {
    if (localThumbnail) {
      return localThumbnail.url
    }
    if (community.thumbnail_image && org?.org_uuid) {
      return getCommunityThumbnailMediaDirectory(
        org.org_uuid,
        community.community_uuid,
        community.thumbnail_image
      )
    }
    return null
  }

  const thumbnailUrl = getCurrentThumbnailUrl()

  return (
    <>
      <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ImageIcon size={20} />
              Community Thumbnail
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-6 py-4">
            {/* Preview */}
            <div className="aspect-video w-full bg-gray-100 rounded-xl overflow-hidden border border-gray-200">
              {thumbnailUrl ? (
                <SafeImage
                  src={thumbnailUrl}
                  alt="Community thumbnail"
                  className={`w-full h-full object-cover ${isLoading ? 'animate-pulse' : ''}`}
                />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center text-gray-400">
                  <ImageIcon size={48} strokeWidth={1} />
                  <p className="text-sm mt-2">No thumbnail set</p>
                </div>
              )}
            </div>

            {/* Upload status */}
            {isLoading && (
              <div className="flex justify-center">
                <div className="font-medium text-sm text-green-800 bg-green-50 rounded-full px-4 py-2 flex items-center">
                  <ArrowBigUpDash size={16} className="mr-2 animate-bounce" />
                  Uploading...
                </div>
              </div>
            )}

            {/* Action buttons */}
            {!isLoading && (
              <div className="flex gap-2">
                <input
                  ref={imageInputRef}
                  type="file"
                  className="hidden"
                  accept=".jpg,.jpeg,.png"
                  onChange={handleFileChange}
                />
                <button
                  type="button"
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                  onClick={() => imageInputRef.current?.click()}
                >
                  <UploadCloud size={16} />
                  Upload Image
                </button>
                <button
                  type="button"
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                  onClick={() => setShowUnsplashPicker(true)}
                >
                  <ImageIcon size={16} />
                  Browse Unsplash
                </button>
              </div>
            )}

            <p className="text-xs text-gray-500 text-center">
              Supported formats: JPG, JPEG, PNG. Max file size: 8MB
            </p>
          </div>

          {/* Actions */}
          <div className="flex justify-end pt-4 border-t border-gray-100">
            <button
              type="button"
              onClick={onClose}
              disabled={isLoading}
              className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
            >
              Close
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {showUnsplashPicker && (
        <UnsplashImagePicker
          onSelect={handleUnsplashSelect}
          onClose={() => setShowUnsplashPicker(false)}
        />
      )}
    </>
  )
}

export default CommunityThumbnailModal
