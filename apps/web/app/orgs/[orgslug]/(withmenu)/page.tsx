import { Metadata } from 'next'
import { getOrganizationContextInfo } from '@services/organizations/orgs'
import { getOrgThumbnailMediaDirectory, getOrgOgImageMediaDirectory } from '@services/media/media'
import { getOrgSeoConfig, buildPageTitle } from '@/lib/seo/utils'
import { getServerCanonicalUrl } from '@/lib/seo/utils.server'
import { fallbackRobots, ssrMetadataFetch } from '@services/utils/ts/ssrMetadata'
import HomeClient from './home-client'

type MetadataProps = {
  params: Promise<{ orgslug: string }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}

export async function generateMetadata(props: MetadataProps): Promise<Metadata> {
  const params = await props.params;
  // Get Org context information.
  //
  // LEARNHOUSE-WEB-5P was exactly this call, unguarded: the API answered 503
  // for ten minutes and every request to /orgs/[orgslug] 500'd inside
  // generateMetadata on `org.name`. A metadata fetch must never be able to take
  // the route down — see services/utils/ts/ssrMetadata.ts for why the two
  // failure classes get different robots treatment.
  const { data: org, error: orgError } = await ssrMetadataFetch(
    '/orgs/[orgslug]',
    'getOrganizationContextInfo',
    getOrganizationContextInfo(params.orgslug, {
      revalidate: 120,
      tags: ['organizations'],
    })
  )

  if (!org) {
    return {
      title: 'LearnHouse',
      description: '',
      // noindex for a 404/403 org; no robots directive at all when the API just
      // fell over, so a blip cannot de-index a live org's home page.
      ...fallbackRobots(orgError),
    }
  }

  const seoConfig = getOrgSeoConfig(org)
  const ogImageUrl = seoConfig.default_og_image
    ? getOrgOgImageMediaDirectory(org?.org_uuid, seoConfig.default_og_image)
    : null
  const imageUrl = ogImageUrl || getOrgThumbnailMediaDirectory(org?.org_uuid, org?.thumbnail_image)
  const canonical = await getServerCanonicalUrl(params.orgslug, '/')
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
  return <HomeClient orgslug={orgslug} />
}

export default OrgHomePage
