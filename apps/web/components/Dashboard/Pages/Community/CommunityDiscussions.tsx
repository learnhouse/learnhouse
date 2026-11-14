'use client'
import React, { useDeferredValue, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  ArrowsDownUp,
  ChatCenteredText,
  ChatCircleDots,
  Check,
  CheckCircle,
  DotsThree,
  Eye,
  LockSimple,
  LockSimpleOpen,
  PencilSimple,
  PushPin,
  PushPinSlash,
  Question,
  Tag,
  Trash,
  Tray,
} from '@phosphor-icons/react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@components/ui/dropdown-menu'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { useCommunity } from '@components/Contexts/CommunityContext'
import { useCommunityRights } from '@components/Hooks/useCommunityRights'
import {
  DISCUSSION_LABELS,
  deleteDiscussion,
  lockDiscussion,
  pinDiscussion,
  type DiscussionWithAuthor,
} from '@services/communities/discussions'
import { getUriWithOrg } from '@services/config/config'
import { searchMatchesAny } from '@/lib/search/normalize'
import { EditDiscussionModal } from '@components/Objects/Modals/Communities/EditDiscussionModal'
import {
  BulkActionBar,
  BulkActionButton,
  Chip,
  ConfirmDialog,
  EmptyState,
  SearchInput,
  SegmentedControl,
  StatCard,
  ToolbarSelect,
  formatRelative,
  useStoredState,
} from '@components/Dashboard/Shared/DashKit/DashKit'
import {
  dashCommunityKeys,
  getAllDiscussions,
  useDiscussionActivity,
} from 'app/orgs/[orgslug]/dash/communities/_components/communityActivity'
import DiscussionReader from './DiscussionReader'
import { AuthorAvatar, LabelChip, authorName } from './discussionUi'

type Filter = 'all' | 'unanswered' | 'pinned' | 'locked'
type SortKey = 'activity' | 'newest' | 'replies' | 'votes'
const SORT_KEYS = ['activity', 'newest', 'replies', 'votes'] as const

// Subgrid table, as in the courses list: rows span the card's grid so the
// columns line up.
const TABLE_GRID =
  'lg:grid lg:grid-cols-[auto_minmax(0,3fr)_minmax(0,0.6fr)_minmax(0,0.9fr)_minmax(0,1fr)_auto] lg:gap-x-4'
const ROW_GRID = 'lg:col-span-full lg:grid lg:grid-cols-subgrid lg:items-center lg:gap-x-4'

const timeOf = (value?: string | null) => {
  const time = value ? new Date(value).getTime() : NaN
  return isNaN(time) ? 0 : time
}

type Row = DiscussionWithAuthor & { replies: number | null; lastActivity: string }

// Runs `task` over the items a few at a time.
async function runPool<T>(items: T[], task: (_item: T) => Promise<unknown>, concurrency = 4) {
  let index = 0
  let failed = 0
  const worker = async () => {
    while (index < items.length) {
      const item = items[index++]
      try {
        await task(item)
      } catch {
        failed++
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker))
  return failed
}

export default function CommunityDiscussions({ orgslug }: { orgslug: string }) {
  const { t, i18n } = useTranslation()
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token
  const org = useOrg() as any
  const community = useCommunity()?.community
  const communityUuid = community?.community_uuid ?? ''
  const queryClient = useQueryClient()
  const { canManageCommunity, hasPermission } = useCommunityRights(communityUuid)
  const canModerate = canManageCommunity || hasPermission('update')

  const listKey = dashCommunityKeys.discussions(communityUuid)
  const { data, isLoading } = useQuery({
    queryKey: listKey,
    queryFn: () => getAllDiscussions(communityUuid, accessToken),
    enabled: !!communityUuid && !!accessToken,
    staleTime: 20_000,
  })
  const { data: activity } = useDiscussionActivity(communityUuid || undefined, accessToken)
  // Reply counts come from one summary call; when the API predates it the
  // counts (and the "unanswered" view) are simply not shown.
  const activityMap = useMemo(() => {
    if (!activity) return null
    return new Map(activity.map((a) => [a.discussion_uuid, a]))
  }, [activity])

  const rows: Row[] = useMemo(
    () =>
      (Array.isArray(data) ? data : []).map((d) => {
        const a = activityMap?.get(d.discussion_uuid)
        const lastActivity =
          a?.last_comment_date && timeOf(a.last_comment_date) > timeOf(d.creation_date) ? a.last_comment_date : d.creation_date
        return { ...d, replies: activityMap ? (a?.comment_count ?? 0) : null, lastActivity }
      }),
    [data, activityMap]
  )

  // ---- filters ----
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search)
  const [filter, setFilter] = useState<Filter>('all')
  const [label, setLabel] = useState('')
  const [sort, setSort] = useStoredState<SortKey>('lh_dash_community_threads_sort', 'activity', SORT_KEYS)

  const stats = useMemo(
    () => ({
      total: rows.length,
      unanswered: activityMap ? rows.filter((r) => r.replies === 0).length : null,
      pinned: rows.filter((r) => r.is_pinned).length,
      locked: rows.filter((r) => r.is_locked).length,
    }),
    [rows, activityMap]
  )

  const filtered = useMemo(() => {
    let list = rows
    if (filter === 'unanswered') list = list.filter((r) => r.replies === 0)
    if (filter === 'pinned') list = list.filter((r) => r.is_pinned)
    if (filter === 'locked') list = list.filter((r) => r.is_locked)
    if (label) list = list.filter((r) => (r.label || 'general') === label)
    if (deferredSearch.trim()) {
      list = list.filter((r) =>
        searchMatchesAny([r.title, r.author?.username, r.author?.first_name, r.author?.last_name], deferredSearch)
      )
    }
    const sorted = [...list]
    if (sort === 'newest') sorted.sort((a, b) => timeOf(b.creation_date) - timeOf(a.creation_date))
    else if (sort === 'replies') sorted.sort((a, b) => (b.replies ?? 0) - (a.replies ?? 0))
    else if (sort === 'votes') sorted.sort((a, b) => b.upvote_count - a.upvote_count)
    else sorted.sort((a, b) => timeOf(b.lastActivity) - timeOf(a.lastActivity))
    // Pinned threads stay on top, as members see them.
    return sorted.sort((a, b) => Number(b.is_pinned) - Number(a.is_pinned))
  }, [rows, filter, label, deferredSearch, sort])

  const hasActiveFilters = !!search || filter !== 'all' || !!label
  const clearFilters = () => {
    setSearch('')
    setFilter('all')
    setLabel('')
  }

  // ---- cache helpers ----
  const patchRows = (uuids: string[], patch: Partial<DiscussionWithAuthor>) => {
    const set = new Set(uuids)
    const previous = queryClient.getQueryData<DiscussionWithAuthor[]>(listKey)
    queryClient.setQueryData<DiscussionWithAuthor[]>(listKey, (old) =>
      (old ?? []).map((d) => (set.has(d.discussion_uuid) ? { ...d, ...patch } : d))
    )
    return () => queryClient.setQueryData(listKey, previous)
  }
  const removeRows = (uuids: string[]) => {
    const set = new Set(uuids)
    const previous = queryClient.getQueryData<DiscussionWithAuthor[]>(listKey)
    queryClient.setQueryData<DiscussionWithAuthor[]>(listKey, (old) => (old ?? []).filter((d) => !set.has(d.discussion_uuid)))
    return () => queryClient.setQueryData(listKey, previous)
  }
  // Learner views cache threads under ['community', uuid, 'discussions', ...].
  const refreshRelated = () => {
    queryClient.invalidateQueries({ queryKey: ['community', communityUuid, 'discussions'] })
    queryClient.invalidateQueries({ queryKey: dashCommunityKeys.discussionActivity(communityUuid) })
    if (org?.id) queryClient.invalidateQueries({ queryKey: dashCommunityKeys.orgActivity(org.id) })
  }

  // ---- single actions (optimistic) ----
  const togglePin = async (d: DiscussionWithAuthor) => {
    const next = !d.is_pinned
    const rollback = patchRows([d.discussion_uuid], { is_pinned: next })
    try {
      await pinDiscussion(d.discussion_uuid, next, accessToken)
      toast.success(next ? t('communities.dash.discussions.pinned_toast') : t('communities.dash.discussions.unpinned_toast'))
      refreshRelated()
    } catch {
      rollback()
      toast.error(t('communities.discussion_card.pin_failed'))
    }
  }
  const toggleLock = async (d: DiscussionWithAuthor) => {
    const next = !d.is_locked
    const rollback = patchRows([d.discussion_uuid], { is_locked: next })
    try {
      await lockDiscussion(d.discussion_uuid, next, accessToken)
      toast.success(next ? t('communities.dash.discussions.locked_toast') : t('communities.dash.discussions.unlocked_toast'))
      refreshRelated()
    } catch {
      rollback()
      toast.error(t('communities.discussion_card.lock_failed'))
    }
  }
  const remove = async (uuids: string[]) => {
    const rollback = removeRows(uuids)
    if (readerUuid && uuids.includes(readerUuid)) setReaderUuid(null)
    const failed = await runPool(uuids, (uuid) => deleteDiscussion(uuid, accessToken))
    if (failed) {
      rollback()
      toast.error(t('communities.dash.discussions.bulk_partial', { count: failed }))
      queryClient.invalidateQueries({ queryKey: listKey })
    } else {
      toast.success(t('communities.dash.discussions.deleted_toast', { count: uuids.length }))
    }
    setSelected(new Set())
    refreshRelated()
  }

  // ---- selection + bulk ----
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const visibleSelected = useMemo(() => {
    const visible = new Set(filtered.map((r) => r.discussion_uuid))
    return [...selected].filter((u) => visible.has(u))
  }, [selected, filtered])
  const allSelected = filtered.length > 0 && visibleSelected.length === filtered.length
  const toggleSelect = (uuid: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(uuid)) next.delete(uuid)
      else next.add(uuid)
      return next
    })
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(filtered.map((r) => r.discussion_uuid)))

  const bulkSet = async (key: 'is_pinned' | 'is_locked', value: boolean) => {
    const uuids = visibleSelected
    const rollback = patchRows(uuids, { [key]: value })
    const failed = await runPool(uuids, (uuid) =>
      key === 'is_pinned' ? pinDiscussion(uuid, value, accessToken) : lockDiscussion(uuid, value, accessToken)
    )
    if (failed) {
      rollback()
      toast.error(t('communities.dash.discussions.bulk_partial', { count: failed }))
      queryClient.invalidateQueries({ queryKey: listKey })
    } else {
      toast.success(t('communities.dash.discussions.bulk_done', { count: uuids.length }))
    }
    setSelected(new Set())
    refreshRelated()
  }

  // ---- reader / edit / delete dialogs ----
  const [readerUuid, setReaderUuid] = useState<string | null>(null)
  const [editing, setEditing] = useState<DiscussionWithAuthor | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string[] | null>(null)
  const reader = rows.find((r) => r.discussion_uuid === readerUuid) ?? null

  const publicThreadHref = (d: DiscussionWithAuthor) =>
    getUriWithOrg(orgslug, `/community/${communityUuid.replace('community_', '')}/discussion/${d.discussion_uuid.replace('discussion_', '')}`)

  if (!community) return null

  const loading = isLoading && !data
  const allowRichContent = !!community.moderation_settings?.allow_rich_content

  const rowMenu = (d: Row) => (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          aria-label={t('communities.dash.discussions.thread_actions')}
          className="h-8 w-8 inline-flex items-center justify-center rounded-lg text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100 data-[state=open]:bg-neutral-100 transition-colors"
        >
          <DotsThree size={18} weight="bold" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52 rounded-xl p-1.5" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuItem onSelect={() => setReaderUuid(d.discussion_uuid)} className="flex items-center gap-2 cursor-pointer">
          <Eye size={15} /> {t('communities.dash.discussions.open')}
        </DropdownMenuItem>
        {canModerate && (
          <>
            <DropdownMenuItem onSelect={() => togglePin(d)} className="flex items-center gap-2 cursor-pointer">
              {d.is_pinned ? <PushPinSlash size={15} /> : <PushPin size={15} />}
              {d.is_pinned ? t('communities.discussion_card.unpin_discussion') : t('communities.discussion_card.pin_discussion')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => toggleLock(d)} className="flex items-center gap-2 cursor-pointer">
              {d.is_locked ? <LockSimpleOpen size={15} /> : <LockSimple size={15} />}
              {d.is_locked ? t('communities.discussion_card.unlock_discussion') : t('communities.discussion_card.lock_discussion')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setEditing(d)} className="flex items-center gap-2 cursor-pointer">
              <PencilSimple size={15} /> {t('communities.dash.discussions.edit')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => setConfirmDelete([d.discussion_uuid])}
              className="flex items-center gap-2 cursor-pointer text-rose-600 focus:text-rose-700 focus:bg-rose-50"
            >
              <Trash size={15} /> {t('communities.discussion_card.delete_discussion')}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )

  return (
    <>
      {/* Stats double as quick filters */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          icon={<ChatCenteredText size={16} />}
          iconClass="bg-neutral-100 text-neutral-600"
          label={t('communities.dash.discussions.stats.total')}
          value={loading ? null : stats.total}
          active={!hasActiveFilters}
          onClick={clearFilters}
        />
        <StatCard
          icon={<Question size={16} />}
          iconClass="bg-amber-50 text-amber-600"
          label={t('communities.dash.discussions.stats.unanswered')}
          value={loading ? null : (stats.unanswered ?? '—')}
          active={filter === 'unanswered'}
          onClick={activityMap ? () => setFilter(filter === 'unanswered' ? 'all' : 'unanswered') : undefined}
        />
        <StatCard
          icon={<PushPin size={16} />}
          iconClass="bg-sky-50 text-sky-600"
          label={t('communities.dash.discussions.stats.pinned')}
          value={loading ? null : stats.pinned}
          active={filter === 'pinned'}
          onClick={() => setFilter(filter === 'pinned' ? 'all' : 'pinned')}
        />
        <StatCard
          icon={<LockSimple size={16} />}
          iconClass="bg-violet-50 text-violet-600"
          label={t('communities.dash.discussions.stats.locked')}
          value={loading ? null : stats.locked}
          active={filter === 'locked'}
          onClick={() => setFilter(filter === 'locked' ? 'all' : 'locked')}
        />
      </div>

      {/* Toolbar */}
      <div className="flex flex-col xl:flex-row xl:flex-wrap gap-3 xl:items-center">
        {/* Wrapped so the search keeps a usable width when the filters are wide. */}
        <div className="w-full xl:w-auto xl:flex-1 xl:min-w-[260px] xl:max-w-md flex">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder={t('communities.dash.discussions.search_placeholder')}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 xl:ms-auto">
          <SegmentedControl<Filter>
            value={filter}
            onChange={setFilter}
            ariaLabel={t('communities.dash.discussions.filter_label')}
            options={[
              { key: 'all', label: t('communities.dash.filters.all') },
              ...(activityMap ? [{ key: 'unanswered' as Filter, label: t('communities.dash.discussions.filters.unanswered') }] : []),
              { key: 'pinned', label: t('communities.dash.discussions.filters.pinned') },
              { key: 'locked', label: t('communities.dash.discussions.filters.locked') },
            ]}
          />
          <ToolbarSelect
            value={label}
            onChange={setLabel}
            ariaLabel={t('communities.dash.discussions.label_filter')}
            icon={<Tag size={14} />}
            options={[
              { value: '', label: t('communities.dash.discussions.all_labels') },
              ...DISCUSSION_LABELS.map((l) => ({ value: l.id, label: t(`communities.labels.${l.id}`, { defaultValue: l.name }) })),
            ]}
          />
          <ToolbarSelect
            value={sort}
            onChange={(v) => setSort(v as SortKey)}
            ariaLabel={t('communities.dash.sort.label')}
            icon={<ArrowsDownUp size={14} />}
            options={[
              { value: 'activity', label: t('communities.dash.discussions.sort.activity') },
              { value: 'newest', label: t('communities.dash.discussions.sort.newest') },
              ...(activityMap ? [{ value: 'replies', label: t('communities.dash.discussions.sort.replies') }] : []),
              { value: 'votes', label: t('communities.dash.discussions.sort.votes') },
            ]}
          />
        </div>
      </div>

      {!loading && rows.length > 0 && (
        <div className="flex items-center justify-between gap-3 -mt-1 text-xs text-neutral-500">
          <span className="tabular-nums">{t('communities.dash.showing_count', { shown: filtered.length, total: rows.length })}</span>
          {hasActiveFilters && (
            <button type="button" onClick={clearFilters} className="font-semibold text-neutral-700 hover:text-neutral-900">
              {t('communities.dash.clear_filters')}
            </button>
          )}
        </div>
      )}

      {loading ? (
        <div className="bg-white rounded-2xl nice-shadow overflow-hidden divide-y divide-neutral-100 animate-pulse">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-5 py-4">
              <div className="w-5 h-5 rounded-md bg-neutral-100" />
              <div className="w-7 h-7 rounded-full bg-neutral-100" />
              <div className="flex-1 space-y-2">
                <div className="h-3.5 bg-neutral-100 rounded w-1/3" />
                <div className="h-3 bg-neutral-100 rounded w-1/5" />
              </div>
              <div className="hidden sm:block h-6 w-16 bg-neutral-100 rounded-full" />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl nice-shadow">
          {hasActiveFilters ? (
            <EmptyState
              icon={<Tray size={22} />}
              title={t('communities.dash.discussions.empty_filtered')}
              description={t('communities.dash.empty_filtered_description')}
              action={
                <button type="button" onClick={clearFilters} className="text-xs font-semibold text-neutral-700 hover:text-neutral-900">
                  {t('communities.dash.clear_filters')}
                </button>
              }
            />
          ) : (
            <EmptyState
              icon={<ChatCenteredText size={22} />}
              title={t('communities.dash.discussions.empty')}
              description={t('communities.dash.discussions.empty_description')}
              action={
                <a
                  href={getUriWithOrg(orgslug, `/community/${communityUuid.replace('community_', '')}`)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs font-semibold text-neutral-700 hover:text-neutral-900 underline underline-offset-2"
                >
                  {t('dashboard.courses.communities.card.view_community')}
                </a>
              }
            />
          )}
        </div>
      ) : (
        <div className={`bg-white rounded-2xl nice-shadow overflow-hidden ${TABLE_GRID}`}>
          <div className={`hidden ${ROW_GRID} px-5 py-3 border-b border-neutral-100 text-xs font-medium text-neutral-500`}>
            <span className="flex items-center">
              {canModerate ? (
                <SelectBox checked={allSelected} onClick={toggleAll} label={t('communities.dash.discussions.select_all')} />
              ) : (
                <span className="w-5" />
              )}
            </span>
            <span>{t('communities.dash.discussions.columns.thread')}</span>
            <span>{t('communities.dash.discussions.columns.replies')}</span>
            <span>{t('communities.dash.discussions.columns.activity')}</span>
            <span>{t('communities.dash.discussions.columns.status')}</span>
            <span className="sr-only">{t('communities.dash.discussions.thread_actions')}</span>
          </div>
          <ul className={`divide-y divide-neutral-100 ${ROW_GRID}`}>
            {filtered.map((d) => {
              const isSelected = selected.has(d.discussion_uuid)
              const isOpen = readerUuid === d.discussion_uuid
              return (
                <li
                  key={d.discussion_uuid}
                  onClick={() => setReaderUuid(d.discussion_uuid)}
                  className={`group flex items-center gap-3 px-4 sm:px-5 py-3 cursor-pointer transition-colors ${ROW_GRID} ${
                    isOpen ? 'bg-neutral-50' : isSelected ? 'bg-neutral-50/70' : 'hover:bg-neutral-50/70'
                  }`}
                >
                  <div className="flex items-center" onClick={(e) => e.stopPropagation()}>
                    {canModerate ? (
                      <SelectBox
                        checked={isSelected}
                        onClick={() => toggleSelect(d.discussion_uuid)}
                        label={t('communities.dash.discussions.select_thread')}
                      />
                    ) : (
                      <span className="w-5" />
                    )}
                  </div>

                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <AuthorAvatar author={d.author} size={30} />
                    <div className="min-w-0">
                      <button
                        type="button"
                        className="block max-w-full text-start text-sm font-semibold text-neutral-900 truncate hover:underline underline-offset-2"
                        dir="auto"
                      >
                        {d.emoji && <span className="me-1">{d.emoji}</span>}
                        {d.title}
                      </button>
                      <div className="flex items-center gap-1.5 text-xs text-neutral-500 min-w-0">
                        <span className="truncate">{authorName(d.author, t('common.unknown'))}</span>
                        <span>·</span>
                        <span className="shrink-0">{formatRelative(d.creation_date, i18n.language)}</span>
                        <span className="hidden sm:inline shrink-0">
                          <LabelChip label={d.label} />
                        </span>
                      </div>
                      <div className="lg:hidden mt-1.5 flex flex-wrap items-center gap-1.5">
                        <StatusChips row={d} />
                        {d.replies !== null && (
                          <span className="inline-flex items-center gap-1 text-xs text-neutral-500">
                            <ChatCircleDots size={12} /> {d.replies}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="hidden lg:flex items-center gap-1 text-sm text-neutral-700 tabular-nums">
                    <ChatCircleDots size={14} className="text-neutral-400" />
                    {d.replies ?? '—'}
                  </div>
                  <div className="hidden lg:block text-sm text-neutral-600 truncate" title={d.lastActivity}>
                    {formatRelative(d.lastActivity, i18n.language) ?? '—'}
                  </div>
                  <div className="hidden lg:flex flex-wrap items-center gap-1.5">
                    <StatusChips row={d} placeholder />
                  </div>
                  <div className="flex justify-end shrink-0" onClick={(e) => e.stopPropagation()}>
                    {rowMenu(d)}
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {canModerate && (
        <BulkActionBar
          count={visibleSelected.length}
          label={t('communities.dash.discussions.selected_count', { count: visibleSelected.length })}
          onClear={() => setSelected(new Set())}
        >
          {!allSelected && (
            <BulkActionButton
              icon={<CheckCircle size={14} />}
              label={t('communities.dash.discussions.select_all_count', { count: filtered.length })}
              onClick={toggleAll}
            />
          )}
          <BulkActionButton icon={<PushPin size={14} />} label={t('communities.dash.discussions.pin')} onClick={() => bulkSet('is_pinned', true)} />
          <BulkActionButton icon={<PushPinSlash size={14} />} label={t('communities.dash.discussions.unpin')} onClick={() => bulkSet('is_pinned', false)} />
          <BulkActionButton icon={<LockSimple size={14} />} label={t('communities.dash.discussions.lock')} onClick={() => bulkSet('is_locked', true)} />
          <BulkActionButton icon={<LockSimpleOpen size={14} />} label={t('communities.dash.discussions.unlock')} onClick={() => bulkSet('is_locked', false)} />
          <BulkActionButton
            icon={<Trash size={14} />}
            label={t('communities.dash.discussions.delete')}
            onClick={() => setConfirmDelete(visibleSelected)}
            danger
          />
        </BulkActionBar>
      )}

      <DiscussionReader
        discussion={reader}
        communityUuid={communityUuid}
        publicHref={reader ? publicThreadHref(reader) : null}
        allowRichContent={allowRichContent}
        canModerate={canModerate}
        replyCount={reader?.replies ?? undefined}
        onOpenChange={(open) => {
          if (!open) {
            setReaderUuid(null)
            // Replies may have been added or removed in the panel.
            queryClient.invalidateQueries({ queryKey: dashCommunityKeys.discussionActivity(communityUuid) })
            if (org?.id) queryClient.invalidateQueries({ queryKey: dashCommunityKeys.orgActivity(org.id) })
          }
        }}
        onTogglePin={togglePin}
        onToggleLock={toggleLock}
        onEdit={setEditing}
        onDelete={(d) => setConfirmDelete([d.discussion_uuid])}
      />

      {editing && (
        <EditDiscussionModal
          isOpen={!!editing}
          onClose={() => setEditing(null)}
          discussion={editing}
          allowRichContent={allowRichContent}
          onUpdated={(updated) => {
            patchRows([updated.discussion_uuid], updated)
            setEditing(null)
            refreshRelated()
          }}
        />
      )}

      <ConfirmDialog
        open={!!confirmDelete}
        onOpenChange={(open) => !open && setConfirmDelete(null)}
        title={
          (confirmDelete?.length ?? 0) > 1
            ? t('communities.dash.discussions.delete_many_title', { count: confirmDelete?.length ?? 0 })
            : t('communities.discussion_card.delete_title')
        }
        message={t('communities.discussion_card.delete_confirm')}
        confirmLabel={t('communities.discussion_card.delete_discussion')}
        onConfirm={() => (confirmDelete ? remove(confirmDelete) : undefined)}
      />
    </>
  )
}

function StatusChips({ row, placeholder = false }: { row: Row; placeholder?: boolean }) {
  const { t } = useTranslation()
  return (
    <>
      {row.is_pinned && (
        <Chip tone="amber" icon={<PushPin size={12} weight="fill" />}>{t('communities.dash.discussions.pinned')}</Chip>
      )}
      {row.is_locked && (
        <Chip tone="neutral" icon={<LockSimple size={12} />}>{t('communities.dash.discussions.locked')}</Chip>
      )}
      {!!row.answer_comment_id && (
        <Chip tone="emerald" icon={<CheckCircle size={12} weight="fill" />}>{t('communities.learner.answered')}</Chip>
      )}
      {row.replies === 0 && (
        <Chip tone="sky" icon={<Question size={12} />}>{t('communities.dash.discussions.unanswered')}</Chip>
      )}
      {placeholder && !row.is_pinned && !row.is_locked && !row.answer_comment_id && row.replies !== 0 && <span className="text-sm text-neutral-300">—</span>}
    </>
  )
}

function SelectBox({ checked, onClick, label }: { checked: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className={`w-5 h-5 rounded-md flex items-center justify-center transition-colors shrink-0 ${
        checked ? 'bg-neutral-900 text-white' : 'bg-white ring-1 ring-inset ring-neutral-300 hover:ring-neutral-500'
      }`}
    >
      {checked && <Check size={13} weight="bold" />}
    </button>
  )
}
