import { Metadata } from 'next'
import React from 'react'
import { cookies } from 'next/headers'
import { getServerSession } from '@/lib/auth/server'
import { redirect } from 'next/navigation'
import BoardCanvasClient from './client'
import ResourcePaywall from '@ee/components/Payments/ResourcePaywall'
import { getOrganizationContextInfo } from '@services/organizations/orgs'

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
  const orgslug = cookieStore.get('LH_org')?.value || ''

  // Require authentication to access board canvas. Bare /login only; the proxy
  // rewrites it to /auth/login with tenant context; an /orgs/{slug}/login path
  // isn't a real route (the /orgs prefix is an internal rewrite target) → 404.
  //
  // Redirect ONLY when there is no session at all. A session the server could
  // not resolve (`unresolved`: refresh cookie present, access token expired)
  // belongs to a signed-in user; bouncing them to /login here was signing
  // people out just for coming back after their 8-hour access token lapsed.
  // The client picks up the real token from the session context instead.
  if (!session) {
    redirect(`/login?redirect=/board/${params.boarduuid}`)
  }

  // Ensure board_uuid has the board_ prefix for the API
  const boardUuid = params.boarduuid.startsWith('board_')
    ? params.boarduuid
    : `board_${params.boarduuid}`

  const canvas = (
    <BoardCanvasClient
      boardUuid={boardUuid}
      accessToken={access_token}
      orgslug={orgslug}
      username={session?.user?.username || session?.user?.email || ''}
    />
  )

  // A board sold through a product opens for its buyers; others see what unlocks it.
  let orgId = 0
  try {
    orgId = orgslug ? (await getOrganizationContextInfo(orgslug, { revalidate: 120, tags: ['organizations'] }))?.id ?? 0 : 0
  } catch {
    orgId = 0
  }
  if (!orgId) return canvas
  return (
    <ResourcePaywall orgId={orgId} orgslug={orgslug} resourceUuid={boardUuid}>
      {canvas}
    </ResourcePaywall>
  )
}

export default BoardEditorPage
