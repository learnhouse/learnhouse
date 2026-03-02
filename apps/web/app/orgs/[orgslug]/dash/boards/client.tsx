'use client'

import React, { useState, useMemo } from 'react'
import { Plus, Search, X, Users, Globe, Lock, ChevronLeft, ChevronRight } from 'lucide-react'
import { ChalkboardSimple } from '@phosphor-icons/react'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getAPIUrl } from '@services/config/config'
import useSWR, { mutate } from 'swr'
import { swrFetcher } from '@services/utils/ts/requests'
import { createBoard } from '@services/boards/boards'
import { getBoardThumbnailMediaDirectory } from '@services/media/media'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import Link from 'next/link'
import { Breadcrumbs } from '@components/Objects/Breadcrumbs/Breadcrumbs'
import AuthenticatedClientElement from '@components/Security/AuthenticatedClientElement'
import PlanRestrictedFeature from '@components/Dashboard/Shared/PlanRestricted/PlanRestrictedFeature'
import FeatureDisabledView from '@components/Dashboard/Shared/FeatureDisabled/FeatureDisabledView'
import { PlanLevel } from '@services/plans/plans'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import { usePlan } from '@components/Hooks/usePlan'

interface BoardListClientProps {
  org_id: number
  orgslug: string
}

function CreateBoardForm({ onCreated, orgId, accessToken }: {
  onCreated: () => void
  orgId: number
  accessToken: string
}) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    try {
      await createBoard(orgId, { name, description }, accessToken)
      toast.success(t('boards.board_created'))
      setName('')
      setDescription('')
      onCreated()
    } catch {
      toast.error(t('boards.board_created_error'))
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 p-1">
      <div>
        <label className="text-sm font-medium text-gray-700">{t('boards.name')}</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full mt-1 px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-black focus:ring-offset-1"
          placeholder={t('boards.name_placeholder')}
          required
        />
      </div>
      <div>
        <label className="text-sm font-medium text-gray-700">{t('boards.description')}</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="w-full mt-1 px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-black focus:ring-offset-1"
          placeholder={t('boards.description_placeholder')}
          rows={3}
        />
      </div>
      <div className="flex justify-end">
        <button
          type="submit"
          disabled={!name.trim()}
          className="rounded-lg bg-black px-5 py-2 text-sm font-medium text-white disabled:opacity-50 hover:bg-gray-800 transition-colors"
        >
          {t('boards.create_board')}
        </button>
      </div>
    </form>
  )
}

export default function BoardListClient({ org_id, orgslug }: BoardListClientProps) {
  const { t } = useTranslation()
  const org = useOrg() as any
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const plan = usePlan()

  const isBoardsEnabled = org?.config?.config?.features?.boards?.enabled !== false

  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 12

  const boardsKey = isBoardsEnabled && access_token ? `${getAPIUrl()}boards/org/${org_id}` : null
  const { data: boards, isLoading } = useSWR(
    boardsKey,
    (url) => swrFetcher(url, access_token),
    { revalidateOnFocus: true }
  )

  const allBoards = boards || []

  const filteredBoards = useMemo(() => {
    if (!searchQuery.trim()) return allBoards
    const query = searchQuery.toLowerCase()
    return allBoards.filter((board: any) =>
      board.name?.toLowerCase().includes(query) ||
      board.description?.toLowerCase().includes(query)
    )
  }, [allBoards, searchQuery])

  React.useEffect(() => {
    setCurrentPage(1)
  }, [searchQuery])

  const totalPages = Math.ceil(filteredBoards.length / itemsPerPage)
  const paginatedBoards = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage
    return filteredBoards.slice(startIndex, startIndex + itemsPerPage)
  }, [filteredBoards, currentPage, itemsPerPage])

  const handleCreated = () => {
    setCreateModalOpen(false)
    if (boardsKey) mutate(boardsKey)
  }

  const goToPage = (page: number) => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page)
    }
  }

  const getVisiblePageNumbers = () => {
    const pages: (number | string)[] = []
    const maxVisible = 5
    if (totalPages <= maxVisible) {
      for (let i = 1; i <= totalPages; i++) pages.push(i)
    } else {
      if (currentPage <= 3) {
        for (let i = 1; i <= 4; i++) pages.push(i)
        pages.push('...')
        pages.push(totalPages)
      } else if (currentPage >= totalPages - 2) {
        pages.push(1)
        pages.push('...')
        for (let i = totalPages - 3; i <= totalPages; i++) pages.push(i)
      } else {
        pages.push(1)
        pages.push('...')
        for (let i = currentPage - 1; i <= currentPage + 1; i++) pages.push(i)
        pages.push('...')
        pages.push(totalPages)
      }
    }
    return pages
  }

  return (
    <PlanRestrictedFeature
      currentPlan={plan}
      requiredPlan="pro"
      titleKey="Boards"
      descriptionKey="Create collaborative boards for real-time brainstorming and planning."
    >
    <FeatureDisabledView featureName="boards" orgslug={orgslug} context="dashboard">
      <div className="h-full w-full bg-[#f8f8f8] pl-10 pr-10">
        <div className="mb-6 pt-6">
          <Breadcrumbs items={[
            { label: t('boards.boards'), href: '/dash/boards', icon: <ChalkboardSimple size={14} /> }
          ]} />
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mt-4">
            <div className="flex items-center space-x-4">
              <h1 className="text-3xl font-bold mb-4 sm:mb-0">{t('boards.boards')}</h1>
            </div>
            <AuthenticatedClientElement
              checkMethod="roles"
              action="create"
              ressourceType="boards"
              orgId={org_id}
            >
              <Modal
                isDialogOpen={createModalOpen}
                onOpenChange={setCreateModalOpen}
                dialogTitle={t('boards.create_new_board')}
                dialogDescription={t('boards.create_new_board_description')}
                dialogContent={
                  <CreateBoardForm
                    onCreated={handleCreated}
                    orgId={org_id}
                    accessToken={access_token}
                  />
                }
                dialogTrigger={
                  <button className="rounded-lg bg-black transition-all duration-100 ease-linear antialiased p-2 px-5 my-auto font text-xs font-bold text-white nice-shadow flex space-x-2 items-center hover:scale-105">
                    <div>{t('boards.new_board')}</div>
                    <div className="text-md bg-neutral-800 px-1 rounded-full">+</div>
                  </button>
                }
              />
            </AuthenticatedClientElement>
          </div>
        </div>

        {/* Search */}
        {allBoards.length > 0 && (
          <div className="mb-6 flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
            <div className="relative w-full sm:w-80">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('boards.search_placeholder')}
                className="w-full pl-10 pr-10 py-2.5 bg-white nice-shadow rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-black focus:ring-offset-2 border-0"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Search Results Info */}
        {searchQuery && (
          <div className="mb-4 text-sm text-gray-500">
            {filteredBoards.length !== 1
              ? t('boards.pagination.results_plural', { count: filteredBoards.length, query: searchQuery })
              : t('boards.pagination.results', { count: filteredBoards.length, query: searchQuery })}
          </div>
        )}

        {/* Loading */}
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="animate-pulse rounded-xl bg-white nice-shadow overflow-hidden">
                <div className="aspect-video bg-gray-200" />
                <div className="p-3 space-y-2">
                  <div className="h-4 bg-gray-200 rounded w-3/4" />
                  <div className="h-3 bg-gray-100 rounded w-full" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {paginatedBoards.map((board: any) => (
              <BoardCard key={board.board_uuid} board={board} orgUuid={org?.org_uuid} />
            ))}

            {/* No search results */}
            {filteredBoards.length === 0 && searchQuery && (
              <div className="col-span-full flex justify-center items-center py-8">
                <div className="text-center">
                  <Search className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                  <h2 className="text-xl font-semibold text-gray-600 mb-2">{t('boards.no_boards_found')}</h2>
                  <p className="text-gray-400">{t('boards.try_different_search')}</p>
                </div>
              </div>
            )}

            {/* Empty state */}
            {allBoards.length === 0 && !searchQuery && (
              <div className="col-span-full flex justify-center items-center py-8">
                <div className="text-center">
                  <div className="rounded-full bg-gray-100 p-4 w-fit mx-auto mb-4">
                    <ChalkboardSimple size={24} className="text-gray-400" />
                  </div>
                  <h2 className="text-2xl font-bold text-gray-600 mb-2">{t('boards.no_boards_yet')}</h2>
                  <p className="text-lg text-gray-400">
                    {t('boards.no_boards_description')}
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Pagination Controls */}
        {totalPages > 1 && (
          <div className="mt-8 mb-6 flex items-center justify-center gap-2">
            <button
              onClick={() => goToPage(currentPage - 1)}
              disabled={currentPage === 1}
              className="flex items-center gap-1 px-3 py-2 text-sm font-medium text-gray-600 bg-white nice-shadow rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
              <span className="hidden sm:inline">{t('boards.pagination.previous')}</span>
            </button>

            <div className="flex items-center gap-1">
              {getVisiblePageNumbers().map((page, index) => (
                <React.Fragment key={index}>
                  {page === '...' ? (
                    <span className="px-2 py-1 text-gray-400">...</span>
                  ) : (
                    <button
                      onClick={() => goToPage(page as number)}
                      className={`px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                        currentPage === page
                          ? 'bg-black text-white'
                          : 'bg-white text-gray-600 nice-shadow hover:bg-gray-50'
                      }`}
                    >
                      {page}
                    </button>
                  )}
                </React.Fragment>
              ))}
            </div>

            <button
              onClick={() => goToPage(currentPage + 1)}
              disabled={currentPage === totalPages}
              className="flex items-center gap-1 px-3 py-2 text-sm font-medium text-gray-600 bg-white nice-shadow rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <span className="hidden sm:inline">{t('boards.pagination.next')}</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {totalPages > 1 && (
          <div className="mb-6 text-center text-sm text-gray-500">
            {t('boards.pagination.page_of', { current: currentPage, total: totalPages })}
          </div>
        )}
      </div>
    </FeatureDisabledView>
    </PlanRestrictedFeature>
  )
}

function BoardCard({ board, orgUuid }: { board: any; orgUuid: string }) {
  const { t } = useTranslation()
  const thumbnailImage = board.thumbnail_image
    ? getBoardThumbnailMediaDirectory(orgUuid, board.board_uuid, board.thumbnail_image)
    : '/empty_thumbnail.png'

  return (
    <Link
      href={`/dash/boards/${board.board_uuid.replace('board_', '')}`}
      className="group relative flex flex-col bg-white rounded-xl nice-shadow overflow-hidden w-full transition-all duration-300 hover:scale-[1.01]"
    >
      <div className="block relative aspect-video overflow-hidden bg-gray-50">
        <div
          className="w-full h-full bg-cover bg-center transition-transform duration-500 group-hover:scale-105"
          style={{ backgroundImage: `url(${thumbnailImage})` }}
        />
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/5 transition-colors duration-300" />
        <div className="absolute bottom-2 left-2">
          {board.public ? (
            <span className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide bg-green-100 text-green-700 rounded-full">
              <Globe size={10} />
              {t('boards.public')}
            </span>
          ) : (
            <span className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide bg-amber-100 text-amber-700 rounded-full">
              <Lock size={10} />
              {t('boards.private')}
            </span>
          )}
        </div>
      </div>

      <div className="p-3 flex flex-col space-y-1.5">
        <div className="flex items-start justify-between">
          <h3 className="text-base font-bold text-gray-900 leading-tight group-hover:text-black transition-colors line-clamp-1">
            {board.name}
          </h3>
        </div>

        {board.description && (
          <p className="text-[11px] text-gray-500 line-clamp-2 min-h-[1.5rem]">
            {board.description}
          </p>
        )}

        <div className="pt-1.5 flex items-center justify-between border-t border-gray-100">
          <div className="flex items-center gap-2 text-[9px] font-bold text-gray-400 uppercase tracking-widest">
            <Users size={12} />
            <span>{board.member_count !== 1
              ? t('boards.member_count_plural', { count: board.member_count })
              : t('boards.member_count', { count: board.member_count })}</span>
          </div>
          <span className="text-[10px] font-bold text-gray-400 group-hover:text-gray-900 transition-colors uppercase tracking-wider">
            {t('boards.settings')}
          </span>
        </div>
      </div>
    </Link>
  )
}
