'use client'
import React, { useState, useRef } from 'react'
import { UploadCloud, Image as ImageIcon, ArrowBigUpDash } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { useCommunity, useCommunityDispatch } from '@components/Contexts/CommunityContext'
import { updateCommunityThumbnail } from '@services/communities/communities'
import { getCommunityThumbnailMediaDirectory } from '@services/media/media'
import { revalidateTags } from '@services/utils/ts/requests'
import { mutate } from 'swr'
import { getAPIUrl } from '@services/config/config'
import UnsplashImagePicker from '@components/Dashboard/Pages/Course/EditCourseGeneral/UnsplashImagePicker'
import toast from 'react-hot-toast'
import { Button } from '@components/ui/button'
import { SafeImage } from '@components/Objects/SafeImage'

const MAX_FILE_SIZE = 8_000_000 // 8MB
const VALID_IMAGE_MIME_TYPES = ['image/jpeg', 'image/jpg', 'image/png'] as const
type ValidImageMimeType = (typeof VALID_IMAGE_MIME_TYPES)[number]

const CommunityEditThumbnail: React.FC = () => {
  const { t } = useTranslation()
  const router = useRouter()
  const session = useLHSession() as any
  const org = useOrg() as any
  const communityState = useCommunity()
  const dispatch = useCommunityDispatch()
  const community = communityState?.community
  const accessToken = session?.data?.tokens?.access_token
  const imageInputRef = useRef<HTMLInputElement>(null)

  const [localThumbnail, setLocalThumbnail] = useState<{ file: File; url: string } | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [showUnsplashPicker, setShowUnsplashPicker] = useState(false)

  if (!community) return null

  const showError = (message: string) => {
    toast.error(message, {
      duration: 3000,
      position: 'top-center',
    })
  }

  const validateFile = (file: File): boolean => {
    if (!VALID_IMAGE_MIME_TYPES.includes(file.type as ValidImageMimeType)) {
      showError(t('dashboard.courses.communities.thumbnail.toasts.invalid_type'))
      return false
    }

    if (file.size > MAX_FILE_SIZE) {
      showError(t('dashboard.courses.communities.thumbnail.toasts.file_too_large'))
      return false
    }

    return true
  }

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]

    if (!file) {
      showError(t('dashboard.courses.communities.thumbnail.toasts.update_error'))
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
      showError(t('dashboard.courses.communities.thumbnail.toasts.update_error'))
      setIsLoading(false)
    }
  }

  const uploadThumbnail = async (file: File) => {
    setIsLoading(true)
    try {
      const formData = new FormData()
      formData.append('thumbnail', file)

      const res = await updateCommunityThumbnail(community.community_uuid, formData, accessToken)

      await revalidateTags(['communities'], org.slug)
      mutate(`${getAPIUrl()}communities/${community.community_uuid}`)
      await new Promise((r) => setTimeout(r, 1000))

      if (res.success === false) {
        showError(res.HTTPmessage)
      } else {
        setLocalThumbnail(null)
        toast.success(t('dashboard.courses.communities.thumbnail.toasts.update_success'), {
          duration: 3000,
          position: 'top-center',
        })
        router.refresh()
      }
    } catch (err) {
      showError(t('dashboard.courses.communities.thumbnail.toasts.update_error'))
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
      <div className="sm:mx-10 mx-0 bg-white rounded-xl nice-shadow">
        <div className="flex flex-col gap-0">
          <div className="flex flex-col bg-gray-50 -space-y-1 px-5 py-3 mx-3 my-3 rounded-md">
            <h1 className="font-bold text-xl text-gray-800">{t('dashboard.courses.communities.thumbnail.title')}</h1>
            <h2 className="text-gray-500 text-md">
              {t('dashboard.courses.communities.thumbnail.subtitle')}
            </h2>
          </div>

          <div className="mx-5 my-5 space-y-6">
            {/* Preview */}
            <div className="aspect-video max-w-2xl bg-gray-100 rounded-xl overflow-hidden border border-gray-200">
              {thumbnailUrl ? (
                <SafeImage
                  src={thumbnailUrl}
                  alt="Community thumbnail"
                  className={`w-full h-full object-cover ${isLoading ? 'animate-pulse' : ''}`}
                />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center text-gray-400">
                  <ImageIcon size={48} strokeWidth={1} />
                  <p className="text-sm mt-2">{t('dashboard.courses.communities.thumbnail.no_thumbnail')}</p>
                </div>
              )}
            </div>

            {/* Upload status */}
            {isLoading && (
              <div className="flex justify-start">
                <div className="font-medium text-sm text-green-800 bg-green-50 rounded-full px-4 py-2 flex items-center">
                  <ArrowBigUpDash size={16} className="mr-2 animate-bounce" />
                  {t('common.loading')}
                </div>
              </div>
            )}

            {/* Action buttons */}
            {!isLoading && (
              <div className="flex gap-3">
                <input
                  ref={imageInputRef}
                  type="file"
                  className="hidden"
                  accept=".jpg,.jpeg,.png"
                  onChange={handleFileChange}
                />
                <Button
                  type="button"
                  variant="outline"
                  className="flex items-center gap-2"
                  onClick={() => imageInputRef.current?.click()}
                >
                  <UploadCloud size={16} />
                  {t('dashboard.courses.communities.thumbnail.upload_image')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="flex items-center gap-2"
                  onClick={() => setShowUnsplashPicker(true)}
                >
                  <ImageIcon size={16} />
                  {t('dashboard.courses.communities.thumbnail.browse_unsplash')}
                </Button>
              </div>
            )}

            <p className="text-xs text-gray-500">
              {t('dashboard.courses.communities.thumbnail.supported_formats')}
            </p>
          </div>
        </div>
      </div>

      {showUnsplashPicker && (
        <UnsplashImagePicker
          onSelect={handleUnsplashSelect}
          onClose={() => setShowUnsplashPicker(false)}
        />
      )}
    </>
  )
}

export default CommunityEditThumbnail
