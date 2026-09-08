'use client'
import React, { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { toast } from 'react-hot-toast'
import { useQueryClient } from '@tanstack/react-query'
import { ChatCenteredText, Image as ImageIcon, Moon, PaintBrush, Sun, TextAa, UploadSimple } from '@phosphor-icons/react'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { constructAcceptValue } from '@/lib/constants'
import { cn } from '@/lib/utils'
import { AuthBrandingConfig, updateOrgAuthBrandingConfig, uploadOrgAuthBackground } from '@services/settings/org'
import { revalidateTags } from '@services/utils/ts/requests'
import { queryKeys } from '@/lib/query/keys'
import { Textarea } from '@components/ui/textarea'
import UnsplashImagePicker, { UnsplashPhotoMeta } from '@components/Dashboard/Pages/Course/EditCourseGeneral/UnsplashImagePicker'
import AIImageButton from '@components/Objects/AI/AIImageButton'
import { usePlan } from '@components/Hooks/usePlan'
import { getOrgSquareLogoUrl, getOrgWideLogoUrl } from '@components/Objects/Org/OrgSquareLogo'
import { AuthBrandingState, BrandingSection, SaveBar, authBackgroundStyle, readAuthBranding } from './BrandingShared'
import { LoginPanelVignette } from './BrandingVignettes'

const ACCEPT = constructAcceptValue(['png', 'jpg', 'webp'])

type BackgroundType = AuthBrandingState['background_type']

export default function AuthBrandingTab() {
  const { t } = useTranslation()
  const router = useRouter()
  const queryClient = useQueryClient()
  const org = useOrg() as any
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token
  // Enterprise orgs do not show the LearnHouse mark on the sign-in panel.
  const isEnterprise = usePlan() === 'enterprise'

  const [state, setState] = useState<AuthBrandingState>(() => readAuthBranding(org))
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [showUnsplash, setShowUnsplash] = useState(false)
  const [localBackground, setLocalBackground] = useState<string | null>(null)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState(readAuthBranding(org))
  }, [org])

  const patch = (next: Partial<AuthBrandingState>) => setState((prev) => ({ ...prev, ...next }))

  const handleSave = async () => {
    setSaving(true)
    const toastId = toast.loading(t('dashboard.organization.auth_branding.saving'))
    try {
      const isUnsplash = state.background_type === 'unsplash'
      const config: AuthBrandingConfig = {
        welcome_message: state.welcome_message,
        background_type: state.background_type,
        background_image: state.background_image,
        text_color: state.text_color,
        unsplash_photographer_name: isUnsplash ? state.unsplash_photographer_name : '',
        unsplash_photographer_url: isUnsplash ? state.unsplash_photographer_url : '',
        unsplash_photo_url: isUnsplash ? state.unsplash_photo_url : '',
      }
      await updateOrgAuthBrandingConfig(org.id, config, accessToken)
      await revalidateTags(['organizations'], org.slug)
      queryClient.invalidateQueries({ queryKey: queryKeys.org.detail(org.slug) })
      toast.success(t('dashboard.organization.auth_branding.save_success'), { id: toastId })
      router.refresh()
    } catch (_err) {
      toast.error(t('dashboard.organization.auth_branding.save_error'), { id: toastId })
    } finally {
      setSaving(false)
    }
  }

  const handleBackgroundUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setLocalBackground(URL.createObjectURL(file))
    setUploading(true)
    const toastId = toast.loading(t('dashboard.organization.auth_branding.uploading'))
    try {
      const response = await uploadOrgAuthBackground(org.id, file, accessToken)
      patch({ background_type: 'custom', background_image: response.filename })
      toast.success(t('dashboard.organization.auth_branding.upload_success'), { id: toastId })
      queryClient.invalidateQueries({ queryKey: queryKeys.org.detail(org.slug) })
    } catch (_err) {
      toast.error(t('dashboard.organization.auth_branding.upload_error'), { id: toastId })
      setLocalBackground(null)
    } finally {
      setUploading(false)
    }
  }

  const handleUnsplashSelect = (imageUrl: string, meta?: UnsplashPhotoMeta) => {
    patch({
      background_type: 'unsplash',
      background_image: imageUrl,
      unsplash_photographer_name: meta?.photographer_name || '',
      unsplash_photographer_url: meta?.photographer_url || '',
      unsplash_photo_url: meta?.photo_url || '',
    })
    setLocalBackground(null)
    setShowUnsplash(false)
  }

  const backgroundOptions: { type: BackgroundType; label: string; icon: React.ElementType; onClick: () => void }[] = [
    {
      type: 'gradient',
      label: t('dashboard.organization.auth_branding.bg_gradient'),
      icon: PaintBrush,
      onClick: () => {
        patch({ background_type: 'gradient', background_image: '' })
        setLocalBackground(null)
      },
    },
    {
      type: 'custom',
      label: t('dashboard.organization.auth_branding.bg_custom'),
      icon: UploadSimple,
      onClick: () => document.getElementById('authBackgroundInput')?.click(),
    },
    {
      type: 'unsplash',
      label: t('dashboard.organization.auth_branding.bg_unsplash'),
      icon: ImageIcon,
      onClick: () => setShowUnsplash(true),
    },
  ]

  const backgroundStyle = authBackgroundStyle(org, state, localBackground)
  const scrim = state.background_type !== 'gradient' && Boolean(state.background_image)

  return (
    <div className="grid lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <div>
        <BrandingSection
          icon={ChatCenteredText}
          title={t('dashboard.organization.branding.auth.message_title')}
          description={t('dashboard.organization.branding.auth.message_desc')}
        >
          <Textarea
            value={state.welcome_message}
            onChange={(e) => patch({ welcome_message: e.target.value })}
            placeholder={t('dashboard.organization.auth_branding.welcome_placeholder')}
            className="min-h-[80px] w-full max-w-md bg-white"
            maxLength={200}
          />
        </BrandingSection>

        <BrandingSection
          icon={PaintBrush}
          title={t('dashboard.organization.branding.auth.background_title')}
          description={t('dashboard.organization.branding.auth.background_desc')}
        >
          <div className="grid max-w-md grid-cols-3 gap-2">
            {backgroundOptions.map((option) => {
              const active = state.background_type === option.type
              return (
                <button
                  key={option.type}
                  type="button"
                  onClick={option.onClick}
                  disabled={uploading}
                  className={cn(
                    'flex flex-col items-center justify-center gap-1.5 rounded-xl border px-2 py-3 text-sm transition-colors',
                    active ? 'border-black bg-black text-white' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                  )}
                >
                  <option.icon size={18} weight={active ? 'fill' : 'regular'} />
                  <span className="text-xs font-medium">{option.label}</span>
                </button>
              )
            })}
          </div>
          <input type="file" id="authBackgroundInput" accept={ACCEPT} className="hidden" onChange={handleBackgroundUpload} />
          <div className="mt-2 max-w-md">
            <AIImageButton
              onSelect={(url) => handleUnsplashSelect(url)}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50"
            />
          </div>
        </BrandingSection>

        <BrandingSection
          icon={TextAa}
          title={t('dashboard.organization.branding.auth.text_title')}
          description={t('dashboard.organization.branding.auth.text_desc')}
        >
          <div className="flex max-w-md gap-2">
            {(['light', 'dark'] as const).map((value) => {
              const active = state.text_color === value
              const Icon = value === 'light' ? Sun : Moon
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => patch({ text_color: value })}
                  className={cn(
                    'flex flex-1 items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors',
                    active ? 'border-black bg-black text-white' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                  )}
                >
                  <Icon size={16} weight={active ? 'fill' : 'regular'} />
                  {t(`dashboard.organization.auth_branding.text_${value}`)}
                </button>
              )
            })}
          </div>
        </BrandingSection>
      </div>

      <div className="px-5 py-7 lg:border-s lg:border-gray-100">
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
          {t('dashboard.organization.auth_branding.preview')}
        </p>
        <LoginPanelVignette
          large
          squareUrl={getOrgSquareLogoUrl(org)}
          wideUrl={getOrgWideLogoUrl(org)}
          name={org?.name}
          welcome={state.welcome_message || t('dashboard.organization.auth_branding.default_welcome')}
          backgroundStyle={backgroundStyle}
          textColor={state.text_color}
          scrim={scrim}
          showLearnHouseMark={!isEnterprise}
          label={t('dashboard.organization.branding.vignettes.sign_in')}
        />
        <p className="mt-3 text-xs text-gray-400">{t('dashboard.organization.branding.auth.preview_note')}</p>
      </div>

      <div className="lg:col-span-2">
        <SaveBar onSave={handleSave} saving={saving} disabled={uploading} />
      </div>

      {showUnsplash && (
        <UnsplashImagePicker onSelect={handleUnsplashSelect} onClose={() => setShowUnsplash(false)} isOpen={showUnsplash} />
      )}
    </div>
  )
}
