'use client'
import React, { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChatCenteredText, PencilSimpleLine, Tray } from '@phosphor-icons/react'
import { DiscussionCard, DiscussionCardSkeleton } from './DiscussionCard'
import {
  DISCUSSION_LABELS,
  DiscussionSortBy,
  DiscussionWithAuthor,
  getDiscussion,
  getDiscussions,
  getDiscussionsActivity,
} from '@services/communities/discussions'
import { threadHref } from './communityUi'

// The editor (tiptap) behind it only loads when someone edits inline.
const EditDiscussionModal = dynamic(
  () => import('@components/Objects/Modals/Communities/EditDiscussionModal').then((m) => m.EditDiscussionModal),
  { ssr: false }
)
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrgMembership } from '@components/Contexts/OrgContext'
import { useCommunityRights } from '@components/Hooks/useCommunityRights'
import { Button, EmptyState, SearchInput, SegmentedControl } from '@components/Dashboard/Shared/DashKit/DashKit'
import { searchMatchesAny } from '@/lib/search/normalize'
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics'

interface DiscussionListProps {
  communityUuid: string
  orgslug: string
  onCreateClick?: () => void
  initialDiscussions?: DiscussionWithAuthor[]
  allowRichContent?: boolean
  /** From the URL (`?sort=`, `?label=`, `?page=`): shareable, crawlable feed views. */
  initialSort?: FeedSort
  initialLabel?: string | null
  initialPage?: number
}

export type FeedSort = 'latest' | 'top' | 'hot' | 'unanswered'
export const FEED_SORTS: FeedSort[] = ['latest', 'top', 'hot', 'unanswered']
const API_SORT: Record<FeedSort, DiscussionSortBy> = { latest: 'recent', top: 'upvotes', hot: 'hot', unanswered: 'recent' }
export const PAGE_SIZE = 20

/** `?sort=&label=&page=` for a feed view; defaults are left out (canonical URLs). */
export function feedQuery(sort: FeedSort, label: string | null, page = 1): string {
  const q = new URLSearchParams()
  if (sort !== 'latest') q.set('sort', sort)
  if (label) q.set('label', label)
  if (page > 1) q.set('page', String(page))
  const s = q.toString()
  return s ? `?${s}` : ''
}

// Feed keys live under ['community', uuid, 'discussions'] so every existing
// "discussions changed" invalidation refreshes them too.
export const discussionActivityKey = (communityUuid: string) => ['community', communityUuid, 'discussions', 'activity']

export function useDiscussionActivity(communityUuid: string) {
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token
  return useQuery({
    queryKey: discussionActivityKey(communityUuid),
    queryFn: () => getDiscussionsActivity(communityUuid, accessToken),
    enabled: !!communityUuid && session?.status !== 'loading',
    staleTime: 30_000,
    retry: false,
  })
}

export function DiscussionList({
  communityUuid,
  orgslug,
  onCreateClick,
  initialDiscussions = [],
  allowRichContent = false,
  initialSort = 'latest',
  initialLabel = null,
  initialPage = 1,
}: DiscussionListProps) {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token
  const queryClient = useQueryClient()
  const { isUserPartOfTheOrg } = useOrgMembership()
  const { canCreateDiscussion: hasCreatePermission, canManageCommunity } = useCommunityRights(communityUuid)
  const canCreateDiscussion = hasCreatePermission && isUserPartOfTheOrg
  const { track } = useLHAnalytics('learner')

  const [sort, setSort] = useState<FeedSort>(initialSort)
  const [label, setLabel] = useState<string | null>(initialLabel)
  // A deep page (?page=3) only applies to the view it was opened with.
  const startPage = sort === initialSort && label === initialLabel ? Math.max(1, initialPage) : 1
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search)

  const feedKey = ['community', communityUuid, 'discussions', 'feed', API_SORT[sort], label ?? null, startPage]
  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: feedKey,
    queryFn: ({ pageParam }) =>
      getDiscussions(communityUuid, API_SORT[sort], pageParam, PAGE_SIZE, null, accessToken, label ?? undefined),
    initialPageParam: startPage,
    getNextPageParam: (last, pages) => (Array.isArray(last) && last.length >= PAGE_SIZE ? startPage + pages.length : undefined),
    enabled: !!communityUuid && session?.status !== 'loading',
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  })

  const { data: activity } = useDiscussionActivity(communityUuid)
  const activityMap = useMemo(() => new Map((activity ?? []).map((a) => [a.discussion_uuid, a])), [activity])

  // Server-rendered first page shows until the client feed arrives.
  const loaded: DiscussionWithAuthor[] = useMemo(() => {
    const seen = new Set<string>()
    const list = data ? data.pages.flat() : sort === initialSort && label === initialLabel ? initialDiscussions : []
    return (Array.isArray(list) ? list : []).filter((d) => {
      if (!d || seen.has(d.discussion_uuid)) return false
      seen.add(d.discussion_uuid)
      return true
    })
  }, [data, sort, label, initialDiscussions, initialSort, initialLabel])

  // Sort and label live in the URL (replaced, not pushed) so a view can be
  // shared and crawled; changing either starts again from the first page.
  const urlSynced = useRef(false)
  useEffect(() => {
    if (!urlSynced.current) {
      urlSynced.current = true
      return
    }
    const url = new URL(window.location.href)
    const thread = url.searchParams.get('thread')
    url.search = feedQuery(sort, label)
    if (thread) url.searchParams.set('thread', thread)
    window.history.replaceState(window.history.state, '', url.toString())
  }, [sort, label])

  const visible = useMemo(() => {
    let list = loaded
    if (sort === 'unanswered') {
      list = list.filter((d) => !d.answer_comment_id && (activityMap.get(d.discussion_uuid)?.comment_count ?? 0) === 0)
    }
    if (deferredSearch.trim()) {
      list = list.filter((d) =>
        searchMatchesAny([d.title, d.author?.username, d.author?.first_name, d.author?.last_name], deferredSearch)
      )
    }
    // Pinned threads always lead, as the API orders them on page one.
    return [...list].sort((a, b) => Number(b.is_pinned) - Number(a.is_pinned))
  }, [loaded, sort, activityMap, deferredSearch])

  const patchFeed = (fn: (_list: DiscussionWithAuthor[]) => DiscussionWithAuthor[]) => {
    queryClient.setQueryData<{ pages: DiscussionWithAuthor[][]; pageParams: unknown[] }>(feedKey, (old) =>
      old ? { ...old, pages: old.pages.map((p) => fn(Array.isArray(p) ? p : [])) } : old
    )
  }
  const handleUpdate = (updated: DiscussionWithAuthor) => {
    patchFeed((list) => list.map((d) => (d.discussion_uuid === updated.discussion_uuid ? { ...d, ...updated } : d)))
    // Pinning moves a thread, so let the other sorts refetch.
    queryClient.invalidateQueries({ queryKey: ['community', communityUuid, 'discussions'], refetchType: 'none' })
  }
  const handleDelete = (uuid: string) => {
    patchFeed((list) => list.filter((d) => d.discussion_uuid !== uuid))
    queryClient.invalidateQueries({ queryKey: discussionActivityKey(communityUuid) })
  }

  const handleCreateClick = (source: 'header' | 'empty_state') => {
    track(AnalyticsEvent.CreateDiscussionModalOpened, { source, feed_is_empty: visible.length === 0 })
    onCreateClick?.()
  }

  // ---- inline reading, one thread open at a time (like a mail client) ----
  const router = useRouter()
  const [openUuid, setOpenUuid] = useState<string | null>(null)
  const [instantClose, setInstantClose] = useState<string | null>(null)
  const [editing, setEditing] = useState<DiscussionWithAuthor | null>(null)
  const cardRefs = useRef(new Map<string, HTMLDivElement>())
  // Where the newly opened card's top sat before the previous one collapsed.
  const anchor = useRef<{ uuid: string; top: number } | null>(null)

  // ?thread=<uuid> reopens a thread on load (phones go to the full page).
  useEffect(() => {
    const param = new URLSearchParams(window.location.search).get('thread')
    if (!param) return
    const uuid = param.startsWith('discussion_') ? param : `discussion_${param}`
    if (window.matchMedia('(max-width: 639px)').matches) {
      router.replace(threadHref(orgslug, communityUuid, uuid))
      return
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpenUuid(uuid)
  }, [router, orgslug, communityUuid])

  // Keep the URL in step without navigating, so refresh and shared links work.
  useEffect(() => {
    const url = new URL(window.location.href)
    const current = url.searchParams.get('thread')
    const next = openUuid ? openUuid.replace('discussion_', '') : null
    if ((current ?? null) === next) return
    if (next) url.searchParams.set('thread', next)
    else url.searchParams.delete('thread')
    window.history.replaceState(window.history.state, '', url.toString())
  }, [openUuid])

  const toggleThread = useCallback(
    (uuid: string) => {
      if (openUuid === uuid) {
        setInstantClose(null)
        setOpenUuid(null)
        return
      }
      // Switching threads: remember where the target sits so the card above
      // collapsing does not yank it up the page.
      const el = cardRefs.current.get(uuid)
      anchor.current = el ? { uuid, top: el.getBoundingClientRect().top } : null
      setInstantClose(openUuid)
      setOpenUuid(uuid)
    },
    [openUuid]
  )

  useLayoutEffect(() => {
    const a = anchor.current
    if (!a || a.uuid !== openUuid) return
    anchor.current = null
    const el = cardRefs.current.get(a.uuid)
    if (!el) return
    const delta = el.getBoundingClientRect().top - a.top
    if (Math.abs(delta) > 1) window.scrollBy(0, delta)
  }, [openUuid])

  // Esc closes the open thread (not while typing), focus returns to its title.
  useEffect(() => {
    if (!openUuid) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      const target = e.target instanceof Element ? e.target : null
      if (target?.closest('input,textarea,select,[contenteditable="true"],[role="dialog"],[role="menu"]')) return
      const el = cardRefs.current.get(openUuid)
      setInstantClose(null)
      setOpenUuid(null)
      el?.querySelector<HTMLElement>('a[href]')?.focus({ preventScroll: true })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openUuid])

  // A thread opened from a link may be older than the loaded pages: fetch it.
  const openMissing = !!openUuid && !loaded.some((d) => d.discussion_uuid === openUuid)
  const { data: linkedThread } = useQuery({
    queryKey: ['discussion', openUuid ?? '', 'inline'],
    queryFn: () => getDiscussion(openUuid!, null, accessToken),
    enabled: openMissing && session?.status !== 'loading',
    retry: false,
  })
  const listed = useMemo(
    () => (openMissing && linkedThread ? [linkedThread, ...visible] : visible),
    [openMissing, linkedThread, visible]
  )

  const showSkeleton = isLoading && loaded.length === 0
  const filtering = !!search || sort === 'unanswered' || !!label

  return (
    <div className="flex flex-col gap-3">
      {/* Toolbar: search, sort, then label chips */}
      <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
        <SearchInput value={search} onChange={setSearch} placeholder={t('communities.discussion_list.search_placeholder')} />
        <div className="overflow-x-auto scrollbar-hide shrink-0">
          <SegmentedControl<FeedSort>
            value={sort}
            onChange={setSort}
            ariaLabel={t('communities.learner.sort.label')}
            options={[
              { key: 'latest', label: t('communities.learner.feed.latest') },
              { key: 'top', label: t('communities.discussion_list.top') },
              { key: 'hot', label: t('communities.discussion_list.hot') },
              { key: 'unanswered', label: t('communities.learner.feed.unanswered') },
            ]}
          />
        </div>
      </div>
      <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide -mx-1 px-1 pb-0.5" role="tablist" aria-label={t('communities.learner.labels_label')}>
        {[{ id: null as string | null, color: '', name: '' }, ...DISCUSSION_LABELS].map((l) => {
          const active = label === l.id
          return (
            <button
              key={l.id ?? 'all'}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setLabel(l.id)}
              className={`shrink-0 inline-flex items-center gap-1.5 h-7 px-3 rounded-full text-xs font-semibold transition-colors ${
                active
                  ? 'bg-neutral-900 text-white'
                  : 'bg-white text-neutral-600 ring-1 ring-inset ring-neutral-900/10 hover:text-neutral-900 hover:ring-neutral-900/20'
              }`}
            >
              {l.id && <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: l.color }} />}
              {l.id ? t(`communities.labels.${l.id}`, { defaultValue: l.name }) : t('communities.learner.all_labels')}
            </button>
          )
        })}
      </div>

      {/* No overflow clipping: the open thread's reply box sticks to the viewport. */}
      <div className="bg-white rounded-2xl nice-shadow">
        {showSkeleton ? (
          <div className="divide-y divide-neutral-100">
            {Array.from({ length: 5 }).map((_, i) => (
              <DiscussionCardSkeleton key={i} />
            ))}
          </div>
        ) : listed.length === 0 ? (
          filtering ? (
            <EmptyState
              icon={<Tray size={22} />}
              title={t('communities.discussion_list.no_results')}
              description={
                sort === 'unanswered' && !search
                  ? t('communities.learner.no_unanswered')
                  : t('communities.discussion_list.no_results_description')
              }
              action={
                <Button
                  size="sm"
                  onClick={() => {
                    setSearch('')
                    setLabel(null)
                    setSort('latest')
                  }}
                >
                  {t('communities.learner.clear_filters')}
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={<ChatCenteredText size={22} />}
              title={t('communities.learner.empty_title')}
              description={t('communities.learner.empty_description')}
              action={
                canCreateDiscussion && onCreateClick ? (
                  <Button variant="primary" icon={<PencilSimpleLine size={14} />} onClick={() => handleCreateClick('empty_state')}>
                    {t('communities.discussion_list.start_discussion')}
                  </Button>
                ) : undefined
              }
            />
          )
        ) : (
          <div className="divide-y divide-neutral-100">
            {listed.map((discussion) => {
              const a = activityMap.get(discussion.discussion_uuid)
              const uuid = discussion.discussion_uuid
              return (
                <div
                  key={uuid}
                  className="first:*:rounded-t-2xl last:*:rounded-b-2xl"
                  ref={(el) => {
                    if (el) cardRefs.current.set(uuid, el)
                    else cardRefs.current.delete(uuid)
                  }}
                >
                <DiscussionCard
                  discussion={discussion}
                  orgslug={orgslug}
                  communityUuid={communityUuid}
                  commentCount={activity ? (a?.comment_count ?? 0) : undefined}
                  lastActivity={a?.last_comment_date}
                  canManage={canManageCommunity}
                  onDiscussionUpdate={handleUpdate}
                  onDiscussionDelete={(id) => {
                    if (id === openUuid) setOpenUuid(null)
                    handleDelete(id)
                  }}
                  expanded={openUuid === uuid}
                  collapseInstantly={instantClose === uuid}
                  onToggle={() => toggleThread(uuid)}
                  onEdit={() => setEditing(discussion)}
                  allowRichContent={allowRichContent}
                />
                </div>
              )
            })}
          </div>
        )}
        {(hasNextPage || (!data && loaded.length >= PAGE_SIZE)) && !showSkeleton && (
          <div className="border-t border-neutral-100 p-3 flex justify-center">
            {/* A real link to the next page, for crawlers and new tabs; a
                plain click loads it in place. */}
            <a
              href={feedQuery(sort, label, startPage + (data?.pages.length ?? 1))}
              rel="next"
              onClick={(e) => {
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
                e.preventDefault()
                fetchNextPage()
              }}
              aria-busy={isFetchingNextPage || undefined}
              className="inline-flex items-center justify-center h-9 px-4 rounded-lg text-sm font-semibold bg-white text-neutral-800 ring-1 ring-inset ring-neutral-900/10 hover:ring-neutral-900/20 transition-colors"
            >
              {t('communities.learner.load_more')}
            </a>
          </div>
        )}
        {startPage > 1 && (
          <div className="border-t border-neutral-100 p-3 flex justify-center">
            <a href={feedQuery(sort, label, startPage - 1)} rel="prev" className="text-sm font-semibold text-neutral-600 hover:text-neutral-900">
              {t('communities.learner.newer_discussions', { defaultValue: 'Newer discussions' })}
            </a>
          </div>
        )}
      </div>

      {editing && (
        <EditDiscussionModal
          isOpen={!!editing}
          onClose={() => setEditing(null)}
          discussion={editing}
          allowRichContent={allowRichContent}
          onUpdated={(updated) => {
            handleUpdate(updated)
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}

export default DiscussionList
