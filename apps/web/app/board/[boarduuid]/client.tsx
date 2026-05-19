'use client'

import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { getBoard } from '@services/boards/boards'
import { getOrganizationContextInfo } from '@services/organizations/orgs'
import BoardCanvas from '@components/Dashboard/Boards/BoardCanvas'

interface BoardCanvasClientProps {
  boardUuid: string
  accessToken: string
  orgslug: string
  username: string
}

export default function BoardCanvasClient({ boardUuid, accessToken, orgslug, username }: BoardCanvasClientProps) {
  const { data: board, isLoading, error } = useQuery({
    queryKey: queryKeys.boards.detail(boardUuid),
    queryFn: () => getBoard(boardUuid, accessToken),
    enabled: !!accessToken,
    staleTime: 60_000,
  })

  // Fetch org info to get org_uuid for media URLs in board blocks
  const { data: orgData } = useQuery({
    queryKey: queryKeys.org.detail(orgslug),
    queryFn: () => getOrganizationContextInfo(orgslug, null, accessToken),
    enabled: !!orgslug,
    staleTime: 60_000,
  })

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#f8f8f8]">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-300 border-t-black" />
      </div>
    )
  }

  if (error || !board) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#f8f8f8]">
        <p className="text-gray-500">Board not found or access denied.</p>
      </div>
    )
  }

  return (
    <BoardCanvas
      board={board}
      accessToken={accessToken}
      orgslug={orgslug}
      username={username}
      orgUuid={orgData?.org_uuid || ''}
    />
  )
}
