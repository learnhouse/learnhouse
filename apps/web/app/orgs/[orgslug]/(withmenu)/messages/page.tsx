import React from 'react'
import { Metadata } from 'next'
import { getOrganizationContextInfo } from '@services/organizations/orgs'
import { getServerSession } from '@/lib/auth/server'
import MessagesClient from './messages'

type MetadataProps = {
  params: Promise<{ orgslug: string }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}

export async function generateMetadata(props: MetadataProps): Promise<Metadata> {
  const params = await props.params
  const session = await getServerSession()
  const access_token = session?.tokens?.access_token
  const org = await getOrganizationContextInfo(
    params.orgslug,
    { revalidate: 120, tags: ['organizations'] },
    access_token
  )
  return {
    title: 'Messages | ' + org.name,
    description: 'Messages, course announcements and AI agents.',
  }
}

const MessagesPage = async (params: any) => {
  const orgslug = (await params.params).orgslug
  return <MessagesClient orgslug={orgslug} />
}

export default MessagesPage
