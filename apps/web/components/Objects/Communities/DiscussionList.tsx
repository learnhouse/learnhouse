'use client'
import React, { useState, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { MessageCircle, Plus, Loader2, Search, X, Trash2, CheckSquare, Square } from 'lucide-react'
import { DiscussionCard } from './DiscussionCard'
import { SortDropdown } from './SortDropdown'
import { LabelFilter } from './LabelFilter'
import {
  deleteDiscussion,
  getCommentCount,
  DiscussionSortBy,
  DiscussionWithAuthor,
} from '@services/communities/discussions'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrgMembership } from '@components/Contexts/OrgContext'
import { useCommunityRights } from '@components/Hooks/useCommunityRights'
import { useDiscussions, mutateDiscussions } from '@components/Hooks/useDiscussions'
import ConfirmationModal from '@components/Objects/StyledElements/ConfirmationModal/ConfirmationModal'

interface DiscussionListProps {
  communityUuid: string
  orgslug: string
  onCreateClick?: () => void
  initialDiscussions?: DiscussionWithAuthor[]
}

export function DiscussionList({
  communityUuid,
  orgslug,
  onCreateClick,
  initialDiscussions = [],
}: DiscussionListProps) {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const { isUserPartOfTheOrg } = useOrgMembership()
  const { canCreateDiscussion: hasCreatePermission, canManageCommunity } = useCommunityRights(communityUuid)
  const canCreateDiscussion = hasCreatePermission && isUserPartOfTheOrg
  const accessToken = session?.data?.tokens?.access_token

  const [sortBy, setSortBy] = useState<DiscussionSortBy>('recent')
  const [searchQuery, setSearchQuery] = useState('')
  const [commentCounts, setCommentCounts] = useState<Record<string, number>>({})
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null)

  // Selection state
  const [isSelectMode, setIsSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [isDeleting, setIsDeleting] = useState(false)

  // Use SWR for fetching discussions
  const { discussions: swrDiscussions, isLoading, mutate } = useDiscussions({
    communityUuid,
    sortBy,
    page: 1,
    limit: 50, // Fetch more initially since we're not paginating for now
    label: selectedLabel,
  })

  // Use SWR data, fall back to initial data if SWR hasn't loaded yet
  const discussions = swrDiscussions.length > 0 ? swrDiscussions : initialDiscussions

  const fetchCommentCounts = async (discussionList: DiscussionWithAuthor[]) => {
    if (!discussionList.length) return
    try {
      const counts = await Promise.all(
        discussionList.map(async (d) => {
          try {
            const count = await getCommentCount(d.discussion_uuid, null, accessToken)
            return { uuid: d.discussion_uuid, count }
          } catch {
            return { uuid: d.discussion_uuid, count: 0 }
          }
        })
      )
      setCommentCounts(prev => {
        const newCounts = { ...prev }
        counts.forEach(({ uuid, count }) => {
          newCounts[uuid] = count
        })
        return newCounts
      })
    } catch (error) {
      console.error('Failed to fetch comment counts:', error)
    }
  }

  // Fetch comment counts when discussions change
  useEffect(() => {
    if (discussions.length > 0) {
      // Only fetch counts for discussions we don't have counts for
      const newDiscussions = discussions.filter(d => !(d.discussion_uuid in commentCounts))
      if (newDiscussions.length > 0) {
        fetchCommentCounts(newDiscussions)
      }
    }
  }, [discussions])

  const handleSortChange = (newSort: DiscussionSortBy) => {
    setSortBy(newSort)
  }

  const handleLabelChange = (label: string | null) => {
    setSelectedLabel(label)
  }

  // Filter discussions based on search query
  const filteredDiscussions = useMemo(() => {
    if (!searchQuery.trim()) return discussions
    const query = searchQuery.toLowerCase()
    return discussions.filter(d =>
      d.title.toLowerCase().includes(query) ||
      (d.author?.username?.toLowerCase().includes(query)) ||
      (d.author?.first_name?.toLowerCase().includes(query)) ||
      (d.author?.last_name?.toLowerCase().includes(query))
    )
  }, [discussions, searchQuery])

  // Selection handlers
  const toggleSelectMode = () => {
    setIsSelectMode(!isSelectMode)
    setSelectedIds(new Set())
  }

  const toggleSelection = (discussionUuid: string) => {
    const newSelected = new Set(selectedIds)
    if (newSelected.has(discussionUuid)) {
      newSelected.delete(discussionUuid)
    } else {
      newSelected.add(discussionUuid)
    }
    setSelectedIds(newSelected)
  }

  const selectAll = () => {
    if (selectedIds.size === filteredDiscussions.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(filteredDiscussions.map(d => d.discussion_uuid)))
    }
  }

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0 || !accessToken) return

    setIsDeleting(true)
    try {
      // Delete discussions one by one
      const deletePromises = Array.from(selectedIds).map(uuid =>
        deleteDiscussion(uuid, accessToken)
      )
      await Promise.all(deletePromises)

      // Revalidate SWR cache
      mutateDiscussions(communityUuid)
      setSelectedIds(new Set())
      setIsSelectMode(false)
    } catch (error) {
      console.error('Failed to delete discussions:', error)
    } finally {
      setIsDeleting(false)
    }
  }

  const handleDiscussionUpdate = (updated: DiscussionWithAuthor) => {
    // Optimistically update the local cache
    mutate(
      (current) => current?.map(d =>
        d.discussion_uuid === updated.discussion_uuid ? updated : d
      ),
      false
    )
  }

  const handleDiscussionDelete = (discussionUuid: string) => {
    // Optimistically update the local cache
    mutate(
      (current) => current?.filter(d => d.discussion_uuid !== discussionUuid),
      false
    )
  }

  const allSelected = filteredDiscussions.length > 0 && selectedIds.size === filteredDiscussions.length

  return (
    <div>
      {/* Header with Search and Filters */}
      <div className="p-4 border-b border-gray-100 space-y-3">
        {/* Search Bar */}
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder={t('communities.discussion_list.search_placeholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-9 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-300 transition-all"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* Filters and Actions Row */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <LabelFilter value={selectedLabel} onChange={handleLabelChange} />
            <SortDropdown value={sortBy} onChange={handleSortChange} />
            <span className="text-xs text-gray-400">
              {filteredDiscussions.length} {filteredDiscussions.length === 1 ? t('communities.discussion') : t('communities.discussions')}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {/* Select Mode Toggle for Admins */}
            {canManageCommunity && filteredDiscussions.length > 0 && (
              <button
                onClick={toggleSelectMode}
                className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md transition-colors h-8 ${
                  isSelectMode
                    ? 'bg-indigo-100 text-indigo-700'
                    : 'bg-gray-50 border border-gray-200 text-gray-600 hover:bg-gray-100'
                }`}
              >
                <CheckSquare size={14} />
                {isSelectMode ? t('communities.discussion_list.cancel') : t('communities.discussion_list.select')}
              </button>
            )}

            {/* Desktop create button */}
            {canCreateDiscussion && onCreateClick && !isSelectMode && (
              <button
                onClick={onCreateClick}
                className="hidden md:flex items-center gap-2 px-3 py-2 h-8 bg-neutral-900 hover:bg-neutral-800 text-white rounded-md transition-colors text-xs font-medium"
              >
                <Plus size={14} />
                {t('communities.discussion_list.new_discussion')}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Selection Action Bar */}
      {isSelectMode && selectedIds.size > 0 && (
        <div className="px-4 py-3 bg-indigo-50 border-b border-indigo-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={selectAll}
              className="flex items-center gap-1.5 text-xs text-indigo-700 hover:text-indigo-800"
            >
              {allSelected ? <CheckSquare size={14} /> : <Square size={14} />}
              {allSelected ? t('communities.discussion_list.deselect_all') : t('communities.discussion_list.select_all')}
            </button>
            <span className="text-xs text-indigo-600 font-medium">
              {selectedIds.size} {t('communities.discussion_list.selected')}
            </span>
          </div>

          <ConfirmationModal
            confirmationMessage={t('communities.discussion_list.delete_discussions_confirm', { count: selectedIds.size, type: selectedIds.size === 1 ? t('communities.discussion') : t('communities.discussions') })}
            confirmationButtonText={t('communities.discussion_list.delete')}
            dialogTitle={selectedIds.size === 1 ? t('communities.discussion_list.delete_discussions_title', { count: selectedIds.size }) : t('communities.discussion_list.delete_discussions_title_plural', { count: selectedIds.size })}
            dialogTrigger={
              <button
                disabled={isDeleting}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-md text-xs font-medium transition-colors disabled:opacity-50"
              >
                {isDeleting ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Trash2 size={14} />
                )}
                {t('communities.discussion_list.delete')}
              </button>
            }
            functionToExecute={handleBulkDelete}
            status="warning"
          />
        </div>
      )}

      {/* Discussion List */}
      <div>
        {filteredDiscussions.length === 0 && !isLoading ? (
          <div className="flex flex-col items-center justify-center py-16 px-4">
            <div className="p-4 bg-gray-50 rounded-full mb-4">
              <MessageCircle size={28} className="text-gray-300" />
            </div>
            {searchQuery ? (
              <>
                <h3 className="text-base font-semibold text-gray-600 mb-1">{t('communities.discussion_list.no_results')}</h3>
                <p className="text-sm text-gray-400 text-center max-w-xs mb-4">
                  {t('communities.discussion_list.no_results_description')}
                </p>
                <button
                  onClick={() => setSearchQuery('')}
                  className="text-sm text-indigo-600 hover:text-indigo-700 font-medium"
                >
                  {t('communities.discussion_list.clear_search')}
                </button>
              </>
            ) : (
              <>
                <h3 className="text-base font-semibold text-gray-600 mb-1">{t('communities.discussion_list.no_discussions')}</h3>
                <p className="text-sm text-gray-400 text-center max-w-xs mb-4">
                  {t('communities.discussion_list.no_discussions_description')}
                </p>
                {canCreateDiscussion && onCreateClick && (
                  <button
                    onClick={onCreateClick}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-neutral-900 hover:bg-neutral-800 text-white rounded-lg transition-colors text-sm font-medium"
                  >
                    <Plus size={16} />
                    {t('communities.discussion_list.start_discussion')}
                  </button>
                )}
              </>
            )}
          </div>
        ) : (
          <>
            {isLoading && discussions.length === 0 ? (
              <div className="flex justify-center py-8">
                <Loader2 size={24} className="animate-spin text-gray-400" />
              </div>
            ) : (
              filteredDiscussions.map((discussion) => (
                <DiscussionCard
                  key={discussion.discussion_uuid}
                  discussion={discussion}
                  orgslug={orgslug}
                  communityUuid={communityUuid}
                  commentCount={commentCounts[discussion.discussion_uuid] || 0}
                  isSelectMode={isSelectMode}
                  isSelected={selectedIds.has(discussion.discussion_uuid)}
                  onToggleSelect={() => toggleSelection(discussion.discussion_uuid)}
                  canManage={canManageCommunity}
                  onDiscussionUpdate={handleDiscussionUpdate}
                  onDiscussionDelete={handleDiscussionDelete}
                />
              ))
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default DiscussionList
