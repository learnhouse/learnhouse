'use client'
import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { toast } from 'react-hot-toast'
import { useQueryClient } from '@tanstack/react-query'
import { Drop, TextAa, X } from '@phosphor-icons/react'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { updateOrgColorConfig, updateOrgFontConfig } from '@services/settings/org'
import { revalidateTags } from '@services/utils/ts/requests'
import { queryKeys } from '@/lib/query/keys'
import { Input } from '@components/ui/input'
import { Button } from '@components/ui/button'
import { getOrgWideLogoUrl } from '@components/Objects/Org/OrgSquareLogo'
import FontSelector from './FontSelector'
import { BrandingSection, SaveBar } from './BrandingShared'
import { PublicHeaderVignette } from './BrandingVignettes'

const SWATCHES = ['#111827', '#1d4ed8', '#0f766e', '#7c3aed', '#be123c', '#d97706', '#f5f5f4']

export default function ThemeTab() {
  const { t } = useTranslation()
  const router = useRouter()
  const queryClient = useQueryClient()
  const org = useOrg() as any
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token
  const general = org?.config?.config?.customization?.general || org?.config?.config?.general || {}

  const [primaryColor, setPrimaryColor] = useState<string>(general.color || '')
  const [selectedFont, setSelectedFont] = useState<string>(general.font || '')
  const [saving, setSaving] = useState(false)

  const dirty = primaryColor !== (general.color || '') || selectedFont !== (general.font || '')

  const handleSave = async () => {
    setSaving(true)
    const toastId = toast.loading(t('dashboard.organization.settings.updating'))
    try {
      await Promise.all([
        updateOrgColorConfig(org.id, primaryColor, accessToken),
        updateOrgFontConfig(org.id, selectedFont, accessToken),
      ])
      await revalidateTags(['organizations'], org.slug)
      queryClient.invalidateQueries({ queryKey: queryKeys.org.detail(org.slug) })
      toast.success(t('dashboard.organization.settings.update_success'), { id: toastId })
      router.refresh()
    } catch (_err) {
      toast.error(t('dashboard.organization.settings.update_error'), { id: toastId })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <BrandingSection
        icon={Drop}
        title={t('dashboard.organization.branding.theme.color_title')}
        description={t('dashboard.organization.branding.theme.color_desc')}
      >
        <div className="flex flex-wrap items-center gap-3">
          <label className="relative h-10 w-10 shrink-0 cursor-pointer overflow-hidden rounded-lg ring-1 ring-inset ring-black/10">
            <input
              type="color"
              aria-label={t('dashboard.organization.theme.primary_color')}
              value={primaryColor || '#ffffff'}
              onChange={(e) => setPrimaryColor(e.target.value)}
              className="absolute -inset-2 h-[calc(100%+16px)] w-[calc(100%+16px)] cursor-pointer border-0 p-0"
            />
          </label>
          <Input
            type="text"
            value={primaryColor}
            onChange={(e) => setPrimaryColor(e.target.value)}
            placeholder={t('dashboard.organization.branding.theme.no_color')}
            className="h-10 w-32 bg-white font-mono text-sm uppercase"
            maxLength={7}
          />
          {primaryColor && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setPrimaryColor('')}
              disabled={saving}
              className="h-10 px-2 text-gray-400 hover:text-gray-700"
            >
              <X size={14} weight="bold" className="me-1" />
              {t('dashboard.organization.branding.theme.clear')}
            </Button>
          )}
        </div>
        <div className="mt-3 flex items-center gap-1.5">
          {SWATCHES.map((hex) => (
            <button
              key={hex}
              type="button"
              aria-label={hex}
              onClick={() => setPrimaryColor(hex)}
              className={`h-6 w-6 rounded-full ring-1 ring-inset ring-black/10 transition-transform hover:scale-110 ${
                primaryColor.toLowerCase() === hex ? 'ring-2 ring-black ring-offset-2' : ''
              }`}
              style={{ backgroundColor: hex }}
            />
          ))}
        </div>
      </BrandingSection>

      <BrandingSection
        icon={TextAa}
        title={t('dashboard.organization.branding.theme.font_title')}
        description={t('dashboard.organization.branding.theme.font_desc')}
      >
        <FontSelector value={selectedFont} onChange={setSelectedFont} />
      </BrandingSection>

      <section className="px-5 py-7 border-t border-gray-100">
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
          {t('dashboard.organization.branding.theme.preview')}
        </p>
        <PublicHeaderVignette
          large
          wideUrl={getOrgWideLogoUrl(org)}
          name={org?.name}
          primaryColor={primaryColor}
          font={selectedFont}
          label={t('dashboard.organization.branding.vignettes.public_header')}
        />
      </section>

      <SaveBar onSave={handleSave} saving={saving} disabled={!dirty} note={t('dashboard.organization.branding.theme.note')} />
    </div>
  )
}
