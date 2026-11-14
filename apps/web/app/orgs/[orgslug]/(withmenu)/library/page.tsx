import React from 'react'
import LibraryClient from './LibraryClient'
import { Metadata } from 'next'
import { getSeoContext } from '@/lib/seo/context.server'
import { buildListMetadata } from '@/lib/seo/pageMetadata'

type MetadataProps = {
  params: Promise<{ orgslug: string }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}

export async function generateMetadata(props: { params: Promise<{ orgslug: string }> }): Promise<Metadata> {
  const { orgslug } = await props.params
  const ctx = await getSeoContext(orgslug)
  return buildListMetadata({ ctx, name: 'Library', path: '/library', description: undefined, keywords: undefined })
}

const LibraryPage = async (params: any) => {
  const orgslug = (await params.params).orgslug
  return <LibraryClient orgslug={orgslug} />
}

export default LibraryPage
