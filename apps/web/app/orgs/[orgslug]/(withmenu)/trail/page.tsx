import React from 'react'
import { Metadata } from 'next'
import { getOrganizationContextInfo } from '@services/organizations/orgs'
import Trail from './trail'

export const dynamic = 'force-dynamic'

type MetadataProps = {
  params: Promise<{ orgslug: string }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}

export async function generateMetadata(props: MetadataProps): Promise<Metadata> {
  const params = await props.params;
  const org = await getOrganizationContextInfo(params.orgslug, {
    revalidate: 0,
    tags: ['organizations'],
  })
  return {
    title: 'Trail — ' + org.name,
    description:
      'Check your progress using trail and easily navigate through your courses.',
  }
}

const TrailPage = async (params: any) => {
  let orgslug = (await params.params).orgslug

  return (
    <div>
      <Trail orgslug={orgslug} />
    </div>
  )
}

export default TrailPage
