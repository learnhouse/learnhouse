'use client'
import React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import toast from 'react-hot-toast'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { CircleNotch, DotsThreeVertical, GearSix, Headphones, Pause, PencilSimpleLine, Play, Trash } from '@phosphor-icons/react'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { usePodcastPlayer } from '@components/Contexts/PodcastPlayerContext'
import AuthenticatedClientElement from '@components/Security/AuthenticatedClientElement'
import ThumbnailImage from '@components/Objects/Thumbnails/ThumbnailImage'
import { ConfirmDialog } from '@components/Dashboard/Shared/DashKit/DashKit'
import { useSeen } from '@components/Objects/Paths/PathTrack'
import { Equalizer, formatEpisodeDate, isWithinWeek, latestEpisode, podcastCover } from '@components/Objects/Podcasts/podcastUi'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@components/ui/dropdown-menu'
import { getUriWithOrg } from '@services/config/config'
import { deletePodcast, getPodcastMeta, Podcast, PodcastMeta, removePodcastPrefix } from '@services/podcasts/podcasts'
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics'
import { queryKeys } from '@/lib/query/keys'
import { resourcePath } from '@/lib/seo/paths'

type PodcastTile = Podcast & { episode_count?: number }

type PropsType = {
  podcast: PodcastTile
  orgslug: string
  customLink?: string
  isDashboard?: boolean
}

/**
 * A podcast in the catalog: square cover with a play button that starts the
 * newest episode, then name, hosts and when the last episode came out.
 */
function PodcastThumbnail({ podcast, orgslug, customLink, isDashboard = false }: PropsType) {
  const { t, i18n } = useTranslation()
  const org = useOrg() as any
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token as string | undefined
  const router = useRouter()
  const queryClient = useQueryClient()
  const { state, playEpisode, togglePlay } = usePodcastPlayer()
  const { track } = useLHAnalytics(isDashboard ? 'dashboard' : 'learner')
  const [ref, seen] = useSeen<HTMLDivElement>()
  const [starting, setStarting] = React.useState(false)

  const podcastLink = customLink
    ? customLink
    : isDashboard
      ? getUriWithOrg(orgslug, `/dash/podcasts/podcast/${removePodcastPrefix(podcast.podcast_uuid)}/general`)
      : getUriWithOrg(orgslug, resourcePath('podcast', podcast))

  // The list carries no episodes, so the newest one is read once the tile
  // scrolls into view. Same cache entry as the podcast page, which then opens
  // with its episodes already loaded.
  const metaQuery = {
    queryKey: queryKeys.podcasts.meta(podcast.podcast_uuid),
    queryFn: () => getPodcastMeta(podcast.podcast_uuid, null, accessToken) as Promise<PodcastMeta>,
    staleTime: 60_000,
  }
  const { data: meta } = useQuery({ ...metaQuery, enabled: seen && (podcast.episode_count ?? 1) > 0 })
  const latest = latestEpisode(meta?.episodes)
  const latestDate = latest ? formatEpisodeDate(latest.creation_date, i18n.language) : null
  const isNew = isWithinWeek(latest?.creation_date)

  const isThisPodcast = state.podcast?.podcast_uuid === podcast.podcast_uuid && !!state.currentEpisode
  const isPlaying = isThisPodcast && state.isPlaying
  const hasEpisodes = (podcast.episode_count ?? 1) > 0
  const hosts = (podcast.authors ?? [])
    .filter((a) => a?.authorship_status === 'ACTIVE' && a.user)
    .map((a) => [a.user.first_name, a.user.last_name].filter(Boolean).join(' ') || a.user.username)

  const handleCardOpen = () => {
    track(AnalyticsEvent.PodcastCardOpened, {
      episode_count: podcast.episode_count,
      source: isDashboard ? 'dashboard' : 'public',
    })
  }

  const handlePlay = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (isThisPodcast) {
      togglePlay()
      return
    }
    setStarting(true)
    try {
      const data = meta ?? (await queryClient.fetchQuery(metaQuery))
      const episode = latestEpisode(data?.episodes)
      // Nothing playable from here (e.g. sold and not bought): the podcast
      // page explains why.
      if (!episode) {
        router.push(podcastLink)
        return
      }
      track(AnalyticsEvent.EpisodePlayed, {
        episode_number: episode.episode_number,
        duration_seconds: episode.duration_seconds,
      })
      playEpisode(episode, data?.podcast ?? podcast)
    } catch {
      toast.error(t('podcasts.failed_to_load'))
    } finally {
      setStarting(false)
    }
  }

  const handleDeletePodcast = async () => {
    const toastId = toast.loading(t('podcasts.deleting_podcast'))
    try {
      await deletePodcast(podcast.podcast_uuid, accessToken ?? '')
      queryClient.invalidateQueries({ queryKey: ['podcasts'] })
      toast.success(t('podcasts.podcast_deleted_success'))
      router.refresh()
    } catch (_error) {
      toast.error(t('podcasts.podcast_deleted_error'))
    } finally {
      toast.dismiss(toastId)
    }
  }

  const playLabel = isPlaying
    ? t('podcasts.listen.pause')
    : t('podcasts.listen.play_latest_of', { name: podcast.name })

  return (
    <div
      ref={ref}
      data-kbd-item=""
      className="group relative flex flex-col bg-white rounded-2xl nice-shadow p-2.5 sm:p-3 w-full min-w-0 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg"
    >
      <div className="relative aspect-square rounded-xl overflow-hidden bg-neutral-100 ring-1 ring-black/5">
        <Link prefetch={false} href={podcastLink} onClick={handleCardOpen} tabIndex={-1} aria-hidden className="block w-full h-full">
          <ThumbnailImage
            src={podcastCover(org?.org_uuid, podcast)}
            className="w-full h-full transition-transform duration-500 group-hover:scale-[1.03] motion-reduce:transition-none"
          />
        </Link>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/25 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />

        <div className="pointer-events-none absolute top-2 start-2 flex flex-wrap gap-1">
          {!podcast.published && (
            <span className="rounded-full bg-amber-100 text-amber-800 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide shadow-sm">
              {t('podcasts.unpublished')}
            </span>
          )}
          {isNew && (
            <span className="rounded-full bg-white/95 text-neutral-900 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide shadow-sm">
              {t('podcasts.listen.new')}
            </span>
          )}
        </div>

        {hasEpisodes && (
          <button
            type="button"
            onClick={handlePlay}
            aria-label={playLabel}
            title={playLabel}
            className={`absolute bottom-2 end-2 w-11 h-11 rounded-full bg-white text-neutral-900 flex items-center justify-center shadow-[0_8px_20px_-6px_rgba(0,0,0,0.45),0_0_0_1px_rgba(0,0,0,0.04)] transition-all duration-200 hover:scale-105 active:scale-95 focus-visible:opacity-100 focus-visible:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/30 ${
              isThisPodcast
                ? 'opacity-100 translate-y-0'
                : 'opacity-0 translate-y-1.5 group-hover:opacity-100 group-hover:translate-y-0 [@media(hover:none)]:opacity-100 [@media(hover:none)]:translate-y-0'
            }`}
          >
            {starting ? (
              <CircleNotch size={18} className="animate-spin" />
            ) : isPlaying ? (
              <>
                <Equalizer className="group-hover:hidden" />
                <Pause size={18} weight="fill" className="hidden group-hover:block" />
              </>
            ) : (
              <Play size={18} weight="fill" className="ms-0.5 rtl:-scale-x-100" />
            )}
          </button>
        )}
      </div>

      <div className="flex flex-col flex-1 min-w-0 pt-3 px-0.5">
        <Link
          prefetch={false}
          href={podcastLink}
          onClick={handleCardOpen}
          className="text-[15px] font-semibold text-neutral-900 leading-snug line-clamp-1 hover:underline underline-offset-2"
          dir="auto"
          title={podcast.name}
        >
          {podcast.name}
        </Link>
        <p className="text-xs text-neutral-500 truncate mt-0.5" dir="auto">
          {hosts.length ? hosts.join(', ') : podcast.description}
        </p>
        <p className="mt-auto pt-2 flex items-center gap-1.5 text-[11px] text-neutral-400 tabular-nums min-w-0">
          <Headphones size={12} className="shrink-0" />
          <span className="truncate">
            {t('podcasts.listen.episode_count', { count: podcast.episode_count ?? 0 })}
            {latestDate && <> · {t('podcasts.listen.latest_on', { date: latestDate })}</>}
          </span>
        </p>
      </div>

      <AdminEditOptions podcast={podcast} orgSlug={orgslug} deletePodcast={handleDeletePodcast} />
    </div>
  )
}

const AdminEditOptions = ({ podcast, orgSlug, deletePodcast }: {
  podcast: PodcastTile
  orgSlug: string
  deletePodcast: () => Promise<void>
}) => {
  const { t } = useTranslation()
  const [isOpen, setIsOpen] = React.useState(false)
  const [confirming, setConfirming] = React.useState(false)
  const base = `/dash/podcasts/podcast/${removePodcastPrefix(podcast.podcast_uuid)}`

  return (
    <AuthenticatedClientElement
      action="update"
      ressourceType="podcasts"
      checkMethod="roles"
      orgId={podcast.org_id}
    >
      <div className={`absolute top-4 end-4 sm:top-5 sm:end-5 z-20 transition-opacity ${isOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100'}`}>
        <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
          <DropdownMenuTrigger asChild>
            <button
              aria-label={t('podcasts.actions')}
              className="w-7 h-7 flex items-center justify-center bg-white/95 rounded-full text-neutral-700 hover:text-neutral-900 shadow-[0_1px_2px_rgba(0,0,0,0.12),0_0_0_1px_rgba(0,0,0,0.06)]"
            >
              <DotsThreeVertical size={16} weight="bold" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem asChild>
              <Link prefetch={false} href={getUriWithOrg(orgSlug, `${base}/content`)} className="flex items-center cursor-pointer">
                <PencilSimpleLine className="me-2 h-4 w-4" /> {t('podcasts.edit_content')}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link prefetch={false} href={getUriWithOrg(orgSlug, `${base}/general`)} className="flex items-center cursor-pointer">
                <GearSix className="me-2 h-4 w-4" /> {t('common.settings')}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => setConfirming(true)}
              className="flex items-center cursor-pointer text-rose-600 focus:text-rose-700 focus:bg-rose-50"
            >
              <Trash className="me-2 h-4 w-4" /> {t('podcasts.delete_podcast')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t('podcasts.delete_podcast_title', { name: podcast.name })}
        message={t('podcasts.delete_podcast_confirm')}
        confirmLabel={t('podcasts.delete_podcast')}
        onConfirm={deletePodcast}
      />
    </AuthenticatedClientElement>
  )
}

/** Placeholder tile while the catalog loads. */
export function PodcastCardSkeleton() {
  return (
    <div className="bg-white rounded-2xl nice-shadow p-2.5 sm:p-3 animate-pulse">
      <div className="aspect-square rounded-xl bg-neutral-100" />
      <div className="pt-3 space-y-2">
        <div className="h-4 w-3/4 rounded bg-neutral-100" />
        <div className="h-3 w-1/2 rounded bg-neutral-100" />
        <div className="h-3 w-2/3 rounded bg-neutral-100 mt-3" />
      </div>
    </div>
  )
}

export default PodcastThumbnail
