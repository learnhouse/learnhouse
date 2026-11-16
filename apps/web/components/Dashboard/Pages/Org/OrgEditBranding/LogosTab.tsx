'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { AppWindow, ImageSquare, Panorama, Shapes } from '@phosphor-icons/react'
import { useOrg } from '@components/Contexts/OrgContext'
import { constructAcceptValue } from '@/lib/constants'
import { getOrgFaviconMediaDirectory } from '@services/media/media'
import {
  uploadOrganizationFavicon,
  uploadOrganizationLogo,
  uploadOrganizationSquareLogo,
} from '@services/settings/org'
import { getOrgSquareLogoUrl, getOrgWideLogoUrl } from '@components/Objects/Org/OrgSquareLogo'
import { SectionCard } from '@components/Dashboard/Shared/DashKit/DashKit'
import { ImageDropzone, SpecList, WhereItAppears, useAssetUpload } from './BrandingShared'
import { CertificateVignette, LoginPanelVignette, OrgSwitcherVignette } from './BrandingVignettes'

const ACCEPT = constructAcceptValue(['png', 'jpg'])

export function readFavicon(org: any): string {
  return (
    org?.config?.config?.customization?.general?.favicon_image ||
    org?.config?.config?.general?.favicon_image ||
    ''
  )
}

/**
 * The three logo uploads. Lifted to the Branding tab so the live preview
 * shows a freshly picked file before the upload finishes.
 */
export function useLogoUploads() {
  const { t } = useTranslation()
  const org = useOrg() as any

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

  const faviconFile = readFavicon(org)
  return {
    wide,
    square,
    favicon,
    wideUrl: wide.localUrl || getOrgWideLogoUrl(org),
    squareUrl: square.localUrl || getOrgSquareLogoUrl(org),
    faviconUrl: favicon.localUrl || (faviconFile ? getOrgFaviconMediaDirectory(org?.org_uuid, faviconFile) : null),
  }
}

export type LogoUploads = ReturnType<typeof useLogoUploads>

interface LogoTileProps {
  icon: React.ReactNode
  title: string
  description: string
  children: React.ReactNode
}

function LogoTile({ icon, title, description, children }: LogoTileProps) {
  return (
    <div className="flex flex-col rounded-xl p-4 ring-1 ring-inset ring-neutral-200/80 min-w-0">
      <div className="flex items-center gap-2 text-sm font-semibold text-neutral-900">
        <span className="text-neutral-400">{icon}</span>
        {title}
      </div>
      <p className="mt-1 mb-4 text-xs leading-relaxed text-neutral-500">{description}</p>
      <div className="mt-auto">{children}</div>
    </div>
  )
}

/** Wide logo, square logo and favicon, side by side. Uploads apply at once. */
export default function LogosTab({ uploads, welcome, authStyle, authScrim, textColor }: {
  uploads: LogoUploads
  welcome: string
  authStyle: React.CSSProperties
  authScrim: boolean
  textColor: 'light' | 'dark'
}) {
  const { t } = useTranslation()
  const org = useOrg() as any
  const { wide, square, favicon, wideUrl, squareUrl, faviconUrl } = uploads
  const v = (key: string) => t(`dashboard.organization.branding.vignettes.${key}`)

  return (
    <SectionCard
      icon={<Shapes size={18} />}
      title={t('dashboard.organization.branding.tabs.logos')}
      description={t('dashboard.organization.settings_ui.branding.logos_desc')}
    >
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <LogoTile
          icon={<Panorama size={16} />}
          title={t('dashboard.organization.branding.logos.wide.title')}
          description={t('dashboard.organization.branding.logos.wide.description')}
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
        </LogoTile>

        <LogoTile
          icon={<ImageSquare size={16} />}
          title={t('dashboard.organization.branding.logos.square.title')}
          description={t('dashboard.organization.branding.logos.square.description')}
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
        </LogoTile>

        <LogoTile
          icon={<AppWindow size={16} />}
          title={t('dashboard.organization.branding.logos.favicon.title')}
          description={t('dashboard.organization.branding.logos.favicon.description')}
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
        </LogoTile>
      </div>

      <WhereItAppears>
        <LoginPanelVignette
          squareUrl={squareUrl}
          wideUrl={wideUrl}
          name={org?.name}
          welcome={welcome}
          backgroundStyle={authStyle}
          textColor={textColor}
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
        <CertificateVignette wideUrl={wideUrl} squareUrl={squareUrl} name={org?.name} label={v('certificate')} />
      </WhereItAppears>
    </SectionCard>
  )
}
