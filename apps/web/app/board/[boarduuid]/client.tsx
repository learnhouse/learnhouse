'use client'

import React from 'react'
import { getAPIUrl } from '@services/config/config'
import useSWR from 'swr'
import { swrFetcher } from '@services/utils/ts/requests'
import BoardCanvas from '@components/Dashboard/Boards/BoardCanvas'

interface BoardCanvasClientProps {
  boardUuid: string
  accessToken: string
  orgslug: string
  username: string
}

export default function BoardCanvasClient({ boardUuid, accessToken, orgslug, username }: BoardCanvasClientProps) {
  const { data: board, isLoading, error } = useSWR(
    accessToken ? `${getAPIUrl()}boards/${boardUuid}` : null,
    (url) => swrFetcher(url, accessToken)
  )

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
    />
  )
}
