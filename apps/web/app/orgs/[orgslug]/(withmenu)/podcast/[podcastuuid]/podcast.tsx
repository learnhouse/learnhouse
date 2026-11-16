'use client'

import React, { useLayoutEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import toast from 'react-hot-toast'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import {
  Export,
  Headphones,
  LockSimple,
  Pause,
  PencilSimpleLine,
  Play,
  Waveform,
} from '@phosphor-icons/react'
import { queryKeys } from '@/lib/query/keys'
import GeneralWrapperStyled from '@components/Objects/StyledElements/Wrappers/GeneralWrapper'
import { Breadcrumbs } from '@components/Objects/Breadcrumbs/Breadcrumbs'
import { PodcastSidebar } from '@components/Objects/Podcasts/PodcastSidebar'
import EpisodeCard from '@components/Objects/Podcasts/EpisodeCard'
import ListShortcuts from '@components/Objects/Shortcuts/ListShortcuts'
import ThumbnailImage from '@components/Objects/Thumbnails/ThumbnailImage'
import AuthenticatedClientElement from '@components/Security/AuthenticatedClientElement'
import { AvatarStack, Button, Chip, EmptyState, SegmentedControl, buttonClass } from '@components/Dashboard/Shared/DashKit/DashKit'
import { Podcast, PodcastEpisode, PodcastMeta, getPodcastMeta, removePodcastPrefix } from '@services/podcasts/podcasts'
import { getUriWithOrg } from '@services/config/config'
import { getUserAvatarMediaDirectory } from '@services/media/media'
import { usePodcastPlayer } from '@components/Contexts/PodcastPlayerContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { useTrackView, useLHAnalytics, AnalyticsEvent } from '@services/analytics'
import ResourcePaywall, { useResourcePaywall } from '@ee/components/Payments/ResourcePaywall'
import { listenedFraction, useListening } from '@components/Objects/Podcasts/listeningProgress'
import { formatLength, latestEpisode, newestFirst, podcastCover } from '@components/Objects/Podcasts/podcastUi'

interface PodcastClientProps {
  orgslug: string
  org_id: number
  podcastUuid: string
  initialPodcast: Podcast
  initialEpisodes: PodcastEpisode[]
}

const CARD = 'bg-white nice-shadow rounded-2xl'
type EpisodeOrder = 'order' | 'newest'

export default function PodcastClient({
  orgslug,
  podcastUuid,
  initialPodcast,
  initialEpisodes,
  org_id,
}: PodcastClientProps) {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const [order, setOrder] = useState<EpisodeOrder>('order')
  const listening = useListening()

  // Use TanStack Query for real-time updates
  const { data, error } = useQuery<PodcastMeta>({
    queryKey: queryKeys.podcasts.meta(podcastUuid),
    queryFn: () => getPodcastMeta(podcastUuid, null, access_token),
    initialData: { podcast: initialPodcast, episodes: initialEpisodes },
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    refetchInterval: 30000, // Refresh every 30 seconds
    staleTime: 60_000,
  })

  const podcast = data?.podcast || initialPodcast
  const fetchedEpisodes = data?.episodes
  const episodes = useMemo(
    () => (Array.isArray(fetchedEpisodes) ? fetchedEpisodes : Array.isArray(initialEpisodes) ? initialEpisodes : []),
    [fetchedEpisodes, initialEpisodes]
  )
  const shown = useMemo(() => (order === 'newest' ? newestFirst(episodes) : episodes), [episodes, order])
  const totalSeconds = useMemo(() => episodes.reduce((sum, e) => sum + (e.duration_seconds || 0), 0), [episodes])

  useTrackView(
    AnalyticsEvent.PodcastViewed,
    { episode_count: episodes.length, is_published: podcast.published },
    !!podcast,
    'learner',
  )

  if (error) {
    return (
      <GeneralWrapperStyled>
        <EmptyState icon={<Headphones size={22} />} title={t('podcasts.failed_to_load')} />
      </GeneralWrapperStyled>
    )
  }

  return (
    <GeneralWrapperStyled>
      <ListShortcuts />
      <div className="pb-6">
        <div className="pb-4">
          <Breadcrumbs
            items={[
              {
                label: t('podcasts.podcasts'),
                href: getUriWithOrg(orgslug, '/podcasts'),
                icon: <Headphones size={14} />,
              },
              { label: podcast.name },
            ]}
          />
        </div>

        <PodcastHero
          podcast={podcast}
          episodes={episodes}
          totalSeconds={totalSeconds}
          orgslug={orgslug}
          orgId={org_id}
          listening={listening}
        />

        <div className="mt-6 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-6 items-start">
          <section className="min-w-0">
            <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
              <div>
                <h2 className="text-lg font-bold tracking-tight text-neutral-900">{t('podcasts.episodes')}</h2>
                <p className="text-sm text-neutral-500 tabular-nums">
                  {t('podcasts.listen.episode_count', { count: episodes.length })}
                  {totalSeconds > 0 && ` · ${formatLength(totalSeconds, t)}`}
                </p>
              </div>
              {episodes.length > 1 && (
                <SegmentedControl<EpisodeOrder>
                  value={order}
                  onChange={setOrder}
                  ariaLabel={t('podcasts.listen.sort_label')}
                  options={[
                    { key: 'order', label: t('podcasts.listen.sort_order') },
                    { key: 'newest', label: t('podcasts.listen.sort_newest') },
                  ]}
                />
              )}
            </div>

            {/* Episodes List, or what unlocks it when the podcast is sold */}
            <ResourcePaywall orgId={org_id} orgslug={orgslug} resourceUuid={podcast.podcast_uuid} resourceName={podcast.name}>
              {shown.length > 0 ? (
                <div className={`${CARD} overflow-hidden divide-y divide-neutral-100`}>
                  {shown.map((episode) => (
                    <EpisodeCard
                      key={episode.episode_uuid}
                      episode={episode}
                      podcast={podcast}
                      progress={listening[episode.episode_uuid]}
                    />
                  ))}
                </div>
              ) : (
                <div className={CARD}>
                  <EmptyState
                    icon={<Waveform size={22} />}
                    title={t('podcasts.no_episodes')}
                    description={t('podcasts.listen.no_episodes_description')}
                  />
                </div>
              )}
            </ResourcePaywall>
          </section>

          <aside className="lg:sticky lg:top-[calc(6rem+var(--lh-company-bar-h,0px))]">
            <PodcastSidebar podcast={podcast} episodeCount={episodes.length} orgslug={orgslug} totalSeconds={totalSeconds} />
          </aside>
        </div>
      </div>
    </GeneralWrapperStyled>
  )
}

function PodcastHero({
  podcast,
  episodes,
  totalSeconds,
  orgslug,
  orgId,
  listening,
}: {
  podcast: Podcast
  episodes: PodcastEpisode[]
  totalSeconds: number
  orgslug: string
  orgId: number
  listening: ReturnType<typeof useListening>
}) {
  const { t } = useTranslation()
  const org = useOrg() as any
  const { state, playEpisode, togglePlay } = usePodcastPlayer()
  const { track } = useLHAnalytics('learner')
  const { locked } = useResourcePaywall(orgId, podcast.podcast_uuid)

  const cover = podcastCover(org?.org_uuid, podcast)
  const hosts = (podcast.authors ?? []).filter((a) => a?.authorship_status === 'ACTIVE' && a.user)
  const hostNames = hosts.map((a) => [a.user.first_name, a.user.last_name].filter(Boolean).join(' ') || a.user.username)

  // The main button: control what is already playing from this podcast, else
  // pick up the episode left half-way most recently, else the newest one.
  const isThisPodcast = state.podcast?.podcast_uuid === podcast.podcast_uuid && !!state.currentEpisode
  const resume = useMemo(() => {
    const ids = new Set(episodes.map((e) => e.episode_uuid))
    const entry = Object.values(listening)
      .filter((l) => l.podcast.podcast_uuid === podcast.podcast_uuid && ids.has(l.episode.episode_uuid))
      .filter((l) => listenedFraction(l) > 0.01 && listenedFraction(l) < 0.99)
      .sort((a, b) => b.at - a.at)[0]
    return entry ? episodes.find((e) => e.episode_uuid === entry.episode.episode_uuid) : undefined
  }, [listening, episodes, podcast.podcast_uuid])
  const latest = latestEpisode(episodes)
  const target = resume ?? latest

  const onPrimary = () => {
    if (isThisPodcast) {
      togglePlay()
      return
    }
    if (!target) return
    track(AnalyticsEvent.EpisodePlayed, {
      episode_number: target.episode_number,
      duration_seconds: target.duration_seconds,
    })
    playEpisode(target, podcast)
  }

  const share = async () => {
    const url = window.location.href
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: podcast.name, url })
        return
      } catch (e: any) {
        if (e?.name === 'AbortError') return
      }
    }
    try {
      await navigator.clipboard.writeText(url)
      toast.success(t('podcasts.listen.link_copied'))
    } catch {
      toast.error(t('podcasts.dashboard.list.copy_failed'))
    }
  }

  const primaryLabel = isThisPodcast
    ? state.isPlaying
      ? t('podcasts.listen.pause')
      : t('podcasts.listen.resume')
    : resume
      ? t('podcasts.listen.resume')
      : t('podcasts.listen.play_latest')
  const primaryIcon = isThisPodcast && state.isPlaying ? <Pause size={14} weight="fill" /> : <Play size={14} weight="fill" className="rtl:-scale-x-100" />
  const nowTitle = isThisPodcast ? state.currentEpisode?.title : target?.title

  const details = (
    <>
      {podcast.description && <ExpandableText text={podcast.description} />}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {!locked && (isThisPodcast || target) && (
          <Button variant="primary" size="md" onClick={onPrimary} icon={primaryIcon} title={nowTitle}>
            {primaryLabel}
          </Button>
        )}
        <Button variant="secondary" size="md" onClick={share} icon={<Export size={14} />}>
          {t('podcasts.listen.share')}
        </Button>
        <AuthenticatedClientElement action="update" ressourceType="podcasts" checkMethod="roles" orgId={podcast.org_id}>
          <Link
            href={getUriWithOrg(orgslug, `/dash/podcasts/podcast/${removePodcastPrefix(podcast.podcast_uuid)}/general`)}
            className={buttonClass('ghost', 'md')}
          >
            <PencilSimpleLine size={14} />
            {t('podcasts.manage_podcast')}
          </Link>
        </AuthenticatedClientElement>
      </div>
      {!locked && nowTitle && (
        <p className="mt-2 text-xs text-neutral-500 truncate" dir="auto">
          <span className="font-semibold uppercase tracking-wider text-[10px] text-neutral-400 me-1.5">
            {isThisPodcast ? t('podcasts.listen.now_playing') : resume ? t('podcasts.listen.up_next') : t('podcasts.listen.latest')}
          </span>
          {nowTitle}
        </p>
      )}
    </>
  )

  return (
    <section className={`${CARD} p-4 sm:p-6`}>
      <div className="flex gap-4 sm:gap-6">
        <ThumbnailImage
          src={cover}
          alt=""
          fetchPriority="high"
          loading="eager"
          className="w-28 h-28 sm:w-44 sm:h-44 lg:w-52 lg:h-52 shrink-0 rounded-2xl ring-1 ring-black/5 shadow-[0_12px_32px_-16px_rgba(0,0,0,0.35)]"
        />
        <div className="min-w-0 flex-1 flex flex-col">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-400 me-1">
              <Headphones size={13} weight="bold" />
              {t('podcasts.listen.eyebrow')}
            </span>
            {!podcast.published && <Chip tone="amber">{t('podcasts.unpublished')}</Chip>}
            {podcast.published && !podcast.public && (
              <Chip tone="neutral" icon={<LockSimple size={11} weight="bold" />}>
                {t('podcasts.private')}
              </Chip>
            )}
          </div>
          <h1 className="mt-1.5 text-xl sm:text-3xl font-bold tracking-tight text-neutral-900 leading-tight line-clamp-3" dir="auto">
            {podcast.name}
          </h1>
          {hosts.length > 0 && (
            <div className="mt-2 flex items-center gap-2 min-w-0">
              <AvatarStack
                size={20}
                people={hosts.map((a, i) => ({
                  key: a.user.user_uuid,
                  src: a.user.avatar_image ? getUserAvatarMediaDirectory(a.user.user_uuid, a.user.avatar_image) : '',
                  label: hostNames[i],
                }))}
              />
              <p className="text-sm text-neutral-600 truncate">
                {t('podcasts.listen.by', { names: hostNames.join(', ') })}
              </p>
            </div>
          )}
          <p className="mt-1.5 text-xs sm:text-sm text-neutral-500 tabular-nums">
            {t('podcasts.listen.episode_count', { count: episodes.length })}
            {totalSeconds > 0 && ` · ${formatLength(totalSeconds, t)}`}
          </p>
          <div className="hidden sm:block mt-3">{details}</div>
        </div>
      </div>
      <div className="sm:hidden mt-4">{details}</div>
    </section>
  )
}

/** Three lines of description with a Show more toggle when it runs longer. */
function ExpandableText({ text }: { text: string }) {
  const { t } = useTranslation()
  const ref = useRef<HTMLParagraphElement>(null)
  const [open, setOpen] = useState(false)
  const [overflows, setOverflows] = useState(false)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const check = () => setOverflows(el.scrollHeight > el.clientHeight + 1)
    check()
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => ro.disconnect()
  }, [text])

  return (
    <div>
      <p
        ref={ref}
        className={`text-sm sm:text-[15px] text-neutral-600 leading-relaxed whitespace-pre-line text-pretty ${open ? '' : 'line-clamp-3'}`}
        dir="auto"
      >
        {text}
      </p>
      {(overflows || open) && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="mt-1 text-xs font-semibold text-neutral-900 hover:underline underline-offset-2"
        >
          {open ? t('common.show_less') : t('common.show_more')}
        </button>
      )}
    </div>
  )
}
