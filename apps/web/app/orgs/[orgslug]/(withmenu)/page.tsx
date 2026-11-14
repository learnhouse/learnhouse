import { Metadata } from 'next'
import { getSeoContext } from '@/lib/seo/context.server'
import { buildListMetadata } from '@/lib/seo/pageMetadata'
import { verificationMetadata } from '@/lib/seo/meta'
import { getServerAPIUrl } from '@services/config/config'

// The home page's own search and sharing settings (page builder → Page),
// cached like the extra pages' metadata. Never the page itself: it renders on the client.
async function homeSettings(orgslug: string): Promise<{ title?: string; description?: string; image?: string; noindex?: boolean } | null> {
  try {
    const res = await fetch(`${getServerAPIUrl()}landing/public/${encodeURIComponent(orgslug)}?slug=`, { next: { revalidate: 300, tags: ['landing-pages'] } })
    if (!res.ok) return null
    const data = await res.json()
    return data?.mode === 'published' ? data?.doc?.page || null : null
  } catch {
    return null
  }
}
import HomeClient from './home-client'

type MetadataProps = {
  params: Promise<{ orgslug: string }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}

// Home: org defaults, robots switch and search engine verification tags.
export async function generateMetadata(props: MetadataProps): Promise<Metadata> {
  const { orgslug } = await props.params
  const ctx = await getSeoContext(orgslug)
  const own = await homeSettings(orgslug)
  const metadata = await buildListMetadata({ ctx, name: own?.title || 'Home', path: '/', description: own?.description, image: own?.image, noindex: !!own?.noindex })
  const verification = verificationMetadata(ctx.seo)
  return verification ? { ...metadata, verification } : metadata
}

const OrgHomePage = async (params: any) => {
  const orgslug = (await params.params).orgslug
  return <HomeClient orgslug={orgslug} />
}

export default OrgHomePage
