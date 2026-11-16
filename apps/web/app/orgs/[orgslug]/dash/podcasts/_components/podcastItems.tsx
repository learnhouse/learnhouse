'use client'
import React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import {
  ArrowSquareOut,
  CheckCircle,
  DotsThree,
  Eye,
  EyeSlash,
  Globe,
  Headphones,
  LinkSimple,
  ListNumbers,
  Lock,
  PencilSimpleLine,
  Rss,
  SlidersHorizontal,
  Trash,
} from '@phosphor-icons/react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@components/ui/dropdown-menu'
import AuthenticatedClientElement from '@components/Security/AuthenticatedClientElement'
import { AvatarStack, Chip, ConfirmDialog, buttonClass, formatRelative } from '@components/Dashboard/Shared/DashKit/DashKit'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getUriWithOrg } from '@services/config/config'
import { getPodcastThumbnailMediaDirectory, getUserAvatarMediaDirectory } from '@services/media/media'
import {
  PodcastWithEpisodeCount,
  deletePodcast,
  removePodcastPrefix,
  updatePodcast,
} from '@services/podcasts/podcasts'
import { revalidateTags } from '@services/utils/ts/requests'
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics'
import { queryKeys } from '@/lib/query/keys'

// Dashboard-only podcast cards and rows. The public catalog keeps its own
// PodcastThumbnail; these follow the course list (cards, subgrid rows, one
// action menu).

export type DashPodcast = PodcastWithEpisodeCount

export const dashPodcastsKey = queryKeys.podcasts.dashList

export const podcastEditorHref = (orgslug: string, podcast: Pick<DashPodcast, 'podcast_uuid'>, tab = 'general') =>
  getUriWithOrg(orgslug, `/dash/podcasts/podcast/${removePodcastPrefix(podcast.podcast_uuid)}/${tab}`)

export const podcastPublicHref = (orgslug: string, podcast: Pick<DashPodcast, 'podcast_uuid'>) =>
  getUriWithOrg(orgslug, `/podcast/${removePodcastPrefix(podcast.podcast_uuid)}`)

// Desktop table: the card is the grid and every row spans it with subgrid,
// so columns line up, as in the course list.
export const PODCAST_TABLE_GRID =
  'lg:grid lg:grid-cols-[minmax(0,2.8fr)_minmax(0,0.9fr)_minmax(0,0.9fr)_minmax(0,0.7fr)_minmax(0,0.8fr)_minmax(0,1fr)_auto] lg:gap-x-4'
export const PODCAST_ROW_GRID = 'lg:col-span-full lg:grid lg:grid-cols-subgrid lg:items-center lg:gap-x-4'

function coverSrc(orgUuid: string | undefined, podcast: DashPodcast) {
  return podcast.thumbnail_image && orgUuid
    ? getPodcastThumbnailMediaDirectory(orgUuid, podcast.podcast_uuid, podcast.thumbnail_image)
    : null
}

function authorsOf(podcast: DashPodcast) {
  return (Array.isArray(podcast.authors) ? podcast.authors : [])
    .filter((a) => a.authorship_status === 'ACTIVE' && a.user)
    .map((a) => ({
      key: a.user.user_uuid,
      src: a.user.avatar_image ? getUserAvatarMediaDirectory(a.user.user_uuid, a.user.avatar_image) : '',
      label: [a.user.first_name, a.user.last_name].filter(Boolean).join(' ') || a.user.username,
    }))
}

// Writes through to the cached dashboard list so a toggle shows at once.
export function usePatchPodcastInCache(orgslug: string) {
  const queryClient = useQueryClient()
  return React.useCallback(
    (uuid: string, patch: Partial<DashPodcast>) => {
      const key = dashPodcastsKey(orgslug)
      const previous = queryClient.getQueryData<DashPodcast[]>(key)
      queryClient.setQueryData<DashPodcast[]>(key, (old) =>
        old?.map((p) => (p.podcast_uuid === uuid ? { ...p, ...patch } : p))
      )
      return () => queryClient.setQueryData(key, previous)
    },
    [queryClient, orgslug]
  )
}

export function PodcastStatusChip({ published }: { published?: boolean }) {
  const { t } = useTranslation()
  return published ? (
    <Chip tone="emerald" icon={<CheckCircle size={12} />}>{t('podcasts.published')}</Chip>
  ) : (
    <Chip tone="neutral" icon={<EyeSlash size={12} />}>{t('podcasts.dashboard.list.draft')}</Chip>
  )
}

export function PodcastVisibilityChip({ isPublic }: { isPublic?: boolean }) {
  const { t } = useTranslation()
  return isPublic ? (
    <Chip tone="sky" icon={<Globe size={12} />}>{t('podcasts.public')}</Chip>
  ) : (
    <Chip tone="violet" icon={<Lock size={12} />}>{t('podcasts.private')}</Chip>
  )
}

// Square podcast art. Falls back to a headphones tile when there is no cover.
export function PodcastCover({
  src,
  className = '',
  iconSize = 18,
}: {
  src: string | null
  className?: string
  iconSize?: number
}) {
  // A missing or broken file falls back to the tile instead of a broken image.
  const [failedSrc, setFailedSrc] = React.useState<string | null>(null)
  return src && failedSrc !== src ? (
    <img src={src} alt="" loading="lazy" onError={() => setFailedSrc(src)} className={`object-cover bg-neutral-100 ${className}`} />
  ) : (
    <span className={`flex items-center justify-center bg-gradient-to-br from-neutral-100 to-neutral-200 text-neutral-400 ${className}`}>
      <Headphones size={iconSize} />
    </span>
  )
}

const ITEM = 'flex items-center gap-2 cursor-pointer'

export function PodcastActionsMenu({
  podcast,
  orgslug,
  onChanged,
}: {
  podcast: DashPodcast
  orgslug: string
  onChanged: () => void
}) {
  const { t } = useTranslation()
  const router = useRouter()
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token
  const queryClient = useQueryClient()
  const patch = usePatchPodcastInCache(orgslug)
  const [confirmDelete, setConfirmDelete] = React.useState(false)

  const update = async (body: Partial<DashPodcast>, success: string) => {
    const rollback = patch(podcast.podcast_uuid, body)
    try {
      await updatePodcast(podcast.podcast_uuid, body, accessToken)
      toast.success(success)
      queryClient.invalidateQueries({ queryKey: queryKeys.podcasts.meta(podcast.podcast_uuid) })
      revalidateTags(['podcasts'], orgslug)
      onChanged()
    } catch {
      rollback()
      toast.error(t('podcasts.dashboard.save_error'))
    }
  }

  const remove = async () => {
    const toastId = toast.loading(t('podcasts.deleting_podcast'))
    try {
      await deletePodcast(podcast.podcast_uuid, accessToken)
      toast.success(t('podcasts.podcast_deleted_success'), { id: toastId })
      await revalidateTags(['podcasts'], orgslug)
      onChanged()
      router.refresh()
    } catch {
      toast.error(t('podcasts.podcast_deleted_error'), { id: toastId })
    }
  }

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(new URL(podcastPublicHref(orgslug, podcast), window.location.origin).toString())
      toast.success(t('podcasts.distribution.copied'))
    } catch {
      toast.error(t('podcasts.dashboard.list.copy_failed'))
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={t('podcasts.actions')}
            className="h-7 w-7 inline-flex items-center justify-center rounded-md text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100 data-[state=open]:bg-neutral-100 data-[state=open]:text-neutral-900 transition-colors"
          >
            <DotsThree size={16} weight="bold" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56 rounded-xl p-1.5">
          <DropdownMenuItem asChild>
            <Link prefetch={false} href={podcastEditorHref(orgslug, podcast, 'content')} className={ITEM}>
              <ListNumbers size={15} /> {t('podcasts.dashboard.list.edit_episodes')}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link prefetch={false} href={podcastEditorHref(orgslug, podcast, 'general')} className={ITEM}>
              <SlidersHorizontal size={15} /> {t('common.settings')}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link prefetch={false} href={podcastEditorHref(orgslug, podcast, 'distribution')} className={ITEM}>
              <Rss size={15} /> {t('podcasts.dashboard.tabs.distribution')}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <a href={podcastPublicHref(orgslug, podcast)} target="_blank" rel="noreferrer" className={ITEM}>
              <ArrowSquareOut size={15} /> {t('podcasts.dashboard.view_podcast')}
            </a>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={copyLink} className={ITEM}>
            <LinkSimple size={15} /> {t('podcasts.dashboard.list.copy_link')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() =>
              update(
                { published: !podcast.published },
                podcast.published ? t('podcasts.dashboard.list.unpublished_toast') : t('podcasts.dashboard.list.published_toast')
              )
            }
            className={ITEM}
          >
            {podcast.published ? <EyeSlash size={15} /> : <Eye size={15} />}
            {podcast.published ? t('podcasts.dashboard.episodes.unpublish') : t('podcasts.dashboard.episodes.publish')}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => update({ public: !podcast.public }, t('podcasts.dashboard.saved'))}
            className={ITEM}
          >
            {podcast.public ? <Lock size={15} /> : <Globe size={15} />}
            {podcast.public ? t('podcasts.dashboard.list.make_private') : t('podcasts.dashboard.list.make_public')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => setConfirmDelete(true)}
            className={`${ITEM} text-rose-600 focus:text-rose-700 focus:bg-rose-50`}
          >
            <Trash size={15} /> {t('podcasts.delete_podcast')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t('podcasts.delete_podcast_title', { name: podcast.name })}
        message={t('podcasts.delete_podcast_confirm')}
        confirmLabel={t('podcasts.delete_podcast')}
        onConfirm={remove}
      />
    </>
  )
}

type ItemProps = {
  podcast: DashPodcast
  orgslug: string
  orgUuid?: string
  onChanged: () => void
}

function useTrackOpen(podcast: DashPodcast) {
  const { track } = useLHAnalytics('dashboard')
  return () => track(AnalyticsEvent.PodcastCardOpened, { episode_count: podcast.episode_count, source: 'dashboard' })
}

export function PodcastCard({ podcast, orgslug, orgUuid, onChanged }: ItemProps) {
  const { t, i18n } = useTranslation()
  const href = podcastEditorHref(orgslug, podcast)
  const cover = coverSrc(orgUuid, podcast)
  const updated = formatRelative(podcast.update_date, i18n.language)
  const authors = authorsOf(podcast)
  const trackOpen = useTrackOpen(podcast)
  const episodes = podcast.episode_count ?? 0

  return (
    <div
      data-kbd-item=""
      className="group relative flex flex-col bg-white rounded-2xl nice-shadow overflow-hidden transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg"
    >
      {/* Square art on a blurred copy of itself, so any cover fills the
          16:9 slot the other dashboard cards use. */}
      <Link
        prefetch={false}
        href={href}
        onClick={trackOpen}
        className="relative block aspect-video overflow-hidden bg-neutral-100"
      >
        {cover && (
          <img
            src={cover}
            alt=""
            aria-hidden
            onError={(e) => (e.currentTarget.style.display = 'none')}
            className="absolute inset-0 w-full h-full object-cover blur-2xl scale-125 opacity-60"
          />
        )}
        <div className="absolute inset-0 flex items-center justify-center p-4">
          <PodcastCover
            src={cover}
            iconSize={28}
            className="h-full aspect-square rounded-xl shadow-md ring-1 ring-black/5 transition-transform duration-500 group-hover:scale-[1.03]"
          />
        </div>
        <div className="absolute bottom-2.5 start-2.5 flex items-center gap-1.5">
          <PodcastStatusChip published={podcast.published} />
          {!podcast.public && (
            <span
              title={t('podcasts.private')}
              className="w-6 h-6 rounded-full bg-white/90 backdrop-blur text-violet-600 flex items-center justify-center"
            >
              <Lock size={12} />
            </span>
          )}
        </div>
        <span className="absolute bottom-2.5 end-2.5 inline-flex items-center gap-1 rounded-full bg-neutral-900/75 backdrop-blur px-2 py-0.5 text-[11px] font-semibold text-white tabular-nums">
          <Headphones size={11} />
          {t('podcasts.dashboard.list.episodes_count', { count: episodes })}
        </span>
      </Link>

      <AuthenticatedClientElement action="update" ressourceType="podcasts" checkMethod="roles" orgId={podcast.org_id}>
        <div className="absolute top-2 end-2 z-10 opacity-0 group-hover:opacity-100 focus-within:opacity-100 has-[[data-state=open]]:opacity-100 transition-opacity">
          <div className="rounded-lg bg-white/95 backdrop-blur shadow-sm">
            <PodcastActionsMenu podcast={podcast} orgslug={orgslug} onChanged={onChanged} />
          </div>
        </div>
      </AuthenticatedClientElement>

      <div className="flex flex-col flex-1 p-4 gap-1">
        <Link
          prefetch={false}
          href={href}
          onClick={trackOpen}
          dir="auto"
          className="text-[15px] font-semibold text-neutral-900 leading-snug line-clamp-1 hover:underline underline-offset-2"
        >
          {podcast.name}
        </Link>
        <p className="text-xs text-neutral-500 line-clamp-2 min-h-[2rem]" dir="auto">
          {podcast.description || t('podcasts.dashboard.list.no_description')}
        </p>
        <div className="mt-auto pt-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <AvatarStack people={authors} size={22} />
            {updated && <span className="text-xs text-neutral-400 truncate">{updated}</span>}
          </div>
          <Link
            prefetch={false}
            href={podcastEditorHref(orgslug, podcast, 'content')}
            title={t('podcasts.dashboard.list.edit_episodes')}
            aria-label={t('podcasts.dashboard.list.edit_episodes')}
            className="h-7 w-7 inline-flex items-center justify-center rounded-md text-neutral-400 hover:text-neutral-900 hover:bg-neutral-100 transition-colors shrink-0"
          >
            <PencilSimpleLine size={15} />
          </Link>
        </div>
      </div>
    </div>
  )
}

export function PodcastRow({ podcast, orgslug, orgUuid, onChanged }: ItemProps) {
  const { t, i18n } = useTranslation()
  const href = podcastEditorHref(orgslug, podcast)
  const cover = coverSrc(orgUuid, podcast)
  const updated = formatRelative(podcast.update_date, i18n.language)
  const authors = authorsOf(podcast)
  const trackOpen = useTrackOpen(podcast)

  return (
    <li className={`group relative flex items-center gap-3 px-4 sm:px-5 py-3 transition-colors hover:bg-neutral-50/70 ${PODCAST_ROW_GRID}`}>
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <Link prefetch={false} href={href} onClick={trackOpen} className="shrink-0">
          <PodcastCover src={cover} className="w-11 h-11 rounded-lg ring-1 ring-black/5" />
        </Link>
        <div className="min-w-0">
          <Link
            prefetch={false}
            href={href}
            onClick={trackOpen}
            dir="auto"
            className="block text-sm font-semibold text-neutral-900 truncate hover:underline underline-offset-2"
          >
            {podcast.name}
          </Link>
          <p className="text-xs text-neutral-500 truncate" dir="auto">
            {podcast.description || t('podcasts.dashboard.list.no_description')}
          </p>
          <div className="lg:hidden mt-1.5 flex flex-wrap items-center gap-1.5">
            <PodcastStatusChip published={podcast.published} />
            <PodcastVisibilityChip isPublic={podcast.public} />
          </div>
        </div>
      </div>

      <div className="hidden lg:block">
        <PodcastStatusChip published={podcast.published} />
      </div>
      <div className="hidden lg:block">
        <PodcastVisibilityChip isPublic={podcast.public} />
      </div>
      <div className="hidden lg:block text-sm text-neutral-600 tabular-nums">{podcast.episode_count ?? 0}</div>
      <div className="hidden lg:block">
        {authors.length ? <AvatarStack people={authors} size={24} /> : <span className="text-sm text-neutral-300">—</span>}
      </div>
      <div className="hidden lg:block text-sm text-neutral-600 truncate" title={podcast.update_date}>
        {updated ?? '—'}
      </div>

      <div className="flex items-center gap-1 justify-end shrink-0">
        <Link
          prefetch={false}
          href={podcastEditorHref(orgslug, podcast, 'content')}
          className={buttonClass('secondary', 'sm', 'hidden sm:inline-flex')}
        >
          <PencilSimpleLine size={13} />
          {t('podcasts.dashboard.list.episodes_short')}
        </Link>
        <AuthenticatedClientElement action="update" ressourceType="podcasts" checkMethod="roles" orgId={podcast.org_id}>
          <PodcastActionsMenu podcast={podcast} orgslug={orgslug} onChanged={onChanged} />
        </AuthenticatedClientElement>
      </div>
    </li>
  )
}

export function PodcastCardSkeleton() {
  return (
    <div className="bg-white rounded-2xl nice-shadow overflow-hidden animate-pulse">
      <div className="aspect-video bg-neutral-100" />
      <div className="p-4 space-y-2">
        <div className="h-4 bg-neutral-100 rounded w-3/4" />
        <div className="h-3 bg-neutral-100 rounded w-full" />
        <div className="h-3 bg-neutral-100 rounded w-1/2" />
      </div>
    </div>
  )
}

export function PodcastRowSkeleton() {
  return (
    <div className="flex items-center gap-3 px-5 py-3.5 animate-pulse lg:col-span-full">
      <div className="w-11 h-11 rounded-lg bg-neutral-100" />
      <div className="flex-1 space-y-2">
        <div className="h-3.5 bg-neutral-100 rounded w-1/3" />
        <div className="h-3 bg-neutral-100 rounded w-1/2" />
      </div>
      <div className="hidden sm:block h-6 w-20 bg-neutral-100 rounded-full" />
    </div>
  )
}
