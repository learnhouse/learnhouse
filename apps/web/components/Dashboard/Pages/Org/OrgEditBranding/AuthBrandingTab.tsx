'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'react-hot-toast'
import { useQueryClient } from '@tanstack/react-query'
import { Moon, PaintBrush, SignIn, Sun, UploadSimple } from '@phosphor-icons/react'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { constructAcceptValue } from '@/lib/constants'
import { uploadOrgAuthBackground } from '@services/settings/org'
import { queryKeys } from '@/lib/query/keys'
import AIImageButton from '@components/Objects/AI/AIImageButton'
import { usePlan } from '@components/Hooks/usePlan'
import { isWhiteLabelPlan } from '@components/Hooks/useLearnHouseBranding'
import {
  FieldLabel,
  SectionCard,
  SegmentedControl,
  TEXTAREA,
  buttonClass,
} from '@components/Dashboard/Shared/DashKit/DashKit'
import { AuthBrandingState, authBackgroundStyle } from './BrandingShared'
import { LoginPanelVignette } from './BrandingVignettes'

const ACCEPT = constructAcceptValue(['png', 'jpg', 'webp'])
const WELCOME_MAX = 200

type BackgroundType = AuthBrandingState['background_type']

/**
 * Sign-in page branding. Controlled: the Branding tab owns the draft and
 * saves it. Uploading a background is immediate (the file goes up at once)
 * but only becomes the sign-in background once the draft is saved.
 */
export default function AuthBrandingTab({
  value,
  onChange,
  localBackground,
  onLocalBackground,
  squareUrl,
  wideUrl,
  disabled,
}: {
  value: AuthBrandingState
  onChange: (_next: Partial<AuthBrandingState>) => void
  localBackground: string | null
  onLocalBackground: (_url: string | null) => void
  squareUrl?: string | null
  wideUrl?: string | null
  disabled?: boolean
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const org = useOrg() as any
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token
  // Enterprise orgs do not show the LearnHouse mark on the sign-in panel.
  const isWhiteLabel = isWhiteLabelPlan(usePlan())
  const [uploading, setUploading] = React.useState(false)
  const fileRef = React.useRef<HTMLInputElement>(null)

  const uploadBackground = async (file: File) => {
    onLocalBackground(URL.createObjectURL(file))
    setUploading(true)
    const toastId = toast.loading(t('dashboard.organization.auth_branding.uploading'))
    try {
      const response = await uploadOrgAuthBackground(org.id, file, accessToken)
      onChange({ background_type: 'custom', background_image: response.filename })
      toast.success(t('dashboard.organization.auth_branding.upload_success'), { id: toastId })
      queryClient.invalidateQueries({ queryKey: queryKeys.org.detail(org.slug) })
    } catch (_err) {
      toast.error(t('dashboard.organization.auth_branding.upload_error'), { id: toastId })
      onLocalBackground(null)
    } finally {
      setUploading(false)
    }
  }

  // Backgrounds picked from the retired Unsplash option keep rendering on the
  // sign-in page; here they count as a custom photo.
  const activeType: BackgroundType = value.background_type === 'unsplash' ? 'custom' : value.background_type
  const backgroundStyle = authBackgroundStyle(org, value, localBackground)
  const scrim = value.background_type !== 'gradient' && Boolean(value.background_image)

  return (
    <SectionCard
      icon={<SignIn size={18} />}
      title={t('dashboard.organization.branding.tabs.auth')}
      description={t('dashboard.organization.settings_ui.branding.auth_desc')}
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <div className="flex flex-col gap-5 min-w-0">
          <label className="block">
            <FieldLabel hint={`${value.welcome_message.length}/${WELCOME_MAX}`}>
              {t('dashboard.organization.branding.auth.message_title')}
            </FieldLabel>
            <textarea
              value={value.welcome_message}
              onChange={(e) => onChange({ welcome_message: e.target.value })}
              placeholder={t('dashboard.organization.auth_branding.welcome_placeholder')}
              rows={3}
              maxLength={WELCOME_MAX}
              disabled={disabled}
              className={TEXTAREA}
            />
            <p className="mt-1.5 text-xs text-neutral-500">{t('dashboard.organization.branding.auth.message_desc')}</p>
          </label>

          <div>
            <FieldLabel>{t('dashboard.organization.branding.auth.background_title')}</FieldLabel>
            <p className="-mt-0.5 mb-3 text-xs leading-relaxed text-neutral-500">
              {t('dashboard.organization.branding.auth.background_desc')}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <SegmentedControl<BackgroundType>
                value={activeType}
                ariaLabel={t('dashboard.organization.branding.auth.background_title')}
                options={[
                  {
                    key: 'gradient',
                    label: (
                      <>
                        <PaintBrush size={13} />
                        {t('dashboard.organization.auth_branding.bg_gradient')}
                      </>
                    ),
                  },
                  {
                    key: 'custom',
                    label: (
                      <>
                        <UploadSimple size={13} />
                        {t('dashboard.organization.auth_branding.bg_custom')}
                      </>
                    ),
                  },
                ]}
                onChange={(key) => {
                  if (disabled || uploading) return
                  if (key === 'gradient') {
                    onChange({ background_type: 'gradient', background_image: '' })
                    onLocalBackground(null)
                  } else {
                    fileRef.current?.click()
                  }
                }}
              />
              <AIImageButton
                onSelect={() => undefined}
                onSelectFile={uploadBackground}
                className={buttonClass('secondary', 'md')}
              />
            </div>
            <input
              ref={fileRef}
              type="file"
              id="authBackgroundInput"
              accept={ACCEPT}
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (file) uploadBackground(file)
              }}
            />
          </div>

          <div>
            <FieldLabel>{t('dashboard.organization.branding.auth.text_title')}</FieldLabel>
            <p className="-mt-0.5 mb-3 text-xs leading-relaxed text-neutral-500">
              {t('dashboard.organization.branding.auth.text_desc')}
            </p>
            <SegmentedControl<'light' | 'dark'>
              value={value.text_color}
              ariaLabel={t('dashboard.organization.branding.auth.text_title')}
              options={(['light', 'dark'] as const).map((key) => {
                const Icon = key === 'light' ? Sun : Moon
                return {
                  key,
                  label: (
                    <>
                      <Icon size={13} />
                      {t(`dashboard.organization.auth_branding.text_${key}`)}
                    </>
                  ),
                }
              })}
              onChange={(key) => !disabled && onChange({ text_color: key })}
            />
          </div>
        </div>

        <div className="min-w-0">
          <LoginPanelVignette
            large
            squareUrl={squareUrl}
            wideUrl={wideUrl}
            name={org?.name}
            welcome={value.welcome_message || t('dashboard.organization.auth_branding.default_welcome')}
            backgroundStyle={backgroundStyle}
            textColor={value.text_color}
            scrim={scrim}
            showLearnHouseMark={!isWhiteLabel}
            label={t('dashboard.organization.auth_branding.preview')}
          />
          <p className="mt-2 text-xs text-neutral-400">{t('dashboard.organization.branding.auth.preview_note')}</p>
        </div>
      </div>
    </SectionCard>
  )
}
