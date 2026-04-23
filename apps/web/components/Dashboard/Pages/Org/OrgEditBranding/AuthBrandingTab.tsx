'use client'
import React, { useState, useEffect } from 'react'
import { UploadCloud, Info, Image as ImageIcon, Palette, Sun, Moon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getOrgLogoMediaDirectory, getOrgAuthBackgroundMediaDirectory } from '@services/media/media'
import { toast } from 'react-hot-toast'
import { constructAcceptValue } from '@/lib/constants'
import { updateOrgAuthBrandingConfig, uploadOrgAuthBackground, AuthBrandingConfig } from '@services/settings/org'
import { cn } from '@/lib/utils'
import { Input } from "@components/ui/input"
import { Button } from "@components/ui/button"
import { Label } from "@components/ui/label"
import { Textarea } from "@components/ui/textarea"
import { useTranslation } from 'react-i18next'
import { revalidateTags } from '@services/utils/ts/requests'
import { mutate } from 'swr'
import { getAPIUrl } from '@services/config/config'
import UnsplashImagePicker, { UnsplashPhotoMeta } from '@components/Dashboard/Pages/Course/EditCourseGeneral/UnsplashImagePicker'
import { isOSSMode } from '@services/config/config'
import { usePlan } from '@components/Hooks/usePlan'

const SUPPORTED_FILES = constructAcceptValue(['png', 'jpg', 'webp'])

type BackgroundType = 'gradient' | 'custom' | 'unsplash'
type TextColor = 'light' | 'dark'

export default function AuthBrandingTab() {
  const { t } = useTranslation()
  const router = useRouter()
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const org = useOrg() as any

  const existingConfig = org?.config?.config?.customization?.auth_branding || org?.config?.config?.general?.auth_branding || {}

  // Check if org has enterprise plan - hide LearnHouse branding for enterprise users
  // In OSS mode, always show branding regardless of plan
  const plan = usePlan()
  const isEnterprise = plan === 'enterprise'

  const [welcomeMessage, setWelcomeMessage] = useState<string>(existingConfig.welcome_message || '')
  const [backgroundType, setBackgroundType] = useState<BackgroundType>(existingConfig.background_type || 'gradient')
  const [backgroundImage, setBackgroundImage] = useState<string>(existingConfig.background_image || '')
  const [textColor, setTextColor] = useState<TextColor>(existingConfig.text_color || 'light')
  const [unsplashPhotographerName, setUnsplashPhotographerName] = useState<string>(existingConfig.unsplash_photographer_name || '')
  const [unsplashPhotographerUrl, setUnsplashPhotographerUrl] = useState<string>(existingConfig.unsplash_photographer_url || '')
  const [unsplashPhotoUrl, setUnsplashPhotoUrl] = useState<string>(existingConfig.unsplash_photo_url || '')
  const [isSaving, setIsSaving] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [showUnsplashPicker, setShowUnsplashPicker] = useState(false)
  const [localBackgroundPreview, setLocalBackgroundPreview] = useState<string | null>(null)

  useEffect(() => {
    const config = org?.config?.config?.customization?.auth_branding || org?.config?.config?.general?.auth_branding
    if (config) {
      setWelcomeMessage(config.welcome_message || '')
      setBackgroundType(config.background_type || 'gradient')
      setBackgroundImage(config.background_image || '')
      setTextColor(config.text_color || 'light')
      setUnsplashPhotographerName(config.unsplash_photographer_name || '')
      setUnsplashPhotographerUrl(config.unsplash_photographer_url || '')
      setUnsplashPhotoUrl(config.unsplash_photo_url || '')
    }
  }, [org])

  const handleSave = async () => {
    setIsSaving(true)
    const loadingToast = toast.loading(t('dashboard.organization.auth_branding.saving'))
    try {
      const config: AuthBrandingConfig = {
        welcome_message: welcomeMessage,
        background_type: backgroundType,
        background_image: backgroundImage,
        text_color: textColor,
        unsplash_photographer_name: backgroundType === 'unsplash' ? unsplashPhotographerName : '',
        unsplash_photographer_url: backgroundType === 'unsplash' ? unsplashPhotographerUrl : '',
        unsplash_photo_url: backgroundType === 'unsplash' ? unsplashPhotoUrl : '',
      }
      await updateOrgAuthBrandingConfig(org.id, config, access_token)
      await revalidateTags(['organizations'], org.slug)
      mutate(`${getAPIUrl()}orgs/slug/${org.slug}`)
      toast.success(t('dashboard.organization.auth_branding.save_success'), { id: loadingToast })
      router.refresh()
    } catch (err) {
      toast.error(t('dashboard.organization.auth_branding.save_error'), { id: loadingToast })
    } finally {
      setIsSaving(false)
    }
  }

  const handleBackgroundUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files.length > 0) {
      const file = event.target.files[0]
      setLocalBackgroundPreview(URL.createObjectURL(file))
      setIsUploading(true)
      const loadingToast = toast.loading(t('dashboard.organization.auth_branding.uploading'))
      try {
        const response = await uploadOrgAuthBackground(org.id, file, access_token)
        setBackgroundImage(response.filename)
        setBackgroundType('custom')
        toast.success(t('dashboard.organization.auth_branding.upload_success'), { id: loadingToast })
      } catch (err) {
        toast.error(t('dashboard.organization.auth_branding.upload_error'), { id: loadingToast })
        setLocalBackgroundPreview(null)
      } finally {
        setIsUploading(false)
      }
    }
  }

  const handleUnsplashSelect = (imageUrl: string, meta?: UnsplashPhotoMeta) => {
    setBackgroundImage(imageUrl)
    setBackgroundType('unsplash')
    setUnsplashPhotographerName(meta?.photographer_name || '')
    setUnsplashPhotographerUrl(meta?.photographer_url || '')
    setUnsplashPhotoUrl(meta?.photo_url || '')
    setLocalBackgroundPreview(null)
    setShowUnsplashPicker(false)
  }

  const getBackgroundStyle = () => {
    if (backgroundType === 'gradient') {
      // Original black gradient
      return {
        background: 'linear-gradient(041.61deg, #202020 7.15%, #000000 90.96%)',
      }
    }
    if (backgroundType === 'custom' && backgroundImage) {
      const url = localBackgroundPreview || getOrgAuthBackgroundMediaDirectory(org?.org_uuid, backgroundImage)
      return {
        backgroundImage: `url(${url})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }
    }
    if (backgroundType === 'unsplash' && backgroundImage) {
      return {
        backgroundImage: `url(${backgroundImage})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }
    }
    // Default to original black gradient
    return {
      background: 'linear-gradient(041.61deg, #202020 7.15%, #000000 90.96%)',
    }
  }

  const backgroundOptions: { type: BackgroundType; label: string; icon: React.ElementType }[] = [
    { type: 'gradient', label: t('dashboard.organization.auth_branding.bg_gradient'), icon: Palette },
    { type: 'custom', label: t('dashboard.organization.auth_branding.bg_custom'), icon: UploadCloud },
    { type: 'unsplash', label: t('dashboard.organization.auth_branding.bg_unsplash'), icon: ImageIcon },
  ]

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      {/* Settings Panel */}
      <div className="flex-1 space-y-6">
        {/* Welcome Message */}
        <div className="bg-gray-50/50 rounded-xl p-5">
          <Label className="text-sm font-medium text-gray-700 mb-3 block">
            {t('dashboard.organization.auth_branding.welcome_message')}
          </Label>
          <Textarea
            value={welcomeMessage}
            onChange={(e) => setWelcomeMessage(e.target.value)}
            placeholder={t('dashboard.organization.auth_branding.welcome_placeholder')}
            className="w-full min-h-[80px] bg-white"
            maxLength={200}
          />
          <p className="text-xs text-gray-400 mt-2">
            {t('dashboard.organization.auth_branding.welcome_desc')}
          </p>
        </div>

        {/* Background Type */}
        <div className="bg-gray-50/50 rounded-xl p-5">
          <Label className="text-sm font-medium text-gray-700 mb-3 block">
            {t('dashboard.organization.auth_branding.background_type')}
          </Label>
          <div className="grid grid-cols-3 gap-3">
            {backgroundOptions.map((option) => (
              <button
                key={option.type}
                onClick={() => {
                  if (option.type === 'unsplash') {
                    setShowUnsplashPicker(true)
                  } else if (option.type === 'custom') {
                    document.getElementById('backgroundInput')?.click()
                  } else {
                    setBackgroundType(option.type)
                    setBackgroundImage('')
                    setLocalBackgroundPreview(null)
                  }
                }}
                className={cn(
                  "flex flex-col items-center justify-center p-4 rounded-xl border-2 transition-all",
                  backgroundType === option.type
                    ? "border-blue-500 bg-blue-50"
                    : "border-gray-200 hover:border-gray-300 bg-white"
                )}
              >
                <option.icon size={24} className={cn(
                  backgroundType === option.type ? "text-blue-500" : "text-gray-400"
                )} />
                <span className={cn(
                  "text-sm mt-2 font-medium",
                  backgroundType === option.type ? "text-blue-600" : "text-gray-600"
                )}>
                  {option.label}
                </span>
              </button>
            ))}
          </div>
          <input
            type="file"
            id="backgroundInput"
            accept={SUPPORTED_FILES}
            className="hidden"
            onChange={handleBackgroundUpload}
          />
        </div>

        {/* Text Color */}
        <div className="bg-gray-50/50 rounded-xl p-5">
          <Label className="text-sm font-medium text-gray-700 mb-3 block">
            {t('dashboard.organization.auth_branding.text_color')}
          </Label>
          <div className="flex gap-3">
            <button
              onClick={() => setTextColor('light')}
              className={cn(
                "flex-1 flex items-center justify-center gap-2 p-3 rounded-xl border-2 transition-all",
                textColor === 'light'
                  ? "border-blue-500 bg-blue-50"
                  : "border-gray-200 hover:border-gray-300 bg-white"
              )}
            >
              <Sun size={18} className={textColor === 'light' ? "text-blue-500" : "text-gray-400"} />
              <span className={cn(
                "text-sm font-medium",
                textColor === 'light' ? "text-blue-600" : "text-gray-600"
              )}>
                {t('dashboard.organization.auth_branding.text_light')}
              </span>
            </button>
            <button
              onClick={() => setTextColor('dark')}
              className={cn(
                "flex-1 flex items-center justify-center gap-2 p-3 rounded-xl border-2 transition-all",
                textColor === 'dark'
                  ? "border-blue-500 bg-blue-50"
                  : "border-gray-200 hover:border-gray-300 bg-white"
              )}
            >
              <Moon size={18} className={textColor === 'dark' ? "text-blue-500" : "text-gray-400"} />
              <span className={cn(
                "text-sm font-medium",
                textColor === 'dark' ? "text-blue-600" : "text-gray-600"
              )}>
                {t('dashboard.organization.auth_branding.text_dark')}
              </span>
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-2">
            {t('dashboard.organization.auth_branding.text_color_desc')}
          </p>
        </div>

        {/* Save Button */}
        <div className="flex justify-end">
          <Button
            onClick={handleSave}
            disabled={isSaving || isUploading}
            className="bg-black text-white hover:bg-black/90"
          >
            {isSaving ? t('dashboard.organization.settings.saving') : t('dashboard.organization.settings.save_changes')}
          </Button>
        </div>
      </div>

      {/* Preview Panel */}
      <div className="flex-1">
        <Label className="text-sm font-medium text-gray-700 mb-3 block">
          {t('dashboard.organization.auth_branding.preview')}
        </Label>
        <div className="rounded-xl overflow-hidden border border-gray-200 aspect-[4/3]">
          <div className="h-full flex">
            {/* Branding Side Preview */}
            <div
              className="w-1/2 relative flex flex-col p-3"
              style={getBackgroundStyle()}
            >
              {/* Overlay for custom backgrounds only */}
              {backgroundType !== 'gradient' && backgroundImage && (
                <div className="absolute inset-0 bg-black/30" />
              )}

              {/* Top lrn logo - hidden for enterprise users */}
              {!isEnterprise && (
                <div className="relative z-10">
                  <div
                    className={cn(
                      "w-4 h-4 bg-contain bg-no-repeat",
                      textColor === 'light' ? "opacity-60 invert" : "opacity-40"
                    )}
                    style={{ backgroundImage: "url(/lrn.svg)" }}
                  />
                </div>
              )}

              {/* Centered content */}
              <div className="relative z-10 flex-1 flex items-center justify-center">
                <div className={cn(
                  "text-center flex flex-col items-center space-y-2",
                  textColor === 'light' ? "text-white" : "text-gray-900"
                )}>
                  {/* Organization logo */}
                  <div
                    className="w-10 h-10 bg-contain bg-no-repeat bg-center rounded-lg"
                    style={{
                      backgroundImage: org?.logo_image
                        ? `url(${getOrgLogoMediaDirectory(org?.org_uuid, org?.logo_image)})`
                        : undefined,
                      backgroundColor: org?.logo_image ? 'white' : 'rgba(255,255,255,0.2)'
                    }}
                  />
                  {/* Organization name */}
                  <p className="text-xs font-bold">{org?.name}</p>
                  {/* Welcome message */}
                  {welcomeMessage && (
                    <p className={cn(
                      "text-[9px] max-w-[100px] leading-relaxed",
                      textColor === 'light' ? "text-white/70" : "text-gray-600"
                    )}>
                      {welcomeMessage}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Form Side Preview */}
            <div className="w-1/2 bg-white flex items-center justify-center p-4">
              <div className="w-full max-w-[100px] space-y-2">
                <div className="h-2 w-12 bg-gray-200 rounded" />
                <div className="h-6 bg-gray-100 rounded border border-gray-200" />
                <div className="h-2 w-10 bg-gray-200 rounded" />
                <div className="h-6 bg-gray-100 rounded border border-gray-200" />
                <div className="h-5 bg-gray-800 rounded mt-3" />
              </div>
            </div>
          </div>
        </div>
        <div className="flex items-center space-x-2 bg-blue-50 text-blue-700 px-3 py-2 rounded-lg mt-3">
          <Info size={14} />
          <p className="text-xs">{t('dashboard.organization.auth_branding.preview_hint')}</p>
        </div>
      </div>

      {/* Unsplash Picker Modal */}
      {showUnsplashPicker && (
        <UnsplashImagePicker
          onSelect={handleUnsplashSelect}
          onClose={() => setShowUnsplashPicker(false)}
          isOpen={showUnsplashPicker}
        />
      )}
    </div>
  )
}
