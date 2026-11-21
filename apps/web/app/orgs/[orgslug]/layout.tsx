import type React from 'react'
import { Suspense } from 'react'
import { Metadata } from 'next'
import { OrgProvider } from '@components/Contexts/OrgContext'
import OrgLanguageSync from '@components/Contexts/OrgLanguageSync'
import NextTopLoader from 'nextjs-toploader'
import Toast from '@components/Objects/StyledElements/Toast/Toast'
import '@styles/globals.css'
import Footer from '@components/Footer/Footer'
import CompleteSignupFields from '@components/Auth/CompleteSignupFields'
import { getOrganizationContextInfo } from '@services/organizations/orgs'
import { assertOrgExists, isOrgNotFound } from '@/lib/org.server'
import { notFound } from 'next/navigation'
import { getOrgFaviconMediaDirectory, getOrgSquareLogoMediaDirectory } from '@services/media/media'
import { orgScriptsAllowedOnRequest } from '@/lib/orgScripts'
import AffiliateRefCapture from '@ee/components/Payments/Affiliates/AffiliateRefCapture'
import DemoInstanceBar from '@ee/components/DemoInstance/DemoInstanceBar'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ orgslug: string }>
}): Promise<Metadata> {
  const { orgslug } = await params
  try {
    const org = await getOrganizationContextInfo(orgslug, {
      revalidate: 86400,
      tags: ['organizations'],
    })
    const general = org?.config?.config?.customization?.general || org?.config?.config?.general || {}
    const faviconImage = general.favicon_image
    const squareLogo = general.square_logo_image
    const favicon = faviconImage ? getOrgFaviconMediaDirectory(org.org_uuid, faviconImage) : undefined
    // Home-screen icon: the square logo, else the favicon.
    const apple = squareLogo ? getOrgSquareLogoMediaDirectory(org.org_uuid, squareLogo) : favicon
    return {
      // Per-org web app manifest (name, colors, icons) served at the org's host.
      manifest: '/manifest.webmanifest',
      ...(org?.name ? { appleWebApp: { capable: true, title: org.name, statusBarStyle: 'default' } } : {}),
      ...(favicon || apple ? { icons: { ...(favicon ? { icon: favicon } : {}), ...(apple ? { apple } : {}) } } : {}),
    }
  } catch (error) {
    if (isOrgNotFound(error)) notFound()
    // A favicon lookup failure must not break the page's metadata.
  }
  return { manifest: '/manifest.webmanifest' }
}

export default async function RootLayout(props: {
  children: React.ReactNode
  /** Parallel route: JSON-LD for the current public page (see ./@seo). */
  seo: React.ReactNode
  params: Promise<{ orgslug: string }>
}) {
  const params = await props.params
  // Unknown slug → 404 (deduped with the metadata lookup). API outages are
  // swallowed so the client can still render and retry.
  const [allowOrgScripts] = await Promise.all([orgScriptsAllowedOnRequest(), assertOrgExists(params.orgslug)])

  return (
    <div>
      {/* Structured data lives outside the client-rendered page tree so it is
          in the server HTML; Suspense keeps it from delaying the first byte. */}
      <Suspense fallback={null}>{props.seo}</Suspense>
      <OrgProvider orgslug={params.orgslug}>
        <OrgLanguageSync />
        <NextTopLoader color="#2e2e2e" initialPosition={0.3} height={4} easing={'ease'} speed={500} showSpinner={false} />
        <Toast />
        <CompleteSignupFields />
        {/* ?ref=CODE visits: counted and kept for the affiliate program (EE). */}
        <Suspense fallback={null}>
          <AffiliateRefCapture />
        </Suspense>
        {props.children}
        {/* Demo instances only (EE): days left, checklist, usage tracking. */}
        <DemoInstanceBar />
        <Footer allowOrgScripts={allowOrgScripts} />
      </OrgProvider>
    </div>
  )
}
