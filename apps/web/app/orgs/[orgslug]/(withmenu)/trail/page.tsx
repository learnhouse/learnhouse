import React from 'react'
import { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getOrganizationContextInfo } from '@services/organizations/orgs'
import { getServerSession } from '@/lib/auth/server'
import Trail from './trail'

export const dynamic = 'force-dynamic'

type MetadataProps = {
  params: Promise<{ orgslug: string }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}

export async function generateMetadata(props: MetadataProps): Promise<Metadata> {
  const params = await props.params;
  const org = await getOrganizationContextInfo(params.orgslug, {
    revalidate: 120,
    tags: ['organizations'],
  })
  return {
    title: 'Trail | ' + org.name,
    description:
      'Check your progress using trail and easily navigate through your courses.',
  }
}

const TrailPage = async (params: any) => {
  let orgslug = (await params.params).orgslug
  // The trail is personal: signed-out visitors go to login and come back here,
  // instead of a page of loading placeholders that never fill in. Browser-relative
  // path; the proxy adds the /orgs/{slug} prefix.
  if (!(await getServerSession())) {
    redirect('/login?redirect=/trail')
  }

  return (
    <div>
      <Trail orgslug={orgslug} />
    </div>
  )
}

export default TrailPage
