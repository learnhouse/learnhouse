'use client'

import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { getBoard } from '@services/boards/boards'
import { getOrganizationContextInfo } from '@services/organizations/orgs'
import BoardCanvas from '@components/Dashboard/Boards/BoardCanvas'
import { useTrackView, AnalyticsEvent } from '@services/analytics'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { OrgContext } from '@components/Contexts/OrgContext'
import { useSearchParams } from 'next/navigation'

interface BoardCanvasClientProps {
  boardUuid: string
  /**
   * Server-read access token. Absent whenever the access-token cookie has
   * lapsed (every visit more than 8 hours after the last one); the server
   * deliberately does not refresh, because refreshing there would consume the
   * browser's one-time-use refresh token. We fall back to the client session,
   * which holds a freshly refreshed token once AuthContext has hydrated.
   */
  accessToken?: string
  orgslug: string
  username: string
}

export default function BoardCanvasClient({ boardUuid, accessToken, orgslug, username }: BoardCanvasClientProps) {
  const { t } = useTranslation()
  const session = useLHSession() as any
  // ?embedded=1 when a live session room shows this board next to the call.
  const embedded = useSearchParams()?.get('embedded') === '1'
  const token: string | undefined = accessToken || session?.data?.tokens?.access_token
  const displayName =
    username || session?.data?.user?.username || session?.data?.user?.email || t('boards.anonymous')

  const { data: board, isLoading, error } = useQuery({
    queryKey: queryKeys.boards.detail(boardUuid),
    // Guarded by `enabled`: queryFn never runs without a token.
    queryFn: () => getBoard(boardUuid, token as string),
    enabled: !!token,
    staleTime: 60_000,
  })

  // Fetch org info to get org_uuid for media URLs in board blocks
  const { data: orgData } = useQuery({
    queryKey: queryKeys.org.detail(orgslug),
    queryFn: () => getOrganizationContextInfo(orgslug, null, token),
    enabled: !!orgslug && !!token,
    staleTime: 60_000,
  })

  // No token yet means AuthContext is still trading the refresh cookie for an
  // access token. The board query is disabled until then, so keep showing the
  // spinner rather than falling through to "not found".
  if (!token || isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#f8f8f8]">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-300 border-t-black" />
      </div>
    )
  }

  if (error || !board) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#f8f8f8]">
        <p className="text-gray-500">{t('boards.not_found_or_denied')}</p>
      </div>
    )
  }

  return (
    <>
      <BoardViewTracker board={board} org={orgData} orgslug={orgslug} />
      <BoardCanvas
        board={board}
        accessToken={token}
        orgslug={orgslug}
        username={displayName}
        orgUuid={orgData?.org_uuid || ''}
        embedded={embedded}
      />
    </>
  )
}

/**
 * The board route sits outside the org layout, so there's no OrgProvider to
 * tell analytics which org the view belongs to; give the tracker the org this
 * page already loaded. Scoped to the tracker so the canvas is unaffected.
 */
function BoardViewTracker({ board, org, orgslug }: { board: any; org: any; orgslug: string }) {
  const value = useMemo(() => ({ org: org ?? null, isUserPartOfTheOrg: true, orgslug }), [org, orgslug])
  return (
    <OrgContext.Provider value={value}>
      <TrackBoardView board={board} />
    </OrgContext.Provider>
  )
}

function TrackBoardView({ board }: { board: any }) {
  useTrackView(
    AnalyticsEvent.BoardViewed,
    { board_uuid: board.board_uuid, is_public: board.public ?? false },
    true,
    'learner',
  )
  return null
}
