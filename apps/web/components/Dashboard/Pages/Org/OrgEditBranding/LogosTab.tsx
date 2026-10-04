'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { AppWindow, ImageSquare, Panorama } from '@phosphor-icons/react'
import { useOrg } from '@components/Contexts/OrgContext'
import { constructAcceptValue } from '@/lib/constants'
import { getOrgFaviconMediaDirectory } from '@services/media/media'
import {
  uploadOrganizationFavicon,
  uploadOrganizationLogo,
  uploadOrganizationSquareLogo,
} from '@services/settings/org'
import { getOrgSquareLogoUrl, getOrgWideLogoUrl } from '@components/Objects/Org/OrgSquareLogo'
import { BrandingSection, ImageDropzone, SpecList, useAssetUpload, readAuthBranding, authBackgroundStyle } from './BrandingShared'
import {
  BrowserTabVignette,
  CertificateVignette,
  LoginPanelVignette,
  OrgSwitcherVignette,
  PublicHeaderVignette,
  SidebarVignette,
} from './BrandingVignettes'

const ACCEPT = constructAcceptValue(['png', 'jpg'])

export function readFavicon(org: any): string {
  return (
    org?.config?.config?.customization?.general?.favicon_image ||
    org?.config?.config?.general?.favicon_image ||
    ''
  )
}

export default function LogosTab() {
  const { t } = useTranslation()
  const org = useOrg() as any
  const general = org?.config?.config?.customization?.general || org?.config?.config?.general || {}
  const plan = org?.config?.config?.plan || org?.config?.config?.cloud?.plan

  const wide = useAssetUpload({
    upload: uploadOrganizationLogo,
    loading: t('dashboard.organization.branding.logos.toasts.uploading'),
    success: t('dashboard.organization.branding.logos.toasts.wide_success'),
    error: t('dashboard.organization.branding.logos.toasts.wide_error'),
  })
  const square = useAssetUpload({
    upload: uploadOrganizationSquareLogo,
    loading: t('dashboard.organization.branding.logos.toasts.uploading'),
    success: t('dashboard.organization.branding.logos.toasts.square_success'),
    error: t('dashboard.organization.branding.logos.toasts.square_error'),
  })
  const favicon = useAssetUpload({
    upload: uploadOrganizationFavicon,
    loading: t('dashboard.organization.branding.logos.toasts.uploading'),
    success: t('dashboard.organization.branding.logos.toasts.favicon_success'),
    error: t('dashboard.organization.branding.logos.toasts.favicon_error'),
  })

  const wideUrl = wide.localUrl || getOrgWideLogoUrl(org)
  const squareUrl = square.localUrl || getOrgSquareLogoUrl(org)
  const faviconFile = readFavicon(org)
  const faviconUrl = favicon.localUrl || (faviconFile ? getOrgFaviconMediaDirectory(org?.org_uuid, faviconFile) : null)

  const auth = readAuthBranding(org)
  const authStyle = authBackgroundStyle(org, auth)
  const authScrim = auth.background_type !== 'gradient' && Boolean(auth.background_image)

  const v = (key: string) => t(`dashboard.organization.branding.vignettes.${key}`)

  return (
    <div>
      <BrandingSection
        icon={Panorama}
        title={t('dashboard.organization.branding.logos.wide.title')}
        description={t('dashboard.organization.branding.logos.wide.description')}
        aside={
          <>
            <PublicHeaderVignette
              wideUrl={wideUrl}
              name={org?.name}
              primaryColor={general.color || ''}
              font={general.font || ''}
              label={v('public_header')}
            />
            <CertificateVignette wideUrl={wideUrl} squareUrl={squareUrl} name={org?.name} label={v('certificate')} />
          </>
        }
      >
        <ImageDropzone
          id="wideLogoInput"
          shape="wide"
          currentUrl={wideUrl}
          accept={ACCEPT}
          uploading={wide.uploading}
          onFile={wide.handleFile}
          emptyLabel={t('dashboard.organization.branding.logos.wide.add')}
          replaceLabel={t('dashboard.organization.branding.logos.wide.replace')}
        />
        <SpecList
          items={[
            t('dashboard.organization.branding.specs.formats'),
            t('dashboard.organization.branding.specs.wide_size'),
            t('dashboard.organization.branding.specs.transparent_png'),
            t('dashboard.organization.branding.specs.max_size'),
          ]}
        />
      </BrandingSection>

      <BrandingSection
        icon={ImageSquare}
        title={t('dashboard.organization.branding.logos.square.title')}
        description={t('dashboard.organization.branding.logos.square.description')}
        aside={
          <>
            <LoginPanelVignette
              squareUrl={squareUrl}
              wideUrl={wideUrl}
              name={org?.name}
              welcome={auth.welcome_message || t('dashboard.organization.auth_branding.default_welcome')}
              backgroundStyle={authStyle}
              textColor={auth.text_color}
              scrim={authScrim}
              label={v('sign_in')}
            />
            <OrgSwitcherVignette
              squareUrl={squareUrl}
              wideUrl={wideUrl}
              name={org?.name}
              description={org?.description}
              label={v('org_switcher')}
            />
            <SidebarVignette squareUrl={squareUrl} wideUrl={wideUrl} name={org?.name} plan={plan} label={v('sidebar')} />
          </>
        }
      >
        <ImageDropzone
          id="squareLogoInput"
          shape="square"
          currentUrl={squareUrl}
          accept={ACCEPT}
          uploading={square.uploading}
          onFile={square.handleFile}
          emptyLabel={t('dashboard.organization.branding.logos.square.add')}
          replaceLabel={t('dashboard.organization.branding.logos.square.replace')}
          inheritedNote={!squareUrl && wideUrl ? t('dashboard.organization.branding.logos.square.inherited') : undefined}
        />
        <SpecList
          items={[
            t('dashboard.organization.branding.specs.formats'),
            t('dashboard.organization.branding.specs.square_size'),
            t('dashboard.organization.branding.specs.max_size'),
          ]}
        />
      </BrandingSection>

      <BrandingSection
        icon={AppWindow}
        title={t('dashboard.organization.branding.logos.favicon.title')}
        description={t('dashboard.organization.branding.logos.favicon.description')}
        aside={<BrowserTabVignette faviconUrl={faviconUrl} name={org?.name} label={v('browser_tab')} />}
      >
        <ImageDropzone
          id="faviconInput"
          shape="icon"
          currentUrl={faviconUrl}
          accept={ACCEPT}
          uploading={favicon.uploading}
          onFile={favicon.handleFile}
          emptyLabel={t('dashboard.organization.branding.logos.favicon.add')}
          replaceLabel={t('dashboard.organization.branding.logos.favicon.replace')}
        />
        <SpecList
          items={[
            t('dashboard.organization.branding.specs.formats'),
            t('dashboard.organization.branding.specs.favicon_size'),
            t('dashboard.organization.branding.specs.max_size'),
          ]}
        />
      </BrandingSection>
    </div>
  )
}
