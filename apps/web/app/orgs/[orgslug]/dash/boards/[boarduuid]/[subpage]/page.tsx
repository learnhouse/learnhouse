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

  const tabs = [
    {
      key: 'general',
      label: 'General',
      icon: Info,
      href: `/dash/boards/${params.boarduuid}/general`,
    },
    {
      key: 'thumbnail',
      label: 'Thumbnail',
      icon: ImageIcon,
      href: `/dash/boards/${params.boarduuid}/thumbnail`,
    },
    {
      key: 'access',
      label: 'Access',
      icon: Globe,
      href: `/dash/boards/${params.boarduuid}/access`,
    },
    {
      key: 'members',
      label: 'Members',
      icon: Users,
      href: `/dash/boards/${params.boarduuid}/members`,
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
    <div className="h-screen w-full bg-[#f8f8f8] grid grid-rows-[auto_1fr]">
      {/* Top bar with breadcrumbs, board info, and tabs */}
      <div className="pl-10 pr-10 text-sm tracking-tight bg-[#fcfbfc] z-10 nice-shadow relative">
        {/* Breadcrumbs */}
        <div className="pt-6 pb-4">
          <Breadcrumbs items={[
            { label: 'Boards', href: '/dash/boards', icon: <ChalkboardSimple size={14} /> },
            { label: board.name },
          ]} />
        </div>

        {/* Board info row */}
        <div className="flex">
          <div className="flex py-3 grow items-center">
            <Link href={`/board/${boardUuid.replace('board_', '')}`}>
              <img
                className="w-[100px] h-[57px] rounded-md drop-shadow-md object-cover"
                src={thumbnailUrl}
                alt=""
              />
            </Link>
            <div className="flex flex-col justify-center pl-5">
              <div className="text-gray-400 font-semibold text-sm">Board Settings</div>
              <div className="text-black font-bold text-xl -mt-1 first-letter:uppercase">
                {board.name}
              </div>
            </div>
          </div>
          <div className="flex items-center self-center rounded-lg shadow-sm shadow-neutral-300/40 ring-1 ring-neutral-200/60 overflow-hidden">
            <div className={`px-3.5 py-2 text-sm font-semibold flex items-center space-x-2 ${
              board.public
                ? 'bg-green-50/70 text-green-700'
                : 'bg-amber-50/70 text-amber-700'
            }`}>
              {board.public ? <Globe className="w-4 h-4" /> : <Users className="w-4 h-4" />}
              <span>{board.public ? 'Public' : 'Private'}</span>
            </div>
            <div className="w-px self-stretch bg-neutral-200/80" />
            <Link
              href={`/board/${boardUuid.replace('board_', '')}`}
              className="px-3.5 py-2 text-sm font-semibold text-neutral-600 bg-neutral-50/70 hover:bg-neutral-100/70 transition-colors flex items-center space-x-2"
            >
              <Eye className="w-4 h-4" />
              <span>View Board</span>
            </Link>
          </div>
        </div>

        {/* Tab navigation */}
        <div className="flex space-x-3 font-black text-sm">
          {tabs.map((tab) => {
            const IconComponent = tab.icon
            const isActive = params.subpage === tab.key

            return (
              <Link
                key={tab.key}
                href={getUriWithOrg(params.orgslug, '') + tab.href}
              >
                <div
                  className={`flex space-x-4 py-2 w-fit text-center border-black transition-all ease-linear ${
                    isActive ? 'border-b-4' : 'opacity-50 hover:opacity-75'
                  } cursor-pointer`}
                >
                  <div className="flex items-center space-x-2.5 mx-2">
                    <IconComponent size={16} />
                    <div>{tab.label}</div>
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
      </div>

      {/* Tab content */}
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
