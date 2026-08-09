'use client'

import React, { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useRouter } from 'next/navigation'
import { Search, X } from 'lucide-react'
import { Cube } from '@phosphor-icons/react'
import toast from 'react-hot-toast'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import GeneralWrapperStyled from '@components/Objects/StyledElements/Wrappers/GeneralWrapper'
import TypeOfContentTitle from '@components/Objects/StyledElements/Titles/TypeOfContentTitle'
import PlaygroundCard from '@components/Playground/PlaygroundCard'
import { Playground, createPlayground } from '@services/playgrounds/playgrounds'
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import FeatureGate from '@components/Dashboard/Shared/FeatureGate/FeatureGate'
import useAdminStatus from '@components/Hooks/useAdminStatus'
import { searchMatchesAny } from '@/lib/search/normalize'
import CatalogPagination, { useCatalogPagination } from '@components/Objects/Catalog/CatalogPagination'

interface PlaygroundsClientProps {
  orgslug: string
  org_id: number
  initialPlaygrounds: Playground[]
}

export default function PlaygroundsClient({
  orgslug,
  org_id,
  initialPlaygrounds,
}: PlaygroundsClientProps) {
  const router = useRouter()
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const { isAdmin: isUserAdmin } = useAdminStatus()
  const queryClient = useQueryClient()
  const { track } = useLHAnalytics('learner')

  const [playgrounds, setPlaygrounds] = useState<Playground[]>(initialPlaygrounds)
  const [searchQuery, setSearchQuery] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [showNameModal, setShowNameModal] = useState(false)
  const [newName, setNewName] = useState('')
  const { t } = useTranslation()

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return playgrounds
    return playgrounds.filter((p) =>
      searchMatchesAny([p.name, p.description], searchQuery)
    )
  }, [playgrounds, searchQuery])

  const {
    currentPage,
    totalPages,
    paginatedItems: paginated,
    pageNumbers,
    goToPage,
    resetPage,
  } = useCatalogPagination(filtered)

  React.useEffect(() => {
    resetPage()
  }, [searchQuery, resetPage])

  const openCreateModal = () => {
    setNewName('')
    setShowNameModal(true)
  }

  const handleCreate = async () => {
    if (!access_token || isCreating) return
    const name = newName.trim() || 'Untitled Playground'
    setIsCreating(true)
    setShowNameModal(false)
    try {
      const newPlayground = await createPlayground(
        org_id,
        { name, access_type: 'authenticated' },
        access_token
      )
      setPlaygrounds((prev) => [newPlayground, ...prev])
      track(AnalyticsEvent.PlaygroundCreated, {
        name_provided: newName.trim().length > 0,
        source: 'learner',
      })
      queryClient.invalidateQueries({ queryKey: queryKeys.playgrounds.list(orgslug) })
      router.push(`/editor/playground/${newPlayground.playground_uuid}/edit`)
    } catch {
      toast.error(t('playgrounds.failed_create'))
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <>
    <FeatureGate feature="playgrounds" orgslug={orgslug} context="public">
      <div className="w-full">
        <GeneralWrapperStyled>
          <div className="flex flex-col space-y-2 mb-2">
            <div className="flex items-center justify-between">
              <TypeOfContentTitle title={t('common.playgrounds')} type="pg" />
              {isUserAdmin && (
                <button
                  onClick={openCreateModal}
                  disabled={isCreating}
                  className="rounded-lg bg-black transition-all duration-100 ease-linear antialiased p-2 px-5 my-auto font text-xs font-bold text-white nice-shadow flex space-x-2 items-center hover:scale-105 disabled:opacity-50"
                >
                  <div>{t('playgrounds.new_playground')}</div>
                  <div className="text-md bg-neutral-800 px-1 rounded-full">+</div>
                </button>
              )}
            </div>

            {/* Search */}
            {playgrounds.length > 0 && (
              <div className="flex items-center gap-3 mb-4 flex-wrap">
                <div className="relative w-full sm:w-80">
                  <Search className="absolute start-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    aria-label="Search playgrounds"
                    placeholder={t('playgrounds.search_placeholder')}
                    className="w-full ps-10 pe-10 py-2.5 bg-white nice-shadow rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-black focus:ring-offset-2 border-0"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery('')}
                      className="absolute end-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Search results info */}
            {searchQuery && (
              <div className="mb-2 text-sm text-gray-500">
                {filtered.length} result{filtered.length !== 1 ? 's' : ''} for &quot;{searchQuery}&quot;
              </div>
            )}

            {/* Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {paginated.map((pg) => (
                <PlaygroundCard
                  key={pg.playground_uuid}
                  playground={pg}
                  orgslug={orgslug}
                  canEdit={true}
                />
              ))}

              {filtered.length === 0 && searchQuery && (
                <div className="col-span-full flex flex-col justify-center items-center py-12 px-4">
                  <Search className="w-12 h-12 text-gray-300 mb-4" />
                  <h2 className="text-xl font-semibold text-gray-600 mb-2">{t('playgrounds.no_results_for')} &quot;{searchQuery}&quot;</h2>
                  <p className="text-gray-400">{t('playgrounds.try_different_search')}</p>
                </div>
              )}

              {playgrounds.length === 0 && !searchQuery && (
                <div className="col-span-full flex flex-col justify-center items-center py-12 px-4 border-2 border-dashed border-gray-100 rounded-2xl bg-gray-50/30">
                  <div className="p-4 bg-white rounded-full nice-shadow mb-4">
                    <Cube className="w-8 h-8 text-gray-300" />
                  </div>
                  <h1 className="text-xl font-bold text-gray-600 mb-2">{t('playgrounds.no_playgrounds_yet')}</h1>
                  <p className="text-md text-gray-400 mb-6 max-w-xs text-center">
                    {t('playgrounds.playgrounds_description')}
                  </p>
                  {isUserAdmin && (
                    <button
                      onClick={openCreateModal}
                      disabled={isCreating}
                      className="rounded-lg bg-black transition-all duration-100 ease-linear antialiased p-2 px-5 my-auto font text-xs font-bold text-white nice-shadow flex space-x-2 items-center hover:scale-105 disabled:opacity-50"
                    >
                      <div>{t('playgrounds.new_playground')}</div>
                      <div className="text-md bg-neutral-800 px-1 rounded-full">+</div>
                    </button>
                  )}
                </div>
              )}
            </div>

            <CatalogPagination
              currentPage={currentPage}
              totalPages={totalPages}
              pageNumbers={pageNumbers}
              onPageChange={goToPage}
              previousLabel="Previous"
              nextLabel="Next"
              className="mt-8"
            />

            {totalPages > 1 && (
              <div className="mt-2 text-center text-sm text-gray-500">
                Page {currentPage} of {totalPages}
              </div>
            )}
          </div>
        </GeneralWrapperStyled>
      </div>
    </FeatureGate>

    {/* Create name modal */}
    {showNameModal && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={() => setShowNameModal(false)}>
        <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm mx-4" onClick={(e) => e.stopPropagation()}>
          <h2 className="text-base font-bold text-gray-900 mb-1">{t('playgrounds.new_playground_modal_title')}</h2>
          <p className="text-xs text-gray-400 mb-4">{t('playgrounds.new_playground_modal_desc')}</p>
          <input
            autoFocus
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setShowNameModal(false) }}
            placeholder="e.g. Photosynthesis Quiz"
            className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-black focus:border-transparent mb-4"
          />
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowNameModal(false)} className="px-4 py-2 text-sm font-medium text-gray-500 hover:text-gray-700 transition-colors">
              {t('common.cancel')}
            </button>
            <button
              onClick={handleCreate}
              disabled={isCreating}
              className="px-4 py-2 bg-black text-white text-sm font-bold rounded-lg hover:bg-gray-800 disabled:opacity-50 transition-colors"
            >
              {isCreating ? t('playgrounds.creating') : t('playgrounds.create')}
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  )
}
