'use client'
import React, { use, useState } from 'react'
import Link from 'next/link'
import { useSelectedLayoutSegment } from 'next/navigation'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ArrowSquareOut, Eye, EyeSlash, Headphones, Info, ListNumbers, Rss, MagnifyingGlass } from '@phosphor-icons/react'
import { PodcastProvider, usePodcast } from '@components/Contexts/PodcastContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { DashTabBar, DashTabItem } from '@components/Dashboard/Shared/DashTabBar/DashTabBar'
import { Breadcrumbs } from '@components/Objects/Breadcrumbs/Breadcrumbs'
import { Button, buttonClass } from '@components/Dashboard/Shared/DashKit/DashKit'
import { getUriWithOrg } from '@services/config/config'
import { updatePodcast } from '@services/podcasts/podcasts'
import { revalidateTags } from '@services/utils/ts/requests'
import { queryKeys } from '@/lib/query/keys'
import { PodcastCover, PodcastStatusChip } from '../../_components/podcastItems'
import { getPodcastThumbnailMediaDirectory } from '@services/media/media'
import { useOrg } from '@components/Contexts/OrgContext'

type LayoutParams = { orgslug: string; podcastuuid: string }

// The header, tabs and podcast data live in a layout so switching tabs only
// swaps the body below: no header skeleton, no full-page fade.
export default function PodcastEditorLayout(props: { children: React.ReactNode; params: Promise<LayoutParams> }) {
  const params = use(props.params)
  return (
    <PodcastProvider podcastuuid={`podcast_${params.podcastuuid}`}>
      <div className="h-screen w-full grid grid-rows-[auto_1fr] grid-cols-1">
        <PodcastEditorHeader orgslug={params.orgslug} podcastuuid={params.podcastuuid} />
        <div className="h-full overflow-y-auto">{props.children}</div>
      </div>
    </PodcastProvider>
  )
}

function PublishToggle({ orgslug }: { orgslug: string }) {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token
  const queryClient = useQueryClient()
  const { podcast, setPodcast } = usePodcast()
  const [busy, setBusy] = useState(false)
  if (!podcast) return null

  const toggle = async () => {
    const next = !podcast.published
    setBusy(true)
    setPodcast({ ...podcast, published: next })
    try {
      await updatePodcast(podcast.podcast_uuid, { published: next }, accessToken)
      toast.success(next ? t('podcasts.dashboard.list.published_toast') : t('podcasts.dashboard.list.unpublished_toast'))
      queryClient.invalidateQueries({ queryKey: queryKeys.podcasts.list(orgslug) })
      revalidateTags(['podcasts'], orgslug)
    } catch {
      setPodcast(podcast)
      toast.error(t('podcasts.dashboard.save_error'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button
      variant={podcast.published ? 'secondary' : 'primary'}
      onClick={toggle}
      loading={busy}
      icon={podcast.published ? <EyeSlash size={14} /> : <Eye size={14} />}
    >
      {podcast.published ? t('podcasts.dashboard.episodes.unpublish') : t('podcasts.dashboard.episodes.publish')}
    </Button>
  )
}

function PodcastEditorHeader({ orgslug, podcastuuid }: { orgslug: string; podcastuuid: string }) {
  const { t } = useTranslation()
  const org = useOrg() as any
  const segment = useSelectedLayoutSegment()
  const { podcast, episodes, isLoading } = usePodcast()

  const tabs = [
    { key: 'general', label: t('podcasts.dashboard.tabs.general'), icon: Info },
    { key: 'content', label: t('podcasts.dashboard.tabs.episodes'), icon: ListNumbers },
    { key: 'distribution', label: t('podcasts.dashboard.tabs.distribution'), icon: Rss },
    { key: 'seo', label: t('dashboard.courses.settings.tabs.seo'), icon: MagnifyingGlass },
  ]

  const tabBar = (
    <DashTabBar
      tabs={tabs.map(
        (tab): DashTabItem => ({
          key: tab.key,
          label: tab.label,
          icon: <tab.icon size={16} />,
          href: getUriWithOrg(orgslug, `/dash/podcasts/podcast/${podcastuuid}/${tab.key}`),
          active: segment === tab.key,
        })
      )}
    />
  )

  if (isLoading || !podcast) {
    return (
      <header className="bg-white nice-shadow relative z-10 px-4 sm:px-10">
        <div className="pt-4 sm:pt-6 pb-1.5 sm:pb-2 animate-pulse">
          <div className="h-4 w-40 bg-neutral-100 rounded" />
          <div className="flex items-center gap-3 mt-4">
            <div className="w-9 h-9 bg-neutral-100 rounded-xl" />
            <div className="w-10 h-10 bg-neutral-100 rounded-lg" />
            <div className="h-7 w-56 bg-neutral-100 rounded-lg" />
          </div>
        </div>
        {tabBar}
      </header>
    )
  }

  const cover = podcast.thumbnail_image && org?.org_uuid
    ? getPodcastThumbnailMediaDirectory(org.org_uuid, podcast.podcast_uuid, podcast.thumbnail_image)
    : null

  return (
    <header className="bg-white nice-shadow relative z-10 px-4 sm:px-10">
      <div className="pt-4 sm:pt-6 pb-1.5 sm:pb-2">
        <Breadcrumbs
          items={[
            { label: t('podcasts.podcasts'), href: '/dash/podcasts', icon: <Headphones size={14} /> },
            { label: podcast.name, href: `/dash/podcasts/podcast/${podcastuuid}/general` },
          ]}
        />
        <div className="mt-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Link
              href={getUriWithOrg(orgslug, '/dash/podcasts')}
              className="w-8 h-8 inline-flex items-center justify-center rounded-lg bg-neutral-100 text-neutral-600 hover:bg-neutral-200 hover:text-neutral-900 transition-colors shrink-0"
              aria-label={t('podcasts.dashboard.back_to_podcasts')}
            >
              <ArrowLeft size={16} className="rtl:rotate-180" />
            </Link>
            <PodcastCover src={cover} className="w-10 h-10 rounded-lg ring-1 ring-black/5 shrink-0" iconSize={16} />
            <div className="min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-neutral-900 truncate" dir="auto">
                  {podcast.name}
                </h1>
                <span className="shrink-0">
                  <PodcastStatusChip published={podcast.published} />
                </span>
              </div>
              <p className="text-xs text-neutral-500 tabular-nums">
                {t('podcasts.dashboard.list.episodes_count', { count: episodes.length })}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Link
              href={getUriWithOrg(orgslug, `/podcast/${podcastuuid}`)}
              target="_blank"
              className={buttonClass('secondary', 'md')}
            >
              <ArrowSquareOut size={14} />
              {t('podcasts.dashboard.view_podcast')}
            </Link>
            <PublishToggle orgslug={orgslug} />
          </div>
        </div>
      </div>
      {tabBar}
    </header>
  )
}
