'use client'
import React, { use } from 'react'
import Link from 'next/link'
import { useSelectedLayoutSegment } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowLeft,
  ArrowSquareOut,
  ChatCenteredText,
  Garage,
  GearSix,
  WarningCircle,
  MagnifyingGlass,
} from '@phosphor-icons/react'
import { CommunityProvider, useCommunity } from '@components/Contexts/CommunityContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import FeatureGate from '@components/Dashboard/Shared/FeatureGate/FeatureGate'
import { DashTabBar, DashTabItem } from '@components/Dashboard/Shared/DashTabBar/DashTabBar'
import { Breadcrumbs } from '@components/Objects/Breadcrumbs/Breadcrumbs'
import { EmptyState, buttonClass } from '@components/Dashboard/Shared/DashKit/DashKit'
import ThumbnailImage from '@components/Objects/Thumbnails/ThumbnailImage'
import { getUriWithOrg } from '@services/config/config'
import { getCommunity } from '@services/communities/communities'
import { queryKeys } from '@/lib/query/keys'
import { LinkedCourseChip, VisibilityChip, communityThumbnail } from '../_components/communityItems'

type LayoutParams = { orgslug: string; communityuuid: string }

const TABS = [
  { key: 'discussions', icon: ChatCenteredText, label: 'communities.dash.tabs.discussions' },
  { key: 'settings', icon: GearSix, label: 'communities.dash.tabs.settings' },
  { key: 'seo', icon: MagnifyingGlass, label: 'dashboard.courses.settings.tabs.seo' },
] as const

// The header, tabs and community data live in a layout so switching tabs
// only swaps the body below: the header never unmounts or flashes.
export default function CommunityEditorLayout(props: { children: React.ReactNode; params: Promise<LayoutParams> }) {
  const params = use(props.params)
  const { t } = useTranslation()
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token
  const fullUuid = params.communityuuid.startsWith('community_')
    ? params.communityuuid
    : `community_${params.communityuuid}`

  // Same query (and key) as CommunityProvider: it is shared, not fetched twice.
  // The provider renders nothing until the data is in, so the shell shows a
  // skeleton of itself meanwhile instead of a blank page.
  const { data, error } = useQuery({
    queryKey: queryKeys.community.detail(fullUuid),
    queryFn: () => getCommunity(fullUuid, null, accessToken),
    staleTime: 60_000,
    enabled: !!accessToken,
  })

  return (
    <FeatureGate feature="communities" orgslug={params.orgslug} context="dashboard">
      <div className="h-screen w-full grid grid-rows-[auto_1fr] grid-cols-1">
        {error ? (
          <>
            <HeaderSkeleton />
            <div className="px-4 sm:px-10 pt-8">
              <div className="bg-white rounded-2xl nice-shadow">
                <EmptyState
                  icon={<WarningCircle size={22} />}
                  title={t('communities.load_failed')}
                  action={
                    <Link href={getUriWithOrg(params.orgslug, '/dash/communities')} className={buttonClass('secondary', 'sm')}>
                      <ArrowLeft size={13} className="rtl:rotate-180" />
                      {t('communities.dash.back_to_communities')}
                    </Link>
                  }
                />
              </div>
            </div>
          </>
        ) : !data ? (
          <>
            <HeaderSkeleton />
            <BodySkeleton />
          </>
        ) : (
          <CommunityProvider communityuuid={params.communityuuid}>
            <CommunityEditorHeader orgslug={params.orgslug} communityuuid={params.communityuuid} />
            <div className="h-full overflow-y-auto overflow-x-hidden">{props.children}</div>
          </CommunityProvider>
        )}
      </div>
    </FeatureGate>
  )
}

function CommunityEditorHeader({ orgslug, communityuuid }: LayoutParams) {
  const { t } = useTranslation()
  const org = useOrg() as any
  const segment = useSelectedLayoutSegment()
  const community = useCommunity()?.community
  if (!community) return <HeaderSkeleton />

  const thumb = communityThumbnail(org?.org_uuid, community)
  const base = getUriWithOrg(orgslug, '') + `/dash/communities/${communityuuid}`
  // Anything but discussions is a settings page (old per-section URLs too).
  const activeKey = segment === 'discussions' || !segment ? 'discussions' : 'settings'
  const tabs: DashTabItem[] = TABS.map(({ key, icon: Icon, label }) => ({
    key,
    label: t(label),
    icon: <Icon size={16} />,
    href: `${base}/${key}`,
    active: activeKey === key,
  }))

  return (
    <header className="bg-white nice-shadow relative z-10 px-4 sm:px-10 min-w-0">
      <div className="pt-4 sm:pt-6 pb-1.5 sm:pb-2">
        <Breadcrumbs
          items={[
            { label: t('dashboard.courses.communities.title'), href: '/dash/communities', icon: <Garage size={14} /> },
            { label: community.name, href: `/dash/communities/${communityuuid}/discussions` },
          ]}
        />
        <div className="mt-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Link
              href={getUriWithOrg(orgslug, '/dash/communities')}
              className="w-9 h-9 inline-flex items-center justify-center rounded-xl bg-neutral-100 text-neutral-600 hover:bg-neutral-200 hover:text-neutral-900 transition-colors shrink-0"
              aria-label={t('communities.dash.back_to_communities')}
            >
              <ArrowLeft size={18} className="rtl:rotate-180" />
            </Link>
            {thumb ? (
              <ThumbnailImage
                src={thumb}
                alt=""
                loading="eager"
                className="hidden sm:block w-16 aspect-video rounded-lg object-cover ring-1 ring-black/5 shrink-0"
              />
            ) : (
              <span className="hidden sm:flex w-9 h-9 rounded-xl bg-neutral-100 text-neutral-400 items-center justify-center shrink-0">
                <Garage size={18} weight="duotone" />
              </span>
            )}
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-neutral-900 truncate min-w-0" dir="auto">
              {community.name}
            </h1>
            <span className="shrink-0 hidden sm:flex items-center gap-1.5">
              <VisibilityChip isPublic={community.public} />
              <LinkedCourseChip linked={!!community.course_id} />
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <a
              href={getUriWithOrg(orgslug, `/community/${communityuuid}`)}
              target="_blank"
              rel="noreferrer"
              className={buttonClass('secondary', 'md')}
            >
              <ArrowSquareOut size={15} />
              {t('dashboard.courses.communities.card.view_community')}
            </a>
          </div>
        </div>
      </div>
      <DashTabBar tabs={tabs} />
    </header>
  )
}

function HeaderSkeleton() {
  return (
    <header className="bg-white nice-shadow relative z-10 px-4 sm:px-10 animate-pulse">
      <div className="pt-4 sm:pt-6 pb-4">
        <div className="h-8 w-56 bg-neutral-100 rounded-lg" />
        <div className="flex items-center gap-3 mt-4">
          <div className="w-9 h-9 bg-neutral-100 rounded-xl" />
          <div className="w-16 aspect-video bg-neutral-100 rounded-lg" />
          <div className="h-7 w-56 bg-neutral-100 rounded-lg" />
          <div className="h-6 w-20 bg-neutral-100 rounded-full" />
        </div>
      </div>
      <div className="flex gap-6 py-3.5">
        {[64, 80, 64, 96, 88].map((w, i) => (
          <div key={i} className="h-4 rounded bg-neutral-100" style={{ width: w }} />
        ))}
      </div>
    </header>
  )
}

function BodySkeleton() {
  return (
    <div className="px-4 sm:px-10 pt-6 sm:pt-8 space-y-5 animate-pulse">
      {[0, 1].map((i) => (
        <div key={i} className="bg-white rounded-2xl nice-shadow p-5 space-y-5">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-neutral-100" />
            <div className="space-y-2">
              <div className="h-4 w-40 rounded bg-neutral-200" />
              <div className="h-3 w-72 max-w-full rounded bg-neutral-100" />
            </div>
          </div>
          <div className="h-9 w-full rounded-lg bg-neutral-100" />
          <div className="h-24 w-full rounded-lg bg-neutral-100" />
        </div>
      ))}
    </div>
  )
}
