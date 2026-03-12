export const dynamic = 'force-dynamic'
import { Metadata } from 'next'
import { getOrgCourses } from '@services/courses/courses'
import { getOrganizationContextInfo } from '@services/organizations/orgs'
import { getOrgCollections } from '@services/courses/collections'
import { getServerSession } from '@/lib/auth/server'
import { getOrgThumbnailMediaDirectory, getOrgLogoMediaDirectory, getOrgOgImageMediaDirectory } from '@services/media/media'
import { getCanonicalUrl, getOrgSeoConfig, buildPageTitle } from '@/lib/seo/utils'
import { JsonLd } from '@components/SEO/JsonLd'
import LandingClassic from '@components/Landings/LandingClassic'
import LandingCustom from '@components/Landings/LandingCustom'

type MetadataProps = {
  params: Promise<{ orgslug: string }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}

export async function generateMetadata(props: MetadataProps): Promise<Metadata> {
  const params = await props.params;
  // Get Org context information
  const org = await getOrganizationContextInfo(params.orgslug, {
    revalidate: 0,
    tags: ['organizations'],
  })

  const seoConfig = getOrgSeoConfig(org)
  const ogImageUrl = seoConfig.default_og_image
    ? getOrgOgImageMediaDirectory(org?.org_uuid, seoConfig.default_og_image)
    : null
  const imageUrl = ogImageUrl || getOrgThumbnailMediaDirectory(org?.org_uuid, org?.thumbnail_image)
  const canonical = getCanonicalUrl(params.orgslug, '/')
  const title = buildPageTitle('Home', org.name, seoConfig)
  const description = org.description || seoConfig.default_meta_description || ''

  // SEO
  return {
    title,
    description,
    robots: {
      index: true,
      follow: true,
      nocache: true,
      googleBot: {
        index: true,
        follow: true,
        'max-image-preview': 'large',
      },
    },
    alternates: {
      canonical,
    },
    ...(seoConfig.google_site_verification
      ? {
          verification: {
            google: seoConfig.google_site_verification,
          },
        }
      : {}),
    openGraph: {
      title,
      description,
      type: 'website',
      images: [
        {
          url: imageUrl,
          width: 800,
          height: 600,
          alt: org.name,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [imageUrl],
      ...(seoConfig.twitter_handle && { site: seoConfig.twitter_handle }),
    },
  }
}

const OrgHomePage = async (params: any) => {
  const orgslug = (await params.params).orgslug
  const session = await getServerSession()
  const access_token = session?.tokens?.access_token
  const courses = await getOrgCourses(
    orgslug,
    { revalidate: 0, tags: ['courses'] },
    access_token ?? undefined
  )
  const org = await getOrganizationContextInfo(orgslug, {
    revalidate: 0,
    tags: ['organizations'],
  })
  const org_id = org.id
  const collections = await getOrgCollections(
    org.id,
    access_token ?? undefined,
    { revalidate: 0, tags: ['courses'] }
  )

  // Check if custom landing is enabled (v2: customization.landing, v1: landing)
  const landingConfig = org.config?.config?.customization?.landing || org.config?.config?.landing
  const hasCustomLanding = landingConfig?.enabled

  const logoUrl = org?.logo_image ? getOrgLogoMediaDirectory(org.org_uuid, org.logo_image) : undefined
  const orgJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: org.name,
    description: org.description,
    url: getCanonicalUrl(orgslug, '/'),
    ...(logoUrl && { logo: logoUrl }),
  }

  return (
    <div className="w-full">
      <JsonLd data={orgJsonLd} />
      {hasCustomLanding ? (
        <LandingCustom
          landing={landingConfig}
          orgslug={orgslug}
        />
      ) : (
        <LandingClassic 
          courses={courses}
          collections={collections}
          orgslug={orgslug}
          org_id={org_id}
        />
      )}
    </div>
  )
}

export default OrgHomePage
