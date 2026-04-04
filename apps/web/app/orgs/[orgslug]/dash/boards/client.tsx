'use client'

import React, { useState, useMemo } from 'react'
import { Search, X, Users, Globe, Lock, ChevronLeft, ChevronRight, MoreVertical, Settings2, Eye, Trash2, CheckSquare, Square, Copy } from 'lucide-react'
import { ChalkboardSimple } from '@phosphor-icons/react'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getAPIUrl, getUriWithOrg } from '@services/config/config'
import useSWR, { mutate } from 'swr'
import { swrFetcher } from '@services/utils/ts/requests'
import { createBoard, deleteBoard, duplicateBoard } from '@services/boards/boards'
import { getBoardThumbnailMediaDirectory } from '@services/media/media'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import Link from 'next/link'
import { Breadcrumbs } from '@components/Objects/Breadcrumbs/Breadcrumbs'
import AuthenticatedClientElement from '@components/Security/AuthenticatedClientElement'
import PlanRestrictedFeature from '@components/Dashboard/Shared/PlanRestricted/PlanRestrictedFeature'
import FeatureDisabledView from '@components/Dashboard/Shared/FeatureDisabled/FeatureDisabledView'
import ConfirmationModal from '@components/Objects/StyledElements/ConfirmationModal/ConfirmationModal'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@components/ui/dropdown-menu"
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

  const isBoardsEnabled = org?.config?.config?.resolved_features?.boards?.enabled ?? org?.config?.config?.features?.boards?.enabled !== false

  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [selectedBoards, setSelectedBoards] = useState<Set<string>>(new Set())
  const itemsPerPage = 12

  const boardsKey = isBoardsEnabled && access_token ? `${getAPIUrl()}boards/org/${org_id}` : null
  const { data: boards, isLoading } = useSWR(
    boardsKey,
    (url) => swrFetcher(url, access_token),
    { revalidateOnFocus: false }
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

  const toggleBoardSelection = (boardUuid: string) => {
    const newSelection = new Set(selectedBoards)
    if (newSelection.has(boardUuid)) {
      newSelection.delete(boardUuid)
    } else {
      newSelection.add(boardUuid)
    }
    setSelectedBoards(newSelection)
  }

  const selectAllBoards = () => {
    const allBoardUuids = paginatedBoards.map((board: any) => board.board_uuid)
    setSelectedBoards(new Set(allBoardUuids))
  }

  const clearSelection = () => {
    setSelectedBoards(new Set())
  }

  const bulkDeleteBoards = async () => {
    const toastId = toast.loading(t('boards.deleting_boards', { count: selectedBoards.size }))
    let successCount = 0
    let errorCount = 0

    for (const boardUuid of selectedBoards) {
      try {
        await deleteBoard(boardUuid, access_token)
        successCount++
      } catch {
        errorCount++
      }
    }

    toast.dismiss(toastId)
    if (errorCount === 0) {
      toast.success(t('boards.boards_deleted_success', { count: successCount }))
    } else {
      toast.error(t('boards.boards_deleted_partial', { success: successCount, error: errorCount }))
    }

    clearSelection()
    if (boardsKey) mutate(boardsKey)
  }

  const handleDeleteBoard = async (boardUuid: string) => {
    const toastId = toast.loading(t('boards.deleting_board'))
    try {
      await deleteBoard(boardUuid, access_token)
      if (boardsKey) mutate(boardsKey)
      toast.success(t('boards.board_deleted_success'))
    } catch {
      toast.error(t('boards.board_deleted_error'))
    } finally {
      toast.dismiss(toastId)
    }
  }

  const handleDuplicateBoard = async (boardUuid: string) => {
    const toastId = toast.loading(t('boards.duplicating_board'))
    try {
      await duplicateBoard(boardUuid, access_token)
      if (boardsKey) mutate(boardsKey)
      toast.success(t('boards.board_duplicated_success'))
    } catch {
      toast.error(t('boards.board_duplicated_error'))
    } finally {
      toast.dismiss(toastId)
    }
  }

  const goToPage = (page: number) => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page)
      setSelectedBoards(new Set())
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

        {/* Search and Bulk Actions */}
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

            {/* Bulk Actions */}
            {selectedBoards.size > 0 && (
              <AuthenticatedClientElement
                checkMethod="roles"
                action="delete"
                ressourceType="boards"
                orgId={org_id}
              >
                <div className="flex items-center gap-2 ml-auto">
                  <span className="text-sm font-medium text-gray-500 px-2">
                    {t('boards.selected_count', { count: selectedBoards.size })}
                  </span>
                  <button
                    onClick={selectAllBoards}
                    className="flex items-center gap-2 px-3 py-2 text-sm text-gray-600 hover:text-gray-900 bg-white nice-shadow rounded-lg transition-colors"
                  >
                    <span>{t('boards.select_all')}</span>
                  </button>
                  <button
                    onClick={clearSelection}
                    className="flex items-center gap-2 px-3 py-2 text-sm text-gray-600 hover:text-gray-900 bg-white nice-shadow rounded-lg transition-colors"
                  >
                    <X className="w-4 h-4" />
                    <span>{t('boards.clear_selection')}</span>
                  </button>
                  <ConfirmationModal
                    confirmationButtonText={t('boards.delete_selected')}
                    confirmationMessage={t('boards.delete_selected_confirm', { count: selectedBoards.size })}
                    dialogTitle={t('boards.delete_boards_title')}
                    dialogTrigger={
                      <button className="flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:text-red-700 bg-white nice-shadow rounded-lg transition-colors">
                        <Trash2 className="w-4 h-4" />
                        <span>{t('boards.delete_selected')}</span>
                      </button>
                    }
                    functionToExecute={bulkDeleteBoards}
                    status="warning"
                  />
                </div>
              </AuthenticatedClientElement>
            )}
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
              <BoardCard
                key={board.board_uuid}
                board={board}
                orgslug={orgslug}
                orgUuid={org?.org_uuid}
                orgId={org_id}
                isSelected={selectedBoards.has(board.board_uuid)}
                onToggleSelect={toggleBoardSelection}
                onDuplicate={handleDuplicateBoard}
                onDelete={handleDeleteBoard}
              />
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

function BoardCard({ board, orgslug, orgUuid, orgId, isSelected, onToggleSelect, onDuplicate, onDelete }: {
  board: any
  orgslug: string
  orgUuid: string
  orgId: number
  isSelected: boolean
  onToggleSelect: (boardUuid: string) => void
  onDuplicate: (boardUuid: string) => Promise<void>
  onDelete: (boardUuid: string) => Promise<void>
}) {
  const { t } = useTranslation()
  const thumbnailImage = board.thumbnail_image
    ? getBoardThumbnailMediaDirectory(orgUuid, board.board_uuid, board.thumbnail_image)
    : '/empty_thumbnail.png'

  const settingsLink = getUriWithOrg(orgslug, `/dash/boards/${board.board_uuid.replace('board_', '')}/general`)

  const handleSelectClick = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    onToggleSelect(board.board_uuid)
  }

  return (
    <div className={`group relative flex flex-col bg-white rounded-xl nice-shadow overflow-hidden w-full transition-all duration-300 hover:scale-[1.01] ${isSelected ? 'ring-2 ring-black ring-offset-2' : ''}`}>
      {/* Selection checkbox */}
      <button
        onClick={handleSelectClick}
        aria-label={isSelected ? 'Deselect board' : 'Select board'}
        className={`absolute top-2 left-2 z-20 p-1.5 bg-white/90 backdrop-blur-sm rounded-full hover:bg-white transition-all shadow-md ${
          isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
        }`}
      >
        {isSelected ? (
          <CheckSquare className="w-4 h-4 text-black" />
        ) : (
          <Square className="w-4 h-4 text-gray-500" />
        )}
      </button>

      {/* Options menu */}
      <BoardCardOptions
        board={board}
        orgslug={orgslug}
        orgId={orgId}
        onDuplicate={onDuplicate}
        onDelete={onDelete}
      />

      <Link
        href={settingsLink}
        className="block relative aspect-video overflow-hidden bg-gray-50"
      >
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
      </Link>

      <div className="p-3 flex flex-col space-y-1.5">
        <div className="flex items-start justify-between">
          <Link href={settingsLink} className="text-base font-bold text-gray-900 leading-tight hover:text-black transition-colors line-clamp-1">
            {board.name}
          </Link>
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
          <Link
            href={settingsLink}
            className="text-[10px] font-bold text-gray-400 hover:text-gray-900 transition-colors uppercase tracking-wider"
          >
            {t('boards.settings')}
          </Link>
        </div>
      </div>
    </div>
  )
}

function BoardCardOptions({ board, orgslug, orgId, onDuplicate, onDelete }: {
  board: any
  orgslug: string
  orgId: number
  onDuplicate: (boardUuid: string) => Promise<void>
  onDelete: (boardUuid: string) => Promise<void>
}) {
  const { t } = useTranslation()
  const [isOpen, setIsOpen] = useState(false)

  return (
    <AuthenticatedClientElement
      action="update"
      ressourceType="boards"
      checkMethod="roles"
      orgId={orgId}
    >
      <div className={`absolute top-2 right-2 z-20 transition-opacity ${
        !isOpen ? 'opacity-0 group-hover:opacity-100' : 'opacity-100'
      }`}>
        <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
          <DropdownMenuTrigger asChild>
            <button aria-label="Board actions" className="p-1.5 bg-white/90 backdrop-blur-sm rounded-full hover:bg-white transition-all shadow-md">
              <MoreVertical size={18} className="text-gray-700" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem asChild>
              <Link href={`/board/${board.board_uuid.replace('board_', '')}`} className="flex items-center cursor-pointer">
                <Eye className="mr-2 h-4 w-4" /> {t('boards.open_board')}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href={getUriWithOrg(orgslug, `/dash/boards/${board.board_uuid.replace('board_', '')}/general`)} className="flex items-center cursor-pointer">
                <Settings2 className="mr-2 h-4 w-4" /> {t('boards.settings')}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <ConfirmationModal
                confirmationButtonText={t('boards.duplicate_board')}
                confirmationMessage={t('boards.duplicate_board_confirm')}
                dialogTitle={t('boards.duplicate_board_title', { name: board.name })}
                dialogTrigger={
                  <button className="w-full text-left flex items-center px-2 py-1.5 text-sm text-gray-700 hover:bg-gray-50 rounded-md transition-colors">
                    <Copy className="mr-2 h-4 w-4" /> {t('boards.duplicate_board')}
                  </button>
                }
                functionToExecute={() => onDuplicate(board.board_uuid)}
                status="info"
              />
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <ConfirmationModal
                confirmationButtonText={t('boards.delete_board')}
                confirmationMessage={t('boards.delete_board_confirm')}
                dialogTitle={t('boards.delete_board_title', { name: board.name })}
                dialogTrigger={
                  <button className="w-full text-left flex items-center px-2 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded-md transition-colors">
                    <Trash2 className="mr-2 h-4 w-4" /> {t('boards.delete_board')}
                  </button>
                }
                functionToExecute={() => onDelete(board.board_uuid)}
                status="warning"
              />
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </AuthenticatedClientElement>
  )
}
