'use client'

import React, { useState, useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import GeneralWrapperStyled from '@components/Objects/StyledElements/Wrappers/GeneralWrapper'
import TypeOfContentTitle from '@components/Objects/StyledElements/Titles/TypeOfContentTitle'
import PodcastThumbnail from '@components/Objects/Thumbnails/PodcastThumbnail'
import AuthenticatedClientElement from '@components/Security/AuthenticatedClientElement'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import CreatePodcastModal from '@components/Objects/Modals/Podcast/Create/CreatePodcast'
import NewPodcastButton from '@components/Objects/StyledElements/Buttons/NewPodcastButton'
import useAdminStatus from '@components/Hooks/useAdminStatus'
import { PodcastWithEpisodeCount } from '@services/podcasts/podcasts'
import { Headphones, ChevronLeft, ChevronRight, Search, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import FeatureDisabledView from '@components/Dashboard/Shared/FeatureDisabled/FeatureDisabledView'

interface PodcastsClientProps {
  orgslug: string
  org_id: number
  initialPodcasts: PodcastWithEpisodeCount[]
}

export default function PodcastsClient({
  orgslug,
  org_id,
  initialPodcasts,
}: PodcastsClientProps) {
  const { t } = useTranslation()
  const allPodcasts = initialPodcasts
  const searchParams = useSearchParams()
  const isCreatingPodcast = searchParams.get('new') ? true : false
  const [newPodcastModal, setNewPodcastModal] = useState(isCreatingPodcast)
  const isUserAdmin = useAdminStatus() as any

  // Search state
  const [searchQuery, setSearchQuery] = useState('')

  // Filter podcasts based on search
  const filteredPodcasts = useMemo(() => {
    if (!searchQuery.trim()) return allPodcasts
    const query = searchQuery.toLowerCase()
    return allPodcasts.filter((podcast: PodcastWithEpisodeCount) =>
      podcast.name?.toLowerCase().includes(query) ||
      podcast.description?.toLowerCase().includes(query) ||
      podcast.tags?.toLowerCase().includes(query)
    )
  }, [allPodcasts, searchQuery])

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 12

  // Reset to page 1 when search changes
  React.useEffect(() => {
    setCurrentPage(1)
  }, [searchQuery])

  // Calculate pagination
  const totalPages = Math.ceil(filteredPodcasts.length / itemsPerPage)
  const paginatedPodcasts = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage
    return filteredPodcasts.slice(startIndex, startIndex + itemsPerPage)
  }, [filteredPodcasts, currentPage, itemsPerPage])

  // Pagination handlers
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

  async function closeNewPodcastModal() {
    setNewPodcastModal(false)
  }

  return (
    <FeatureDisabledView
      featureName="podcasts"
      orgslug={orgslug}
      icon={Headphones}
      context="public"
    >
    <div className="w-full">
      <GeneralWrapperStyled>
        <div className="flex flex-col space-y-2 mb-2">
          <div className="flex items-center justify-between">
            <TypeOfContentTitle title={t('podcasts.podcasts')} type="pod" />
            <AuthenticatedClientElement
              checkMethod="roles"
              action="create"
              ressourceType="podcasts"
              orgId={org_id}
            >
              <Modal
                isDialogOpen={newPodcastModal}
                onOpenChange={setNewPodcastModal}
                minHeight="md"
                minWidth="lg"
                dialogContent={
                  <CreatePodcastModal
                    closeModal={closeNewPodcastModal}
                    orgslug={orgslug}
                  />
                }
                dialogTitle={t('podcasts.create_podcast')}
                dialogDescription={t('podcasts.create_new_podcast')}
                dialogTrigger={
                  <button>
                    <NewPodcastButton />
                  </button>
                }
              />
            </AuthenticatedClientElement>
          </div>

          {/* Search */}
          {allPodcasts.length > 0 && (
            <div className="relative w-full sm:w-80 mb-4">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('podcasts.search_placeholder')}
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
              {t('podcasts.search_results', { count: filteredPodcasts.length, query: searchQuery })}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {paginatedPodcasts.map((podcast: PodcastWithEpisodeCount) => (
              <div key={podcast.podcast_uuid} className="">
                <PodcastThumbnail podcast={podcast} orgslug={orgslug} />
              </div>
            ))}
            {filteredPodcasts.length === 0 && searchQuery && (
              <div className="col-span-full flex flex-col justify-center items-center py-12 px-4">
                <Search className="w-12 h-12 text-gray-300 mb-4" />
                <h2 className="text-xl font-semibold text-gray-600 mb-2">
                  {t('podcasts.no_search_results')}
                </h2>
                <p className="text-gray-400">
                  {t('podcasts.try_different_search')}
                </p>
              </div>
            )}
            {allPodcasts.length === 0 && !searchQuery && (
              <div className="col-span-full flex flex-col justify-center items-center py-12 px-4 border-2 border-dashed border-gray-100 rounded-2xl bg-gray-50/30">
                <div className="p-4 bg-white rounded-full nice-shadow mb-4">
                  <Headphones className="w-8 h-8 text-gray-300" strokeWidth={1.5} />
                </div>
                <h1 className="text-xl font-bold text-gray-600 mb-2">
                  {t('podcasts.no_podcasts')}
                </h1>
                <p className="text-md text-gray-400 mb-6 text-center max-w-xs">
                  {isUserAdmin ? (
                    t('podcasts.create_podcasts_placeholder')
                  ) : (
                    t('podcasts.no_podcasts_description')
                  )}
                </p>
                {isUserAdmin && (
                  <div className="mt-4">
                    <AuthenticatedClientElement
                      action="create"
                      ressourceType="podcasts"
                      checkMethod="roles"
                      orgId={org_id}
                    >
                      <button onClick={() => setNewPodcastModal(true)}>
                        <NewPodcastButton />
                      </button>
                    </AuthenticatedClientElement>
                  </div>
                )}
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

          {/* Pagination info */}
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
