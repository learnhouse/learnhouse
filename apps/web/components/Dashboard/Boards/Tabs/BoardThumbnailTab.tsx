'use client'

import React, { useState, useRef, useEffect } from 'react'
import { UploadCloud, Image as ImageIcon, ArrowBigUpDash } from 'lucide-react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { updateBoardThumbnail } from '@services/boards/boards'
import { getBoardThumbnailMediaDirectory } from '@services/media/media'
import UnsplashImagePicker from '@components/Dashboard/Pages/Course/EditCourseGeneral/UnsplashImagePicker'
import toast from 'react-hot-toast'
import { mutate } from 'swr'
import { useTranslation } from 'react-i18next'

const MAX_FILE_SIZE = 8_000_000
const VALID_IMAGE_MIME_TYPES = ['image/jpeg', 'image/jpg', 'image/png'] as const

interface BoardThumbnailTabProps {
  board: any
  boardUuid: string
  orgUuid: string
  boardKey: string | null
}

function BoardThumbnailTab({ board, boardUuid, orgUuid, boardKey }: BoardThumbnailTabProps) {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token

  const imageInputRef = useRef<HTMLInputElement>(null)
  const [localThumbnail, setLocalThumbnail] = useState<{ url: string } | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [showUnsplashPicker, setShowUnsplashPicker] = useState(false)

  useEffect(() => {
    return () => {
      if (localThumbnail?.url) {
        URL.revokeObjectURL(localThumbnail.url)
      }
    }
  }, [localThumbnail])

  const thumbnailUrl = localThumbnail?.url
    || (board.thumbnail_image
      ? getBoardThumbnailMediaDirectory(orgUuid, boardUuid, board.thumbnail_image)
      : '/empty_thumbnail.png')

  const uploadFile = async (file: File) => {
    setIsUploading(true)
    try {
      await updateBoardThumbnail(boardUuid, file, access_token)
      toast.success(t('boards.thumbnail.thumbnail_updated'))
      setLocalThumbnail(null)
      if (boardKey) mutate(boardKey)
      mutate((key) => typeof key === 'string' && key.includes('/boards/org/'), undefined, { revalidate: true })
    } catch {
      toast.error(t('boards.thumbnail.thumbnail_updated_error'))
    } finally {
      setIsUploading(false)
    }
  }

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    if (!VALID_IMAGE_MIME_TYPES.includes(file.type as any)) {
      toast.error('Please upload a PNG or JPG/JPEG image')
      event.target.value = ''
      return
    }
    if (file.size > MAX_FILE_SIZE) {
      toast.error(`File size (${(file.size / 1024 / 1024).toFixed(2)}MB) exceeds the 8MB limit`)
      event.target.value = ''
      return
    }

    const blobUrl = URL.createObjectURL(file)
    setLocalThumbnail({ url: blobUrl })
    await uploadFile(file)
  }

  const handleUnsplashSelect = async (imageUrl: string) => {
    try {
      setIsUploading(true)
      const response = await fetch(imageUrl)
      const blob = await response.blob()
      const file = new File([blob], `unsplash_${Date.now()}.jpg`, { type: blob.type })

      const blobUrl = URL.createObjectURL(file)
      setLocalThumbnail({ url: blobUrl })
      await uploadFile(file)
    } catch {
      toast.error('Failed to process Unsplash image')
      setIsUploading(false)
    }
  }

  return (
    <div>
      <div className="h-6"></div>
      <div className="mx-4 sm:mx-10 bg-white rounded-xl shadow-xs px-4 py-4">
        <div className="flex flex-col bg-gray-50 -space-y-1 px-3 sm:px-5 py-3 rounded-md mb-3">
          <h1 className="font-bold text-lg sm:text-xl text-gray-800">{t('boards.thumbnail.title')}</h1>
          <h2 className="text-gray-500 text-xs sm:text-sm">{t('boards.thumbnail.description')}</h2>
        </div>
        <div className="px-3 sm:px-5 py-3 space-y-4">
          <div className="max-w-[480px]">
            <img
              src={thumbnailUrl}
              alt={t('boards.thumbnail.alt')}
              className={`w-full aspect-video object-cover rounded-lg border border-gray-200 ${isUploading ? 'animate-pulse' : ''}`}
            />
          </div>

          {isUploading ? (
            <div className="flex items-center gap-2">
              <div className="font-medium text-sm text-green-800 bg-green-50 rounded-full px-4 py-2 flex items-center">
                <ArrowBigUpDash size={16} className="mr-2 animate-bounce" />
                {t('boards.thumbnail.uploading')}
              </div>
            </div>
          ) : (
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
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                onClick={() => imageInputRef.current?.click()}
              >
                <UploadCloud size={16} />
                {t('boards.thumbnail.upload_image')}
              </button>
              <button
                type="button"
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                onClick={() => setShowUnsplashPicker(true)}
              >
                <ImageIcon size={16} />
                {t('boards.thumbnail.gallery')}
              </button>
            </div>
          )}

          <p className="text-sm text-gray-500">{t('boards.thumbnail.supported_formats')}</p>
        </div>
      </div>

      {showUnsplashPicker && (
        <UnsplashImagePicker
          onSelect={handleUnsplashSelect}
          onClose={() => setShowUnsplashPicker(false)}
        />
      )}
    </div>
  )
}

export default BoardThumbnailTab
