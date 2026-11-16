import { Metadata } from 'next'
import { getSeoContext } from '@/lib/seo/context.server'
import { buildListMetadata } from '@/lib/seo/pageMetadata'
import { getServerAPIUrl } from '@services/config/config'
import ExtraPageClient from './page-client'

type Params = { params: Promise<{ orgslug: string; pageslug: string }> }

// Extra pages made with the page builder (/p/about). The page renders on the
// client like every public org page; only its title and description come
// from the server, through the usual metadata helpers.
async function pageMeta(orgslug: string, pageslug: string): Promise<{ title: string; description: string; image?: string; noindex?: boolean } | null> {
  try {
    const res = await fetch(`${getServerAPIUrl()}landing/public/${encodeURIComponent(orgslug)}?slug=${encodeURIComponent(pageslug)}`, {
      next: { revalidate: 300, tags: ['landing-pages'] },
    })
    if (!res.ok) return null
    const data = await res.json()
    const settings = data?.doc?.page || {}
    return { title: settings.title || data?.title || pageslug, description: settings.description || '', image: settings.image || undefined, noindex: !!settings.noindex }
  } catch {
    return null
  }
}

export async function generateMetadata(props: Params): Promise<Metadata> {
  const { orgslug, pageslug } = await props.params
  const ctx = await getSeoContext(orgslug)
  const meta = await pageMeta(orgslug, pageslug)
  return buildListMetadata({ ctx, name: meta?.title || pageslug, path: `/p/${pageslug}`, description: meta?.description, noindex: !meta || meta.noindex, image: meta?.image })
}

export default async function ExtraPage(props: Params) {
  const { orgslug, pageslug } = await props.params
  return <ExtraPageClient orgslug={orgslug} pageslug={pageslug} />
}
