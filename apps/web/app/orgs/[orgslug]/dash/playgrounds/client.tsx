'use client'

import React, { useState, useMemo } from 'react'
import {
  Plus,
  Search,
  X,
  Globe,
  Lock,
  Users,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Trash2,
  Copy,
  Download,
} from 'lucide-react'
import { Cube } from '@phosphor-icons/react'
import { getPlaygroundThumbnailMediaDirectory } from '@services/media/media'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getAPIUrl } from '@services/config/config'
import useSWR, { mutate } from 'swr'
import { swrFetcher } from '@services/utils/ts/requests'
import {
  createPlayground,
  deletePlayground,
  duplicatePlayground,
} from '@services/playgrounds/playgrounds'
import toast from 'react-hot-toast'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Breadcrumbs } from '@components/Objects/Breadcrumbs/Breadcrumbs'
import AuthenticatedClientElement from '@components/Security/AuthenticatedClientElement'
import PlanRestrictedFeature from '@components/Dashboard/Shared/PlanRestricted/PlanRestrictedFeature'
import FeatureDisabledView from '@components/Dashboard/Shared/FeatureDisabled/FeatureDisabledView'
import { PlanLevel } from '@services/plans/plans'
import { usePlan } from '@components/Hooks/usePlan'

interface PlaygroundsListClientProps {
  org_id: number
  orgslug: string
}

export default function PlaygroundsListClient({ org_id, orgslug }: PlaygroundsListClientProps) {
  const org = useOrg() as any
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const plan = usePlan()
  const router = useRouter()

  const [searchQuery, setSearchQuery] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [isCreating, setIsCreating] = useState(false)
  const [showNameModal, setShowNameModal] = useState(false)
  const [newName, setNewName] = useState('')
  const [selectedUuids, setSelectedUuids] = useState<Set<string>>(new Set())
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const itemsPerPage = 12

  const playgroundsKey = access_token ? `${getAPIUrl()}playgrounds/org/${org_id}` : null

  const { data: playgrounds, isLoading } = useSWR(
    playgroundsKey,
    (url) => swrFetcher(url, access_token),
    { revalidateOnFocus: false }
  )

  const allPlaygrounds: any[] = playgrounds || []

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return allPlaygrounds
    const q = searchQuery.toLowerCase()
    return allPlaygrounds.filter(
      (pg: any) =>
        pg.name?.toLowerCase().includes(q) || pg.description?.toLowerCase().includes(q)
    )
  }, [allPlaygrounds, searchQuery])

  React.useEffect(() => { setCurrentPage(1) }, [searchQuery])

  const totalPages = Math.ceil(filtered.length / itemsPerPage)
  const paginated = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage
    return filtered.slice(start, start + itemsPerPage)
  }, [filtered, currentPage, itemsPerPage])

  const goToPage = (page: number) => {
    if (page >= 1 && page <= totalPages) setCurrentPage(page)
  }

  const getVisiblePages = () => {
    const pages: (number | string)[] = []
    if (totalPages <= 5) {
      for (let i = 1; i <= totalPages; i++) pages.push(i)
    } else if (currentPage <= 3) {
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
    return pages
  }

  const toggleSelect = (uuid: string) => {
    setSelectedUuids((prev) => {
      const next = new Set(prev)
      next.has(uuid) ? next.delete(uuid) : next.add(uuid)
      return next
    })
  }

  const clearSelection = () => setSelectedUuids(new Set())

  const selectedPlaygrounds = allPlaygrounds.filter((pg: any) =>
    selectedUuids.has(pg.playground_uuid)
  )

  // ── Actions ──────────────────────────────────────────────────────────────

  const openCreateModal = () => { setNewName(''); setShowNameModal(true) }

  const handleCreate = async () => {
    if (!access_token || isCreating) return
    const name = newName.trim() || 'Untitled Playground'
    setIsCreating(true)
    setShowNameModal(false)
    try {
      const pg = await createPlayground(org_id, { name, access_type: 'authenticated' }, access_token)
      if (playgroundsKey) mutate(playgroundsKey)
      router.push(`/editor/playground/${pg.playground_uuid}/edit`)
    } catch {
      toast.error('Failed to create playground')
    } finally {
      setIsCreating(false)
    }
  }

  const handleDelete = async () => {
    if (!access_token || selectedUuids.size === 0) return
    const uuids = Array.from(selectedUuids)
    try {
      await Promise.all(uuids.map((uuid) => deletePlayground(uuid, access_token)))
      clearSelection()
      if (playgroundsKey) mutate(playgroundsKey)
      toast.success(`Deleted ${uuids.length} playground${uuids.length > 1 ? 's' : ''}`)
    } catch {
      toast.error('Failed to delete some playgrounds')
    } finally {
      setShowDeleteConfirm(false)
    }
  }

  const handleDuplicate = async () => {
    if (!access_token || selectedUuids.size === 0) return
    const uuids = Array.from(selectedUuids)
    const t = toast.loading(`Duplicating ${uuids.length} playground${uuids.length > 1 ? 's' : ''}…`)
    try {
      await Promise.all(uuids.map((uuid) => duplicatePlayground(uuid, access_token)))
      if (playgroundsKey) mutate(playgroundsKey)
      toast.success(`Duplicated ${uuids.length} playground${uuids.length > 1 ? 's' : ''}`, { id: t })
    } catch {
      toast.error('Failed to duplicate some playgrounds', { id: t })
    }
  }

  const handleDownload = () => {
    for (const pg of selectedPlaygrounds) {
      const html = pg.html_content || ''
      const blob = new Blob([html], { type: 'text/html' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${pg.name || 'playground'}.html`
      a.click()
      URL.revokeObjectURL(url)
    }
  }

  const hasSelection = selectedUuids.size > 0

  return (
    <PlanRestrictedFeature
      currentPlan={plan}
      requiredPlan="pro"
      titleKey="Playgrounds"
      descriptionKey="Create interactive AI-generated experiences for your learners."
    >
      <FeatureDisabledView featureName="playgrounds" orgslug={orgslug} context="dashboard">
        <div className="h-full w-full bg-[#f8f8f8] ps-10 pe-10">

          {/* Header */}
          <div className="mb-6 pt-6">
            <Breadcrumbs
              items={[{ label: 'Playgrounds', href: '/dash/playgrounds', icon: <Cube size={14} /> }]}
            />
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mt-4">
              <h1 className="text-3xl font-bold mb-4 sm:mb-0">Playgrounds</h1>
              <AuthenticatedClientElement
                checkMethod="roles"
                action="create"
                ressourceType="playgrounds"
                orgId={org_id}
              >
                <button
                  onClick={openCreateModal}
                  disabled={isCreating}
                  className="rounded-lg bg-black transition-all duration-100 ease-linear antialiased p-2 px-5 my-auto font text-xs font-bold text-white nice-shadow flex space-x-2 items-center hover:scale-105 disabled:opacity-50"
                >
                  <div>New Playground</div>
                  <div className="text-md bg-neutral-800 px-1 rounded-full">+</div>
                </button>
              </AuthenticatedClientElement>
            </div>
          </div>

          {/* Search + selection action bar */}
          {allPlaygrounds.length > 0 && (
            <div className="mb-6 flex flex-wrap gap-3 items-center">
              {/* Search — hidden while selection is active */}
              {!hasSelection && (
                <div className="relative w-full sm:w-80">
                  <Search className="absolute start-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search playgrounds..."
                    className="w-full ps-10 pe-10 py-2.5 bg-white nice-shadow rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-black focus:ring-offset-2 border-0"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery('')}
                      className="absolute end-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              )}

              {/* Selection action bar */}
              {hasSelection && (
                <div className="flex items-center gap-2 bg-white nice-shadow rounded-lg px-3 py-2">
                  <span className="text-xs font-semibold text-gray-700 pe-2 border-e border-gray-200">
                    {selectedUuids.size} selected
                  </span>
                  <button
                    onClick={handleDuplicate}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 rounded-md transition-colors"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    Duplicate
                  </button>
                  <button
                    onClick={handleDownload}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 rounded-md transition-colors"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Download
                  </button>
                  <button
                    onClick={() => setShowDeleteConfirm(true)}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 rounded-md transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Delete
                  </button>
                  <button
                    onClick={clearSelection}
                    className="ms-1 text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Grid */}
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
              {paginated.map((pg: any) => (
                <PlaygroundCard
                  key={pg.playground_uuid}
                  playground={pg}
                  selected={selectedUuids.has(pg.playground_uuid)}
                  onToggleSelect={() => toggleSelect(pg.playground_uuid)}
                />
              ))}

              {filtered.length === 0 && searchQuery && (
                <div className="col-span-full flex justify-center items-center py-8 text-center">
                  <div>
                    <Search className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                    <h2 className="text-xl font-semibold text-gray-600 mb-2">No playgrounds found</h2>
                    <p className="text-gray-400">Try a different search term</p>
                  </div>
                </div>
              )}

              {allPlaygrounds.length === 0 && !searchQuery && (
                <div className="col-span-full flex justify-center items-center py-8 text-center">
                  <div>
                    <div className="rounded-full bg-gray-100 p-4 w-fit mx-auto mb-4">
                      <Cube size={24} className="text-gray-400" />
                    </div>
                    <h2 className="text-2xl font-bold text-gray-600 mb-2">No playgrounds yet</h2>
                    <p className="text-lg text-gray-400">
                      Create interactive AI-generated experiences for your learners.
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <>
              <div className="mt-8 mb-6 flex items-center justify-center gap-2">
                <button
                  onClick={() => goToPage(currentPage - 1)}
                  disabled={currentPage === 1}
                  className="flex items-center gap-1 px-3 py-2 text-sm font-medium text-gray-600 bg-white nice-shadow rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                  <span className="hidden sm:inline">Previous</span>
                </button>
                <div className="flex items-center gap-1">
                  {getVisiblePages().map((page, index) => (
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
                  <span className="hidden sm:inline">Next</span>
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
              <div className="mb-6 text-center text-sm text-gray-500">
                Page {currentPage} of {totalPages}
              </div>
            </>
          )}
        </div>
      </FeatureDisabledView>

      {/* Create modal */}
      {showNameModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm"
          onClick={() => setShowNameModal(false)}
        >
          <div
            className="bg-white rounded-2xl nice-shadow p-6 w-full max-w-sm mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-bold text-gray-900 mb-1">New Playground</h2>
            <p className="text-xs text-gray-400 mb-4">Give your playground a name to get started.</p>
            <input
              autoFocus
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreate()
                if (e.key === 'Escape') setShowNameModal(false)
              }}
              placeholder="e.g. Photosynthesis Quiz"
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-black focus:border-transparent mb-4"
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowNameModal(false)}
                className="px-4 py-2 text-sm font-medium text-gray-500 hover:text-gray-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={isCreating}
                className="px-4 py-2 bg-black text-white text-sm font-bold rounded-lg hover:bg-gray-800 disabled:opacity-50 transition-colors"
              >
                {isCreating ? 'Creating…' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {showDeleteConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm"
          onClick={() => setShowDeleteConfirm(false)}
        >
          <div
            className="bg-white rounded-2xl nice-shadow p-6 w-full max-w-sm mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-bold text-gray-900 mb-1">
              Delete {selectedUuids.size} playground{selectedUuids.size > 1 ? 's' : ''}
            </h2>
            <p className="text-sm text-gray-500 mb-5">
              This action is permanent and cannot be undone.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="px-4 py-2 text-sm font-medium text-gray-500 hover:text-gray-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                className="px-4 py-2 bg-red-600 text-white text-sm font-bold rounded-lg hover:bg-red-700 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </PlanRestrictedFeature>
  )
}

function PlaygroundCard({
  playground,
  selected,
  onToggleSelect,
}: {
  playground: any
  selected: boolean
  onToggleSelect: () => void
}) {
  const accessBadge = {
    public: { icon: <Globe size={10} />, label: 'Public', className: 'bg-green-100 text-green-700' },
    authenticated: { icon: <Users size={10} />, label: 'Members', className: 'bg-blue-100 text-blue-700' },
    restricted: { icon: <Lock size={10} />, label: 'Restricted', className: 'bg-amber-100 text-amber-700' },
  }[playground.access_type as string] ?? { icon: <Lock size={10} />, label: 'Private', className: 'bg-gray-100 text-gray-600' }

  const thumbnailUrl =
    playground.thumbnail_image && playground.org_uuid
      ? getPlaygroundThumbnailMediaDirectory(
          playground.org_uuid,
          playground.playground_uuid,
          playground.thumbnail_image
        )
      : null

  return (
    <div
      className={`group relative flex flex-col bg-white rounded-xl nice-shadow overflow-hidden w-full transition-all duration-200 hover:scale-[1.01] cursor-pointer ${
        selected ? 'ring-2 ring-black' : ''
      }`}
      onClick={onToggleSelect}
    >
      {/* Checkbox */}
      <div
        className={`absolute top-2 end-2 z-20 w-5 h-5 rounded flex items-center justify-center transition-all border ${
          selected
            ? 'bg-black border-black'
            : 'bg-white/80 border-gray-300 opacity-0 group-hover:opacity-100'
        }`}
      >
        {selected && (
          <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 12 12">
            <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </div>

      <div className="relative aspect-video overflow-hidden bg-gray-50 flex items-center justify-center">
        {thumbnailUrl ? (
          <img
            src={thumbnailUrl}
            alt={playground.name}
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100">
            <Cube size={32} className="text-gray-300" />
          </div>
        )}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/5 transition-colors duration-300" />
        <div className="absolute bottom-2 start-2 flex items-center gap-1.5">
          <span className={`flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide rounded-full ${accessBadge.className}`}>
            {accessBadge.icon}
            {accessBadge.label}
          </span>
          {!playground.published && (
            <span className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide bg-gray-100 text-gray-500 rounded-full">
              Draft
            </span>
          )}
        </div>
      </div>

      <div className="p-3 flex flex-col space-y-1.5">
        <h3 className="text-base font-bold text-gray-900 leading-tight line-clamp-1">
          {playground.name}
        </h3>
        {playground.description && (
          <p className="text-[11px] text-gray-500 line-clamp-2 min-h-[1.5rem]">
            {playground.description}
          </p>
        )}
      </div>

      <div className="px-3 pb-3 pt-0 flex items-center justify-end border-t border-gray-100 mt-auto">
        <Link
          href={`/editor/playground/${playground.playground_uuid}/edit`}
          className="pt-2 flex items-center gap-1 text-[10px] font-bold text-gray-400 hover:text-gray-900 transition-colors uppercase tracking-wider"
          onClick={(e) => e.stopPropagation()}
        >
          <Pencil size={12} />
          Edit
        </Link>
      </div>
    </div>
  )
}
