'use client'

import React, { useState, useMemo } from 'react'
import GeneralWrapperStyled from '@components/Objects/StyledElements/Wrappers/GeneralWrapper'
import TypeOfContentTitle from '@components/Objects/StyledElements/Titles/TypeOfContentTitle'
import { useOrg } from '@components/Contexts/OrgContext'
import { getBoardThumbnailMediaDirectory } from '@services/media/media'
import Link from 'next/link'
import { Search, X, Users, ChevronLeft, ChevronRight } from 'lucide-react'
import { ChalkboardSimple } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import FeatureDisabledView from '@components/Dashboard/Shared/FeatureDisabled/FeatureDisabledView'

interface BoardsPublicClientProps {
  orgslug: string
  org_id: number
  initialBoards: any[]
}

export default function BoardsPublicClient({
  orgslug,
  org_id,
  initialBoards,
}: BoardsPublicClientProps) {
  const { t } = useTranslation()
  const org = useOrg() as any

  // Filter out private boards for public view
  const allBoards = useMemo(() => {
    return (initialBoards || []).filter((board: any) => board.public !== false)
  }, [initialBoards])

  // Search state
  const [searchQuery, setSearchQuery] = useState('')

  const filteredBoards = useMemo(() => {
    if (!searchQuery.trim()) return allBoards
    const query = searchQuery.toLowerCase()
    return allBoards.filter((board: any) =>
      board.name?.toLowerCase().includes(query) ||
      board.description?.toLowerCase().includes(query)
    )
  }, [allBoards, searchQuery])

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 12

  React.useEffect(() => {
    setCurrentPage(1)
  }, [searchQuery])

  const totalPages = Math.ceil(filteredBoards.length / itemsPerPage)
  const paginatedBoards = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage
    return filteredBoards.slice(startIndex, startIndex + itemsPerPage)
  }, [filteredBoards, currentPage, itemsPerPage])

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
    <FeatureDisabledView
      featureName="boards"
      orgslug={orgslug}
      icon={ChalkboardSimple as any}
      context="public"
    >
    <div className="w-full">
      <GeneralWrapperStyled>
        <div className="flex flex-col space-y-2 mb-2">
          <div className="flex items-center justify-between">
            <TypeOfContentTitle title={t('common.boards')} type="board" />
          </div>

          {/* Search */}
          {allBoards.length > 0 && (
            <div className="relative w-full sm:w-80 mb-4">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                aria-label={t('boards.search_placeholder', 'Search boards...')}
                placeholder={t('boards.search_placeholder', 'Search boards...')}
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
          )}

          {/* Search Results Info */}
          {searchQuery && (
            <div className="mb-2 text-sm text-gray-500">
              {filteredBoards.length} {t('common.results', 'result')}{filteredBoards.length !== 1 ? 's' : ''} {t('common.for', 'for')} &quot;{searchQuery}&quot;
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {paginatedBoards.map((board: any) => (
              <PublicBoardCard key={board.board_uuid} board={board} orgUuid={org?.org_uuid} />
            ))}

            {/* No search results */}
            {filteredBoards.length === 0 && searchQuery && (
              <div className="col-span-full flex flex-col justify-center items-center py-12 px-4">
                <Search className="w-12 h-12 text-gray-300 mb-4" />
                <h2 className="text-xl font-semibold text-gray-600 mb-2">
                  {t('boards.no_search_results', 'No boards found')}
                </h2>
                <p className="text-gray-400">
                  {t('boards.try_different_search', 'Try a different search term')}
                </p>
              </div>
            )}

            {/* Empty state */}
            {allBoards.length === 0 && !searchQuery && (
              <div className="col-span-full flex flex-col justify-center items-center py-12 px-4 border-2 border-dashed border-gray-100 rounded-2xl bg-gray-50/30">
                <div className="p-4 bg-white rounded-full nice-shadow mb-4">
                  <ChalkboardSimple size={32} className="text-gray-300" weight="fill" />
                </div>
                <h1 className="text-xl font-bold text-gray-600 mb-2">
                  {t('boards.no_boards', 'No boards yet')}
                </h1>
                <p className="text-md text-gray-400 mb-6 text-center max-w-xs">
                  {t('boards.no_boards_description', 'There are no boards available in this organization yet.')}
                </p>
              </div>
            )}
          </div>

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="mt-8 flex items-center justify-center gap-2">
              <button
                onClick={() => goToPage(currentPage - 1)}
                disabled={currentPage === 1}
                className="flex items-center gap-1 px-3 py-2 text-sm font-medium text-gray-600 bg-white nice-shadow rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
                <span className="hidden sm:inline">{t('pagination.previous')}</span>
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
                <span className="hidden sm:inline">{t('pagination.next')}</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}

          {totalPages > 1 && (
            <div className="mt-2 text-center text-sm text-gray-500">
              {t('pagination.showing_page', { current: currentPage, total: totalPages })}
            </div>
          )}
        </div>
      </GeneralWrapperStyled>
    </div>
    </FeatureDisabledView>
  )
}

function PublicBoardCard({ board, orgUuid }: { board: any; orgUuid: string }) {
  const thumbnailImage = board.thumbnail_image
    ? getBoardThumbnailMediaDirectory(orgUuid, board.board_uuid, board.thumbnail_image)
    : '/empty_thumbnail.png'

  return (
    <Link
      href={`/board/${board.board_uuid.replace('board_', '')}`}
      className="group relative flex flex-col bg-white rounded-xl nice-shadow overflow-hidden w-full transition-all duration-300 hover:scale-[1.01]"
    >
      <div className="block relative aspect-video overflow-hidden bg-gray-50">
        <div
          className="w-full h-full bg-cover bg-center transition-transform duration-500 group-hover:scale-105"
          style={{ backgroundImage: `url(${thumbnailImage})` }}
        />
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/5 transition-colors duration-300" />
      </div>

      <div className="p-3 flex flex-col space-y-1.5">
        <h3 className="text-base font-bold text-gray-900 leading-tight group-hover:text-black transition-colors line-clamp-1">
          {board.name}
        </h3>

        {board.description && (
          <p className="text-[11px] text-gray-500 line-clamp-2 min-h-[1.5rem]">
            {board.description}
          </p>
        )}

        <div className="pt-1.5 flex items-center justify-between border-t border-gray-100">
          <div className="flex items-center gap-2 text-[9px] font-bold text-gray-400 uppercase tracking-widest">
            <Users size={12} />
            <span>{board.member_count} member{board.member_count !== 1 ? 's' : ''}</span>
          </div>
          <span className="text-[10px] font-bold text-gray-400 group-hover:text-gray-900 transition-colors uppercase tracking-wider">
            Open
          </span>
        </div>
      </div>
    </Link>
  )
}
