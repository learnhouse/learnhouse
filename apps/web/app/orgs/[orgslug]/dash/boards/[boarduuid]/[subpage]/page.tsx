'use client'
import React, { use } from 'react'
import Link from 'next/link'
import { motion } from 'motion/react'
import { Info, Globe, Users, Image as ImageIcon, Eye } from 'lucide-react'
import { ChalkboardSimple } from '@phosphor-icons/react'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getAPIUrl, getUriWithOrg } from '@services/config/config'
import { getBoardThumbnailMediaDirectory } from '@services/media/media'
import useSWR from 'swr'
import { swrFetcher } from '@services/utils/ts/requests'
import { Breadcrumbs } from '@components/Objects/Breadcrumbs/Breadcrumbs'
import BoardGeneralTab from '@components/Dashboard/Boards/Tabs/BoardGeneralTab'
import BoardThumbnailTab from '@components/Dashboard/Boards/Tabs/BoardThumbnailTab'
import BoardAccessTab from '@components/Dashboard/Boards/Tabs/BoardAccessTab'
import BoardMembersTab from '@components/Dashboard/Boards/Tabs/BoardMembersTab'
import { DashTabBar, DashTabItem } from '@components/Dashboard/Shared/DashTabBar/DashTabBar'

export type BoardSettingsParams = {
  orgslug: string
  boarduuid: string
  subpage: string
}

function BoardSettingsPage(props: { params: Promise<BoardSettingsParams> }) {
  const params = use(props.params)
  const org = useOrg() as any
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token

  const boardUuid = params.boarduuid.startsWith('board_')
    ? params.boarduuid
    : `board_${params.boarduuid}`

  const boardKey = access_token ? `${getAPIUrl()}boards/${boardUuid}` : null
  const { data: board, isLoading } = useSWR(
    boardKey,
    (url) => swrFetcher(url, access_token),
    { revalidateOnFocus: false }
  )

  const tabs: DashTabItem[] = [
    {
      key: 'general',
      label: 'General',
      icon: <Info size={16} />,
      href: getUriWithOrg(params.orgslug, '') + `/dash/boards/${params.boarduuid}/general`,
      active: params.subpage === 'general',
    },
    {
      key: 'thumbnail',
      label: 'Thumbnail',
      icon: <ImageIcon size={16} />,
      href: getUriWithOrg(params.orgslug, '') + `/dash/boards/${params.boarduuid}/thumbnail`,
      active: params.subpage === 'thumbnail',
    },
    {
      key: 'access',
      label: 'Access',
      icon: <Globe size={16} />,
      href: getUriWithOrg(params.orgslug, '') + `/dash/boards/${params.boarduuid}/access`,
      active: params.subpage === 'access',
    },
    {
      key: 'members',
      label: 'Members',
      icon: <Users size={16} />,
      href: getUriWithOrg(params.orgslug, '') + `/dash/boards/${params.boarduuid}/members`,
      active: params.subpage === 'members',
    },
  ]

  if (isLoading || !board) {
    return (
      <div className="h-screen w-full bg-[#f8f8f8] flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
      </div>
    )
  }

  const thumbnailUrl = board.thumbnail_image
    ? getBoardThumbnailMediaDirectory(org?.org_uuid, boardUuid, board.thumbnail_image)
    : '/empty_thumbnail.png'

  return (
    <div className="h-screen w-full bg-[#f8f8f8] grid grid-rows-[auto_1fr] grid-cols-1">
      <div className="pl-4 pr-4 sm:pl-10 sm:pr-10 text-sm tracking-tight bg-[#fcfbfc] z-10 nice-shadow relative min-w-0 overflow-hidden">
        <div className="pt-6 pb-4">
          <Breadcrumbs items={[
            { label: 'Boards', href: '/dash/boards', icon: <ChalkboardSimple size={14} /> },
            { label: board.name },
          ]} />
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          <div className="flex py-3 grow min-w-0 items-center">
            <Link href={`/board/${boardUuid.replace('board_', '')}`} className="shrink-0">
              <img
                className="w-[72px] sm:w-[100px] h-[41px] sm:h-[57px] rounded-md drop-shadow-md object-cover"
                src={thumbnailUrl}
                alt=""
              />
            </Link>
            <div className="flex flex-col justify-center pl-3 sm:pl-5 min-w-0">
              <div className="text-gray-400 font-semibold text-xs sm:text-sm">Board Settings</div>
              <div className="text-black font-bold text-base sm:text-xl -mt-1 first-letter:uppercase truncate">
                {board.name}
              </div>
            </div>
          </div>
          <div className="flex items-center self-center rounded-lg shadow-sm shadow-neutral-300/40 ring-1 ring-neutral-200/60 overflow-hidden shrink-0">
            <div className={`px-2.5 sm:px-3.5 py-2 text-sm font-semibold flex items-center space-x-2 ${
              board.public
                ? 'bg-green-50/70 text-green-700'
                : 'bg-amber-50/70 text-amber-700'
            }`}>
              {board.public ? <Globe className="w-4 h-4" /> : <Users className="w-4 h-4" />}
              <span className="hidden sm:inline">{board.public ? 'Public' : 'Private'}</span>
            </div>
            <div className="w-px self-stretch bg-neutral-200/80" />
            <Link
              href={`/board/${boardUuid.replace('board_', '')}`}
              className="px-2.5 sm:px-3.5 py-2 text-sm font-semibold text-neutral-600 bg-neutral-50/70 hover:bg-neutral-100/70 transition-colors flex items-center space-x-2"
            >
              <Eye className="w-4 h-4" />
              <span className="hidden sm:inline">View Board</span>
            </Link>
          </div>
        </div>

        <DashTabBar tabs={tabs} />
      </div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.1, type: 'spring', stiffness: 80 }}
        className="h-full overflow-y-auto overflow-x-hidden"
      >
        {params.subpage === 'general' && (
          <BoardGeneralTab board={board} boardUuid={boardUuid} boardKey={boardKey} />
        )}
        {params.subpage === 'thumbnail' && (
          <BoardThumbnailTab board={board} boardUuid={boardUuid} orgUuid={org?.org_uuid} boardKey={boardKey} />
        )}
        {params.subpage === 'access' && (
          <BoardAccessTab board={board} boardUuid={boardUuid} orgId={org?.id} boardKey={boardKey} />
        )}
        {params.subpage === 'members' && (
          <BoardMembersTab boardUuid={boardUuid} orgId={org?.id} />
        )}
      </motion.div>
    </div>
  )
}

export default BoardSettingsPage
