import React from 'react'
import Courses from './courses'
import { Metadata } from 'next'
import { getSeoContext } from '@/lib/seo/context.server'
import { buildListMetadata, seoAlternates } from '@/lib/seo/pageMetadata'
import { featureIndexable } from '@/lib/seo/meta'

type MetadataProps = {
  params: Promise<{ orgslug: string }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}

export async function generateMetadata(props: { params: Promise<{ orgslug: string }> }): Promise<Metadata> {
  const { orgslug } = await props.params
  const ctx = await getSeoContext(orgslug)
  const indexable = featureIndexable(ctx.seo, 'courses')
  return buildListMetadata({
    ctx,
    name: 'Courses',
    path: '/courses',
    description: undefined,
    keywords: `${ctx.org?.name}, courses, online courses, learning`,
    noindex: !indexable,
    alternateTypes: await seoAlternates(ctx, { indexable, feed: '/courses/' }),
  })
}

const CoursesPage = async (params: any) => {
  const orgslug = (await params.params).orgslug
  return <Courses orgslug={orgslug} />
}

export default CoursesPage
