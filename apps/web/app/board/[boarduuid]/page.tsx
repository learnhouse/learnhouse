import { Metadata } from 'next'
import React from 'react'
import { cookies } from 'next/headers'
import { getServerSession } from '@/lib/auth/server'
import BoardCanvasClient from './client'

type MetadataProps = {
  params: Promise<{ boarduuid: string }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}

export async function generateMetadata(_props: MetadataProps): Promise<Metadata> {
  return {
    title: 'Board',
    description: 'Collaborative board',
    robots: {
      index: false,
      follow: false,
    },
  }
}

async function BoardEditorPage(props: any) {
  const params = await props.params
  const session = await getServerSession()
  const access_token = session?.tokens?.access_token
  const cookieStore = await cookies()
  const orgslug = cookieStore.get('learnhouse_current_orgslug')?.value || cookieStore.get('learnhouse_orgslug')?.value || ''

  return (
    <BoardCanvasClient
      boardUuid={params.boarduuid}
      accessToken={access_token}
      orgslug={orgslug}
      username={session?.user?.username || session?.user?.email || 'Anonymous'}
    />
  )
}

export default BoardEditorPage
