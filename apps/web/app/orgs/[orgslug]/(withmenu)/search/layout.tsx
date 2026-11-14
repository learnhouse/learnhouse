import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { getSeoContext } from '@/lib/seo/context.server'
import { buildPageTitle } from '@/lib/seo/utils'

// Internal search results are thin, endless and personalised: keep them out of
// the index (Google's guidance), but let crawlers follow links to real pages.
export async function generateMetadata({ params }: { params: Promise<{ orgslug: string }> }): Promise<Metadata> {
  const { orgslug } = await params
  const ctx = await getSeoContext(orgslug)
  return { title: buildPageTitle('Search', ctx.org?.name || '', ctx.seo), robots: { index: false, follow: true } }
}

export default function SearchLayout({ children }: { children: ReactNode }) {
  return children
}
