'use client'
import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { toast } from 'react-hot-toast'
import { useQueryClient } from '@tanstack/react-query'
import { Eye, Image as ImageIcon, Palette, SignIn, SquaresFour } from '@phosphor-icons/react'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { AuthBrandingConfig, updateOrgAuthBrandingConfig, updateOrgThemeConfig } from '@services/settings/org'
import { revalidateTags } from '@services/utils/ts/requests'
import { queryKeys } from '@/lib/query/keys'
import { SectionCard, StickySaveBar } from '@components/Dashboard/Shared/DashKit/DashKit'
import { SubTabPanel, SubTabs, useSubTab } from '@components/Dashboard/Shared/DashKit/SubTabs'
import { useDraft } from '@components/Dashboard/Pages/Org/OrgSettingsShared/orgSettingsUi'
import { OrgThemeState, ThemeOptions, readOrgTheme, serializeThemeState, themeStatesEqual } from '@/lib/theme/orgTheme'
import LogosTab, { useLogoUploads } from './LogosTab'
import ThemeStudio from './ThemeStudio'
import ThemePreview from './ThemePreview'
import AuthBrandingTab from './AuthBrandingTab'
import PreviewsTab from './PreviewsTab'
import { AuthBrandingState, authBackgroundStyle, readAuthBranding } from './BrandingShared'
import { BrowserTabVignette, SidebarVignette } from './BrandingVignettes'

// Shapes and typography live inside the theme studio now; old ?section=style
// or ?section=type links fall back to it.
const SECTIONS = ['theme', 'logos', 'signin', 'previews'] as const
type Section = (typeof SECTIONS)[number]

/** The theme draft: saved value + nested patching (any edit marks it custom). */
function useThemeDraft(saved: OrgThemeState) {
  const savedKey = JSON.stringify(saved)
  const [draft, setDraft] = useState<OrgThemeState>(saved)
  const [seenKey, setSeenKey] = useState(savedKey)
  if (seenKey !== savedKey) {
    setSeenKey(savedKey)
    setDraft(saved)
  }
  const patch = (next: { color?: string; font?: string; theme?: Partial<ThemeOptions> }) =>
    setDraft((prev) => ({
      color: next.color ?? prev.color,
      font: next.font ?? prev.font,
      theme: { ...prev.theme, ...next.theme, preset: next.theme?.preset ?? (prev.theme.preset ? 'custom' : '') },
    }))
  return {
    draft,
    patch,
    replace: setDraft,
    reset: () => setDraft(JSON.parse(savedKey)),
    dirty: !themeStatesEqual(draft, saved),
  }
}

/**
 * Organization branding: theme (presets, colors, header, background), shapes,
 * typography, logos, the sign-in page and explore previews, as sub-tabs, with
 * a live preview of a learner page docked beside them. Uploads apply at once;
 * the theme and sign-in settings save together from one bar.
 */
export default function OrgEditBranding() {
  const { t } = useTranslation()
  const router = useRouter()
  const queryClient = useQueryClient()
  const org = useOrg() as any
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token
  const plan = org?.config?.config?.plan || org?.config?.config?.cloud?.plan

  const [section, setSection] = useSubTab<Section>('theme', SECTIONS, { rememberAs: 'org-settings:branding' })
  const uploads = useLogoUploads()
  const theme = useThemeDraft(readOrgTheme(org))
  const auth = useDraft<AuthBrandingState>(readAuthBranding(org))
  const [localBackground, setLocalBackground] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const save = async () => {
    setSaving(true)
    const toastId = toast.loading(t('dashboard.organization.settings.updating'))
    try {
      const calls: Promise<unknown>[] = []
      if (theme.dirty) calls.push(updateOrgThemeConfig(org.id, serializeThemeState(theme.draft) as any, accessToken))
      if (auth.dirty) {
        const a = auth.draft
        const isUnsplash = a.background_type === 'unsplash'
        const config: AuthBrandingConfig = {
          welcome_message: a.welcome_message,
          background_type: a.background_type,
          background_image: a.background_image,
          text_color: a.text_color,
          unsplash_photographer_name: isUnsplash ? a.unsplash_photographer_name : '',
          unsplash_photographer_url: isUnsplash ? a.unsplash_photographer_url : '',
          unsplash_photo_url: isUnsplash ? a.unsplash_photo_url : '',
        }
        calls.push(updateOrgAuthBrandingConfig(org.id, config, accessToken))
      }
      await Promise.all(calls)
      await revalidateTags(['organizations'], org.slug)
      await queryClient.invalidateQueries({ queryKey: queryKeys.org.detail(org.slug) })
      toast.success(t('dashboard.organization.settings.update_success'), { id: toastId })
      router.refresh()
    } catch (_err) {
      toast.error(t('dashboard.organization.settings.update_error'), { id: toastId })
    } finally {
      setSaving(false)
    }
  }

  const discard = () => {
    theme.reset()
    auth.reset()
    setLocalBackground(null)
  }

  const savedAuth = readAuthBranding(org)
  const welcome = auth.draft.welcome_message || t('dashboard.organization.auth_branding.default_welcome')
  const themeDirty = theme.dirty
  // The live preview sits beside the theme tabs and the logos (whose header
  // it shows); the sign-in and previews tabs carry their own previews.
  const showAside = section === 'logos'

  return (
    <>
      <SubTabs<Section>
        value={section}
        onChange={setSection}
        ariaLabel={t('dashboard.organization.branding.title')}
        items={[
          { key: 'theme', label: t('dashboard.organization.branding.tabs.theme'), icon: <Palette size={15} />, dirty: themeDirty },
          { key: 'logos', label: t('dashboard.organization.branding.tabs.logos'), icon: <SquaresFour size={15} /> },
          { key: 'signin', label: t('dashboard.organization.branding.tabs.auth'), icon: <SignIn size={15} />, dirty: auth.dirty },
          { key: 'previews', label: t('dashboard.organization.branding.tabs.previews'), icon: <ImageIcon size={15} /> },
        ]}
      >
        <div className={`grid items-start gap-5 ${showAside ? 'xl:grid-cols-[minmax(0,1fr)_380px]' : ''}`}>
          <div className="flex min-w-0 flex-col gap-5">
            <SubTabPanel tab="theme">
              <ThemeStudio value={theme.draft} onChange={theme.patch} onReplace={theme.replace} disabled={saving} orgName={org?.name} logoUrl={uploads.squareUrl || uploads.wideUrl} />
            </SubTabPanel>
            <SubTabPanel tab="logos">
              <LogosTab
                uploads={uploads}
                welcome={welcome}
                authStyle={authBackgroundStyle(org, savedAuth)}
                authScrim={savedAuth.background_type !== 'gradient' && Boolean(savedAuth.background_image)}
                textColor={savedAuth.text_color}
              />
            </SubTabPanel>
            <SubTabPanel tab="signin">
              <AuthBrandingTab
                value={auth.draft}
                onChange={auth.patch}
                localBackground={localBackground}
                onLocalBackground={setLocalBackground}
                squareUrl={uploads.squareUrl}
                wideUrl={uploads.wideUrl}
                disabled={saving}
              />
            </SubTabPanel>
            <SubTabPanel tab="previews" unmountWhenHidden>
              <PreviewsTab />
            </SubTabPanel>
          </div>

          {showAside && (
            <aside className="min-w-0 xl:sticky xl:top-4">
              <SectionCard
                icon={<Eye size={18} />}
                title={t('dashboard.organization.branding.theme.preview')}
                description={t('dashboard.organization.settings_ui.branding.preview_desc')}
              >
                <div className="flex flex-col gap-5">
                  <ThemePreview state={theme.draft} orgName={org?.name} logoUrl={uploads.wideUrl} />
                  {section === 'logos' && (
                    <div className="flex flex-wrap gap-4">
                      <BrowserTabVignette
                        faviconUrl={uploads.faviconUrl}
                        name={org?.name}
                        label={t('dashboard.organization.branding.vignettes.browser_tab')}
                      />
                      <SidebarVignette
                        squareUrl={uploads.squareUrl}
                        wideUrl={uploads.wideUrl}
                        name={org?.name}
                        plan={plan}
                        label={t('dashboard.organization.branding.vignettes.sidebar')}
                      />
                    </div>
                  )}
                </div>
              </SectionCard>
            </aside>
          )}
        </div>
      </SubTabs>

      <StickySaveBar visible={themeDirty || auth.dirty || saving} saving={saving} onSave={save} onDiscard={discard} />
    </>
  )
}
