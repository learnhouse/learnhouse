'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  BookCopy,
  SquareLibrary,
  Users as UsersIcon,
  Search as SearchIcon,
  MessagesSquare,
  MessageCircle,
  Mic,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import { Cube } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'

import { searchOrgContent } from '@services/search/search'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import {
  getCourseThumbnailMediaDirectory,
  getUserAvatarMediaDirectory,
  getCommunityThumbnailMediaDirectory,
  getPlaygroundThumbnailMediaDirectory,
  getPodcastThumbnailMediaDirectory,
} from '@services/media/media'
import { getUriWithOrg } from '@services/config/config'
import { removeCoursePrefix } from '@components/Objects/Thumbnails/CourseThumbnail'
import UserAvatar from '@components/Objects/UserAvatar'

/**
 * Discussions store their body as a tiptap/ProseMirror JSON document
 * ({"type":"doc","content":[…]}). Old posts may also be plain strings.
 * Return a flat preview string either way.
 */
function extractPreviewText(raw: string | undefined | null): string {
  if (!raw) return ''
  const trimmed = raw.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return trimmed

  try {
    const parsed = JSON.parse(trimmed)
    const parts: string[] = []
    const walk = (node: any): void => {
      if (!node) return
      if (typeof node === 'string') {
        parts.push(node)
        return
      }
      if (Array.isArray(node)) {
        node.forEach(walk)
        return
      }
      if (typeof node.text === 'string') parts.push(node.text)
      if (node.content) walk(node.content)
    }
    walk(parsed)
    return parts.join(' ').replace(/\s+/g, ' ').trim()
  } catch {
    return trimmed
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Types mirror the backend SearchResult shape — kept flexible on purpose so
// the backend stays the source of truth.
// ─────────────────────────────────────────────────────────────────────────────

interface ApiUser {
  username: string
  first_name: string
  last_name: string
  avatar_image?: string
  bio?: string
  details?: Record<string, any>
  id: number
  user_uuid: string
}

interface ApiAuthor { user: ApiUser }

interface ApiCourse {
  name: string
  description?: string
  thumbnail_image?: string
  course_uuid: string
  authors?: ApiAuthor[]
}

interface ApiCollection {
  name: string
  description?: string
  collection_uuid: string
}

interface ApiCommunity {
  name: string
  description?: string
  thumbnail_image?: string
  community_uuid: string
  public?: boolean
}

interface ApiDiscussion {
  title: string
  content?: string
  discussion_uuid: string
  community_id: number
  community_uuid?: string
  label?: string
  emoji?: string
}

interface ApiPlayground {
  name: string
  description?: string
  thumbnail_image?: string
  playground_uuid: string
  org_uuid?: string
}

interface ApiPodcast {
  name: string
  description?: string
  thumbnail_image?: string
  podcast_uuid: string
}

interface SearchResults {
  courses: ApiCourse[]
  collections: ApiCollection[]
  users: ApiUser[]
  communities: ApiCommunity[]
  discussions: ApiDiscussion[]
  playgrounds: ApiPlayground[]
  podcasts: ApiPodcast[]
  total_courses: number
  total_collections: number
  total_users: number
  total_communities: number
  total_discussions: number
  total_playgrounds: number
  total_podcasts: number
}

const EMPTY_RESULTS: SearchResults = {
  courses: [],
  collections: [],
  users: [],
  communities: [],
  discussions: [],
  playgrounds: [],
  podcasts: [],
  total_courses: 0,
  total_collections: 0,
  total_users: 0,
  total_communities: 0,
  total_discussions: 0,
  total_playgrounds: 0,
  total_podcasts: 0,
}

type ResourceKey =
  | 'courses'
  | 'collections'
  | 'users'
  | 'communities'
  | 'discussions'
  | 'playgrounds'
  | 'podcasts'

type TabKey = 'all' | ResourceKey

// ─────────────────────────────────────────────────────────────────────────────
// Section registry — each resource type provides its own card renderer and
// metadata. Adding a new type means one entry here, not scattered JSX.
// ─────────────────────────────────────────────────────────────────────────────

interface SectionDescriptor<T> {
  key: ResourceKey
  icon: React.ComponentType<any>
  items: (results: SearchResults) => T[]
  total: (results: SearchResults) => number
  renderCard: (item: T, ctx: RenderContext) => React.ReactNode
  itemKey: (item: T) => string
}

interface RenderContext {
  orgSlug: string
  orgUuid: string
}

const sections: SectionDescriptor<any>[] = [
  {
    key: 'courses',
    icon: BookCopy,
    items: (r) => r.courses,
    total: (r) => r.total_courses,
    itemKey: (c: ApiCourse) => c.course_uuid,
    renderCard: (course: ApiCourse, ctx) => (
      <ResourceCard
        href={getUriWithOrg(ctx.orgSlug, `/course/${removeCoursePrefix(course.course_uuid)}`)}
        imageUrl={course.thumbnail_image
          ? getCourseThumbnailMediaDirectory(ctx.orgUuid, course.course_uuid, course.thumbnail_image)
          : undefined}
        fallbackIcon={BookCopy}
        title={course.name}
        subtitle={course.description}
        footer={
          course.authors && course.authors.length > 0 ? (
            <div className="flex items-center gap-2 pt-2">
              <UserAvatar
                width={20}
                avatar_url={course.authors[0].user.avatar_image
                  ? getUserAvatarMediaDirectory(course.authors[0].user.user_uuid, course.authors[0].user.avatar_image)
                  : ''}
                predefined_avatar={course.authors[0].user.avatar_image ? undefined : 'empty'}
                userId={course.authors[0].user.id.toString()}
                showProfilePopup={false}
                rounded="rounded-full"
                backgroundColor="bg-gray-100"
              />
              <span className="text-xs text-black/50">
                {course.authors[0].user.first_name} {course.authors[0].user.last_name}
              </span>
            </div>
          ) : null
        }
      />
    ),
  },
  {
    key: 'collections',
    icon: SquareLibrary,
    items: (r) => r.collections,
    total: (r) => r.total_collections,
    itemKey: (c: ApiCollection) => c.collection_uuid,
    renderCard: (collection: ApiCollection, ctx) => (
      <InlineCard
        href={getUriWithOrg(
          ctx.orgSlug,
          `/collection/${collection.collection_uuid.replace('collection_', '')}`,
        )}
        icon={SquareLibrary}
        title={collection.name}
        subtitle={collection.description}
      />
    ),
  },
  {
    key: 'communities',
    icon: MessagesSquare,
    items: (r) => r.communities,
    total: (r) => r.total_communities,
    itemKey: (c: ApiCommunity) => c.community_uuid,
    renderCard: (community: ApiCommunity, ctx) => (
      <ResourceCard
        href={getUriWithOrg(ctx.orgSlug, `/community/${community.community_uuid.replace('community_', '')}`)}
        imageUrl={community.thumbnail_image
          ? getCommunityThumbnailMediaDirectory(ctx.orgUuid, community.community_uuid, community.thumbnail_image)
          : undefined}
        fallbackIcon={MessagesSquare}
        title={community.name}
        subtitle={community.description}
      />
    ),
  },
  {
    key: 'discussions',
    icon: MessageCircle,
    items: (r) => r.discussions,
    total: (r) => r.total_discussions,
    itemKey: (d: ApiDiscussion) => d.discussion_uuid,
    renderCard: (discussion: ApiDiscussion, ctx) => {
      const communityUuid = (discussion.community_uuid ?? '').replace('community_', '')
      const discussionUuid = discussion.discussion_uuid.replace('discussion_', '')
      const href = communityUuid
        ? getUriWithOrg(
            ctx.orgSlug,
            `/community/${communityUuid}/discussion/${discussionUuid}`,
          )
        : getUriWithOrg(ctx.orgSlug, `/discussion/${discussionUuid}`)
      return (
        <InlineCard
          href={href}
          icon={MessageCircle}
          emoji={discussion.emoji}
          title={discussion.title}
          subtitle={extractPreviewText(discussion.content)}
        />
      )
    },
  },
  {
    key: 'playgrounds',
    icon: Cube,
    items: (r) => r.playgrounds,
    total: (r) => r.total_playgrounds,
    itemKey: (p: ApiPlayground) => p.playground_uuid,
    renderCard: (playground: ApiPlayground, ctx) => (
      <ResourceCard
        href={getUriWithOrg(ctx.orgSlug, `/playground/${playground.playground_uuid}`)}
        imageUrl={playground.thumbnail_image && playground.org_uuid
          ? getPlaygroundThumbnailMediaDirectory(
              playground.org_uuid,
              playground.playground_uuid,
              playground.thumbnail_image,
            )
          : undefined}
        fallbackIcon={Cube}
        title={playground.name}
        subtitle={playground.description}
      />
    ),
  },
  {
    key: 'podcasts',
    icon: Mic,
    items: (r) => r.podcasts,
    total: (r) => r.total_podcasts,
    itemKey: (p: ApiPodcast) => p.podcast_uuid,
    renderCard: (podcast: ApiPodcast, ctx) => (
      <ResourceCard
        href={getUriWithOrg(ctx.orgSlug, `/podcast/${podcast.podcast_uuid.replace('podcast_', '')}`)}
        imageUrl={podcast.thumbnail_image
          ? getPodcastThumbnailMediaDirectory(ctx.orgUuid, podcast.podcast_uuid, podcast.thumbnail_image)
          : undefined}
        fallbackIcon={Mic}
        title={podcast.name}
        subtitle={podcast.description}
      />
    ),
  },
  {
    key: 'users',
    icon: UsersIcon,
    items: (r) => r.users,
    total: (r) => r.total_users,
    itemKey: (u: ApiUser) => u.user_uuid,
    renderCard: (user: ApiUser, ctx) => (
      <Link
        href={getUriWithOrg(ctx.orgSlug, `/user/${user.username}`)}
        className="flex items-center gap-4 p-3 bg-white rounded-lg border border-black/5 hover:border-black/15 transition-colors"
      >
        <UserAvatar
          width={40}
          avatar_url={user.avatar_image ? getUserAvatarMediaDirectory(user.user_uuid, user.avatar_image) : ''}
          predefined_avatar={user.avatar_image ? undefined : 'empty'}
          userId={user.id.toString()}
          showProfilePopup
          rounded="rounded-full"
          backgroundColor="bg-gray-100"
        />
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-black/80 truncate">
            {user.first_name} {user.last_name}
          </h3>
          <p className="text-xs text-black/50 truncate">@{user.username}</p>
        </div>
      </Link>
    ),
  },
]

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

const PER_PAGE = 9

function SearchPage() {
  const { t } = useTranslation()
  const router = useRouter()
  const searchParams = useSearchParams()
  const session = useLHSession() as any
  const org = useOrg() as any

  const urlQuery = searchParams.get('q') ?? ''
  const urlPage = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10) || 1)
  const urlType = (searchParams.get('type') as TabKey) || 'all'

  const [inputValue, setInputValue] = useState(urlQuery)
  const [results, setResults] = useState<SearchResults>(EMPTY_RESULTS)
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => setInputValue(urlQuery), [urlQuery])

  const updateParams = useCallback(
    (updates: Record<string, string | number | null>) => {
      const next = new URLSearchParams(Array.from(searchParams.entries()))
      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === '' || value === undefined) {
          next.delete(key)
        } else {
          next.set(key, String(value))
        }
      }
      router.push(`?${next.toString()}`)
    },
    [router, searchParams],
  )

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = inputValue.trim()
    if (!trimmed) return
    updateParams({ q: trimmed, page: 1 })
  }

  useEffect(() => {
    if (!urlQuery.trim() || !org?.slug) {
      setResults(EMPTY_RESULTS)
      return
    }

    let cancelled = false
    setIsLoading(true)
    searchOrgContent(
      org.slug,
      urlQuery,
      urlPage,
      PER_PAGE,
      null,
      session?.data?.tokens?.access_token,
    )
      .then((response) => {
        if (cancelled) return
        const data = response?.data ?? {}
        setResults({
          ...EMPTY_RESULTS,
          ...data,
        })
      })
      .catch((err) => {
        console.error('Search failed:', err)
        if (!cancelled) setResults(EMPTY_RESULTS)
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [urlQuery, urlPage, org?.slug, session?.data?.tokens?.access_token])

  const totalResults = useMemo(
    () => sections.reduce((sum, s) => sum + s.total(results), 0),
    [results],
  )

  const activeSections = useMemo(() => {
    const shown = urlType === 'all'
      ? sections
      : sections.filter((s) => s.key === urlType)
    return shown.filter((s) => s.items(results).length > 0)
  }, [urlType, results])

  const activeTotal = urlType === 'all'
    ? totalResults
    : sections.find((s) => s.key === urlType)?.total(results) ?? 0

  const totalPages = Math.max(1, Math.ceil(activeTotal / PER_PAGE))
  const renderContext: RenderContext = {
    orgSlug: org?.slug ?? '',
    orgUuid: org?.org_uuid ?? '',
  }

  return (
    <div className="min-h-screen">
      <div className="container mx-auto px-4 pt-10 pb-4 max-w-5xl">
        <h1 className="text-2xl font-semibold text-black/80 mb-1">
          {t('common.search')}
        </h1>
        <p className="text-sm text-black/50 mb-6">{t('search.start_subtitle')}</p>

        <form onSubmit={handleSubmit} className="relative group">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            aria-label={t('search.search_placeholder')}
            placeholder={t('search.search_placeholder')}
            className="w-full h-12 pl-12 pr-24 rounded-xl bg-white nice-shadow
                       focus:outline-none focus:ring-2 focus:ring-black focus:ring-offset-1
                       text-sm placeholder:text-black/40 transition-all"
          />
          <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
            <SearchIcon
              className="text-black/40 group-focus-within:text-black/70 transition-colors"
              size={18}
            />
          </div>
          <button
            type="submit"
            className="absolute inset-y-2 right-2 px-4 rounded-lg bg-black text-white text-xs font-semibold hover:bg-black/85 transition-colors"
          >
            {t('common.search')}
          </button>
        </form>

        {urlQuery && (
          <div className="mt-4 flex items-center gap-2 overflow-x-auto pb-2 -mx-1 px-1">
            <TabButton
              label={t('search.types.all')}
              icon={SearchIcon}
              count={totalResults}
              active={urlType === 'all'}
              onClick={() => updateParams({ type: '', page: 1 })}
            />
            {sections.map((s) => (
              <TabButton
                key={s.key}
                label={t(`search.types.${s.key}`)}
                icon={s.icon}
                count={s.total(results)}
                active={urlType === s.key}
                onClick={() => updateParams({ type: s.key, page: 1 })}
              />
            ))}
          </div>
        )}
      </div>

      <div className="container mx-auto px-4 pb-12 max-w-5xl">
        {!urlQuery.trim() ? (
          <StartState label={t('search.start_heading')} />
        ) : isLoading ? (
          <LoadingGrid />
        ) : totalResults === 0 ? (
          <EmptyState query={urlQuery} t={t} />
        ) : (
          <>
            <p className="text-xs text-black/50 mb-5">
              {t('search.found_results', { count: activeTotal, query: urlQuery })}
            </p>

            <div className="space-y-8">
              {activeSections.length === 0 && (
                <EmptyState query={urlQuery} t={t} />
              )}

              {activeSections.map((section) => {
                const items = section.items(results)
                return (
                  <section key={section.key}>
                    <h2 className="text-[11px] font-semibold uppercase tracking-wider text-black/50 mb-3 flex items-center gap-2">
                      <section.icon size={13} />
                      {t(`search.types.${section.key}`)}
                      <span className="text-black/30 font-normal normal-case tracking-normal">
                        ({section.total(results)})
                      </span>
                    </h2>
                    <div className={gridClass(section.key)}>
                      {items.map((item) => (
                        <React.Fragment key={section.itemKey(item)}>
                          {section.renderCard(item, renderContext)}
                        </React.Fragment>
                      ))}
                    </div>
                  </section>
                )
              })}
            </div>

            {totalPages > 1 && (
              <Pagination
                page={urlPage}
                totalPages={totalPages}
                onChange={(p) => updateParams({ page: p })}
                t={t}
              />
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ─── subcomponents ──────────────────────────────────────────────────────────

function TabButton({
  label,
  icon: Icon,
  count,
  active,
  onClick,
}: {
  label: string
  icon: React.ComponentType<any>
  count: number
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
        active
          ? 'bg-black text-white'
          : 'bg-black/5 text-black/70 hover:bg-black/10'
      }`}
    >
      <Icon size={14} />
      {label}
      <span className={active ? 'text-white/70' : 'text-black/40'}>{count}</span>
    </button>
  )
}

function ResourceCard({
  href,
  imageUrl,
  fallbackIcon: FallbackIcon,
  title,
  subtitle,
  footer,
}: {
  href: string
  imageUrl?: string
  fallbackIcon: React.ComponentType<any>
  title: string
  subtitle?: string
  footer?: React.ReactNode
}) {
  return (
    <Link
      href={href}
      className="bg-white rounded-lg border border-black/5 hover:border-black/15 transition-colors overflow-hidden group flex flex-col"
    >
      <div className="relative aspect-video bg-black/5 flex items-center justify-center">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={title}
            className="w-full h-full object-cover"
          />
        ) : (
          <FallbackIcon size={28} className="text-black/30" />
        )}
      </div>
      <div className="p-3 flex-1 flex flex-col">
        <h3 className="text-sm font-medium text-black/80 line-clamp-1">{title}</h3>
        {subtitle && (
          <p className="text-xs text-black/50 line-clamp-2 mt-1">{subtitle}</p>
        )}
        {footer}
      </div>
    </Link>
  )
}

function InlineCard({
  href,
  icon: Icon,
  emoji,
  title,
  subtitle,
}: {
  href: string
  icon: React.ComponentType<any>
  emoji?: string
  title: string
  subtitle?: string
}) {
  return (
    <Link
      href={href}
      className="flex items-start gap-3 p-3 bg-white rounded-lg border border-black/5 hover:border-black/15 transition-colors"
    >
      <div className="w-9 h-9 bg-black/5 rounded-md flex items-center justify-center flex-shrink-0 text-base">
        {emoji ? <span>{emoji}</span> : <Icon size={18} className="text-black/50" />}
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-medium text-black/80 line-clamp-1">{title}</h3>
        {subtitle && (
          <p className="text-xs text-black/50 line-clamp-2 mt-0.5">{subtitle}</p>
        )}
      </div>
    </Link>
  )
}

function LoadingGrid() {
  return (
    <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="bg-white rounded-lg border border-black/5 p-3 animate-pulse"
        >
          <div className="w-full aspect-video bg-black/5 rounded mb-3" />
          <div className="w-3/4 h-3 bg-black/5 rounded mb-1.5" />
          <div className="w-1/2 h-3 bg-black/5 rounded" />
        </div>
      ))}
    </div>
  )
}

function EmptyState({ query, t }: { query: string; t: (k: string, o?: any) => string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="mb-4 p-4 bg-black/5 rounded-full">
        <SearchIcon className="w-8 h-8 text-black/40" />
      </div>
      <h3 className="text-lg font-medium text-black/80 mb-2">
        {t('search.no_results_found')}
      </h3>
      <p className="text-sm text-black/50 max-w-md">
        {t('search.no_results_description', { query })}
      </p>
    </div>
  )
}

function StartState({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="mb-4 p-4 bg-black/5 rounded-full">
        <SearchIcon className="w-8 h-8 text-black/40" />
      </div>
      <h3 className="text-lg font-medium text-black/70">{label}</h3>
    </div>
  )
}

function Pagination({
  page,
  totalPages,
  onChange,
  t,
}: {
  page: number
  totalPages: number
  onChange: (p: number) => void
  t: (k: string) => string
}) {
  const windowSize = 5
  const half = Math.floor(windowSize / 2)
  const start = Math.max(1, Math.min(page - half, totalPages - windowSize + 1))
  const end = Math.min(totalPages, start + windowSize - 1)
  const pages = Array.from({ length: end - start + 1 }, (_, i) => start + i)

  const baseBtn =
    'flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors'
  return (
    <nav className="flex justify-center items-center gap-1.5 mt-8">
      <button
        onClick={() => onChange(page - 1)}
        disabled={page <= 1}
        className={`${baseBtn} text-black/60 hover:bg-black/5 disabled:opacity-40 disabled:cursor-not-allowed`}
        aria-label={t('search.previous')}
      >
        <ChevronLeft size={14} />
        <span className="hidden sm:inline">{t('search.previous')}</span>
      </button>
      <div className="flex items-center gap-1">
        {pages.map((p) => (
          <button
            key={p}
            onClick={() => onChange(p)}
            className={`w-8 h-8 rounded-md text-xs font-medium transition-colors ${
              p === page
                ? 'bg-black text-white'
                : 'text-black/60 hover:bg-black/5'
            }`}
            aria-current={p === page ? 'page' : undefined}
          >
            {p}
          </button>
        ))}
      </div>
      <button
        onClick={() => onChange(page + 1)}
        disabled={page >= totalPages}
        className={`${baseBtn} text-black/60 hover:bg-black/5 disabled:opacity-40 disabled:cursor-not-allowed`}
        aria-label={t('search.next')}
      >
        <span className="hidden sm:inline">{t('search.next')}</span>
        <ChevronRight size={14} />
      </button>
    </nav>
  )
}

function gridClass(key: ResourceKey): string {
  // Dense list for inline types (collections/discussions), card grid for rich types.
  if (key === 'collections' || key === 'discussions' || key === 'users') {
    return 'grid gap-3 md:grid-cols-2 lg:grid-cols-3'
  }
  return 'grid gap-4 md:grid-cols-2 lg:grid-cols-3'
}

export default SearchPage
