'use client'
import React from 'react'
import { Upload } from 'lucide-react'
import { Button } from "@components/ui/button"
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { uploadLandingContent } from '@services/organizations/orgs'
import { getOrgLandingMediaDirectory } from '@services/media/media'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'

interface ImageUploaderProps {
  onImageUploaded: (imageUrl: string) => void
  className?: string
  buttonText?: string
  id: string
  fileType?: 'image' | 'video'
}

export const ImageUploader: React.FC<ImageUploaderProps> = ({ onImageUploaded, className, buttonText = "Upload Image", id, fileType = 'image' }) => {
  const { t } = useTranslation()
  const org = useOrg() as any
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const [isUploading, setIsUploading] = React.useState(false)
  const inputId = `imageUpload-${id}`

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Validate file using reusable utility
    const { validateFile } = await import('@/lib/file-validation')
    const validation = validateFile(file, [fileType])
    
    if (!validation.valid) {
      toast.error(validation.error!)
      e.target.value = '' // Clear the input
      return
    }

    setIsUploading(true)
    try {
      const response = await uploadLandingContent(org.id, file, access_token)
      if (response.status === 200) {
        const imageUrl = getOrgLandingMediaDirectory(org.org_uuid, response.data.filename)
        onImageUploaded(imageUrl)
        toast.success(t('dashboard.organization.images.toasts.logo_success'))
      } else {
        toast.error(t('dashboard.organization.images.toasts.logo_error'))
      }
    } catch (error) {
      console.error('Error uploading image:', error)
      toast.error(t('dashboard.organization.images.toasts.logo_error'))
    } finally {
      setIsUploading(false)
    }
  }

  return (
    <div className={className}>
      <Button
        variant="outline"
        onClick={() => document.getElementById(inputId)?.click()}
        disabled={isUploading}
        className="w-full"
      >
        <Upload className="h-4 w-4 me-2" />
        {isUploading ? t('dashboard.organization.images.uploading') : buttonText}
      </Button>
      <input
        id={inputId}
        type="file"
        accept={fileType === 'video' ? 'video/mp4,video/webm' : 'image/jpeg,image/png,image/webp,image/gif'}
        onChange={handleFileChange}
        className="hidden"
      />
    </div>
  )
}
