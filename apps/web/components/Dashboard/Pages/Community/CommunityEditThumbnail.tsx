'use client'
import React, { useState, useRef } from 'react'
import { CircleNotch, ImageSquare, UploadSimple } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { useCommunity, useCommunityDispatch } from '@components/Contexts/CommunityContext'
import { updateCommunityThumbnail } from '@services/communities/communities'
import { getCommunityThumbnailMediaDirectory } from '@services/media/media'
import { revalidateTags } from '@services/utils/ts/requests'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import AIImageButton from '@components/Objects/AI/AIImageButton'
import toast from 'react-hot-toast'
import { Button, SectionCard, buttonClass } from '@components/Dashboard/Shared/DashKit/DashKit'
import { SafeImage } from '@components/Objects/SafeImage'

const MAX_FILE_SIZE = 8_000_000 // 8MB
const VALID_IMAGE_MIME_TYPES = ['image/jpeg', 'image/jpg', 'image/png'] as const
type ValidImageMimeType = (typeof VALID_IMAGE_MIME_TYPES)[number]

const CommunityEditThumbnail: React.FC = () => {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const org = useOrg() as any
  const communityState = useCommunity()
  const dispatch = useCommunityDispatch()
  const community = communityState?.community
  const accessToken = session?.data?.tokens?.access_token
  const queryClient = useQueryClient()
  const imageInputRef = useRef<HTMLInputElement>(null)

  const [localThumbnail, setLocalThumbnail] = useState<{ file: File; url: string } | null>(null)
  const [isLoading, setIsLoading] = useState(false)

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

  const handleRemoteImageSelect = async (imageUrl: string) => {
    try {
      setIsLoading(true)
      const response = await fetch(imageUrl)
      const blob = await response.blob()

      if (!VALID_IMAGE_MIME_TYPES.includes(blob.type as ValidImageMimeType)) {
        throw new Error('Invalid generated image format')
      }

      const file = new File([blob], `ai_image_${Date.now()}.jpg`, { type: blob.type })

      if (!validateFile(file)) {
        setIsLoading(false)
        return
      }

      const blobUrl = URL.createObjectURL(file)
      setLocalThumbnail({ file, url: blobUrl })
      await uploadThumbnail(file)
    } catch (_err) {
      showError(t('dashboard.courses.communities.thumbnail.toasts.update_error'))
      setIsLoading(false)
    }
  }

  const handleAIImageFile = async (file: File) => {
    if (!validateFile(file)) return
    const blobUrl = URL.createObjectURL(file)
    setLocalThumbnail({ file, url: blobUrl })
    await uploadThumbnail(file)
  }

  const uploadThumbnail = async (file: File) => {
    setIsLoading(true)
    try {
      const formData = new FormData()
      formData.append('thumbnail', file)

      const res = await updateCommunityThumbnail(community.community_uuid, formData, accessToken)

      await revalidateTags(['communities'], org.slug)
      queryClient.invalidateQueries({ queryKey: queryKeys.community.detail(community.community_uuid) })
      await new Promise((r) => setTimeout(r, 1000))

      if (res.success === false) {
        showError(res.HTTPmessage)
      } else {
        // Show the new cover in the header right away; the refetch confirms it.
        const fileName = res?.data?.thumbnail_image
        if (fileName && dispatch) dispatch({ type: 'setCommunity', payload: { ...community, thumbnail_image: fileName } })
        setLocalThumbnail(null)
        queryClient.invalidateQueries({ queryKey: queryKeys.community.list(org.id) })
        toast.success(t('dashboard.courses.communities.thumbnail.toasts.update_success'), {
          duration: 3000,
          position: 'top-center',
        })
      }
    } catch (_err) {
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
    <SectionCard
      icon={<ImageSquare size={18} />}
      title={t('dashboard.courses.communities.thumbnail.title')}
      description={t('dashboard.courses.communities.thumbnail.subtitle')}
    >
      <div className="flex flex-col md:flex-row gap-6 md:items-start">
        {/* Preview: also a drop-in click target for picking a file */}
        <button
          type="button"
          onClick={() => !isLoading && imageInputRef.current?.click()}
          className="group relative w-full md:max-w-md aspect-video shrink-0 rounded-xl overflow-hidden bg-neutral-100 ring-1 ring-inset ring-neutral-200 hover:ring-neutral-300 transition-shadow"
          aria-label={t('dashboard.courses.communities.thumbnail.upload_image')}
        >
          {thumbnailUrl ? (
            <SafeImage
              src={thumbnailUrl}
              alt={t('dashboard.courses.communities.thumbnail.title')}
              className={`w-full h-full object-cover ${isLoading ? 'opacity-60' : ''}`}
            />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-neutral-400">
              <ImageSquare size={36} weight="duotone" />
              <p className="text-sm font-medium">{t('dashboard.courses.communities.thumbnail.no_thumbnail')}</p>
            </div>
          )}
          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="inline-flex items-center gap-2 rounded-full bg-white/95 px-3 py-1.5 text-xs font-semibold text-neutral-700 shadow-sm">
                <CircleNotch size={14} className="animate-spin" />
                {t('dashboard.courses.communities.thumbnail.uploading')}
              </span>
            </div>
          )}
        </button>

        <div className="flex flex-col gap-3 min-w-0">
          <p className="text-sm text-neutral-600">{t('communities.dash.thumbnail.help')}</p>
          <input
            ref={imageInputRef}
            type="file"
            className="hidden"
            accept=".jpg,.jpeg,.png"
            onChange={handleFileChange}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              icon={<UploadSimple size={14} />}
              disabled={isLoading}
              onClick={() => imageInputRef.current?.click()}
            >
              {thumbnailUrl ? t('communities.dash.thumbnail.replace') : t('dashboard.courses.communities.thumbnail.upload_image')}
            </Button>
            {!isLoading && (
              <AIImageButton
                onSelect={handleRemoteImageSelect}
                onSelectFile={handleAIImageFile}
                className={buttonClass('secondary', 'md')}
              />
            )}
          </div>
          <p className="text-xs text-neutral-400">{t('dashboard.courses.communities.thumbnail.supported_formats')}</p>
        </div>
      </div>
    </SectionCard>
  )
}

export default CommunityEditThumbnail
