'use client'
import React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { Books, Users, ChatCircle, Microphone, Chalkboard } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getCommunities } from '@services/communities/communities'
import { getBoards } from '@ee/services/boards/boards'
import { getOrgPodcasts } from '@services/podcasts/podcasts'
import { useHomeCourses, useHomeMembers } from './homeData'

// Static so Tailwind keeps them; picked by how many cards are visible.
const LG_COLS: Record<number, string> = {
  1: 'lg:grid-cols-1',
  2: 'lg:grid-cols-2',
  3: 'lg:grid-cols-3',
  4: 'lg:grid-cols-4',
  5: 'lg:grid-cols-5',
}

export default function ContentOverview() {
  const { t } = useTranslation()
  const org = useOrg() as any
  const session = useLHSession() as any
  const token = session?.data?.tokens?.access_token
  const orgslug = org?.slug
  const orgId = org?.id
  const rf = org?.config?.config?.resolved_features
  const features = org?.config?.config?.features
  const isEnabled = (feature: string, defaultDisabled = false) => {
    if (rf?.[feature]) return rf[feature].enabled
    const v1 = features?.[feature]
    return defaultDisabled ? v1?.enabled === true : v1?.enabled !== false
  }

  // Shared with the recent courses / members cards: one request each.
  const { data: coursesData, isLoading: coursesLoading } = useHomeCourses()
  const { data: membersData, isLoading: membersLoading } = useHomeMembers()

  const communitiesEnabled = isEnabled('communities')
  const { data: communitiesData, isLoading: communitiesLoading } = useQuery({
    queryKey: queryKeys.community.list(orgId),
    queryFn: () => getCommunities(orgId, 1, 500, null, token),
    enabled: !!communitiesEnabled && !!token && !!orgId,
    staleTime: 60_000,
  })

  const podcastsEnabled = isEnabled('podcasts', true)
  const { data: podcastsData, isLoading: podcastsLoading } = useQuery({
    queryKey: [...queryKeys.podcasts.list(orgslug), 'overview'],
    queryFn: () => getOrgPodcasts(orgslug, null, token, true),
    enabled: !!podcastsEnabled && !!token && !!orgslug,
    staleTime: 60_000,
  })

  const boardsEnabled = isEnabled('boards', true)
  const { data: boardsData, isLoading: boardsLoading } = useQuery({
    queryKey: [...queryKeys.boards.list(orgslug), 'overview'],
    queryFn: () => getBoards(orgId, token),
    enabled: !!boardsEnabled && !!token && !!orgId,
    staleTime: 60_000,
  })

  const courses: any[] = coursesData ?? []
  const totalMembers = membersData?.total ?? 0
  const communities: any[] = communitiesData ?? []
  const podcasts: any[] = podcastsData ?? []
  const boards: any[] = boardsData ?? []

  const publishedCourses = courses.filter((c: any) => c.published).length
  const draftCourses = courses.length - publishedCourses

  const cards = [
    {
      key: 'courses',
      label: t('dashboard.home.courses'),
      value: courses.length,
      hint: `${publishedCourses} ${t('dashboard.home.published')} · ${draftCourses} ${t('dashboard.home.draft')}`,
      icon: <Books size={16} />,
      iconClass: 'bg-sky-50 text-sky-600',
      href: '/dash/courses',
      show: true,
      loading: coursesLoading,
    },
    {
      key: 'members',
      label: t('dashboard.home.members'),
      value: totalMembers,
      hint: t('dashboard.home.total_users'),
      icon: <Users size={16} />,
      iconClass: 'bg-neutral-100 text-neutral-600',
      href: '/dash/users/settings/users',
      show: true,
      loading: membersLoading,
    },
    {
      key: 'communities',
      label: t('dashboard.home.communities'),
      value: communities.length,
      hint: `${communities.filter((c: any) => c.public).length} ${t('dashboard.home.public')}`,
      icon: <ChatCircle size={16} />,
      iconClass: 'bg-violet-50 text-violet-600',
      href: '/dash/communities',
      show: communitiesEnabled,
      loading: communitiesLoading,
    },
    {
      key: 'podcasts',
      label: t('dashboard.home.podcasts'),
      value: podcasts.length,
      hint: `${podcasts.reduce((sum: number, p: any) => sum + (p.episode_count || 0), 0)} ${t('dashboard.home.episodes')}`,
      icon: <Microphone size={16} />,
      iconClass: 'bg-amber-50 text-amber-600',
      href: '/dash/podcasts',
      show: podcastsEnabled,
      loading: podcastsLoading,
    },
    {
      key: 'boards',
      label: t('dashboard.home.boards'),
      value: boards.length,
      hint: `${boards.reduce((sum: number, b: any) => sum + (b.member_count || 0), 0)} ${t('dashboard.home.participants')}`,
      icon: <Chalkboard size={16} />,
      iconClass: 'bg-rose-50 text-rose-600',
      href: '/dash/boards',
      show: boardsEnabled,
      loading: boardsLoading,
    },
  ]

  const visibleCards = cards.filter((c) => c.show)

  return (
    <div className={`grid gap-3 grid-cols-2 sm:grid-cols-3 ${LG_COLS[visibleCards.length] || 'lg:grid-cols-5'}`}>
      {visibleCards.map((card) => (
        <StatLink
          key={card.key}
          href={card.href}
          icon={card.icon}
          iconClass={card.iconClass}
          label={card.label}
          value={card.loading ? null : card.value}
          hint={card.loading ? null : card.hint}
        />
      ))}
    </div>
  )
}

// DashKit's StatCard as a link, with a one-line breakdown under the number.
function StatLink({
  href,
  icon,
  iconClass,
  label,
  value,
  hint,
}: {
  href: string
  icon: React.ReactNode
  iconClass: string
  label: string
  value: number | null
  hint: string | null
}) {
  return (
    <Link
      href={href}
      className="group flex items-start gap-3 bg-white nice-shadow rounded-2xl px-4 py-3.5 min-w-0 transition-shadow hover:ring-1 hover:ring-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/20"
    >
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${iconClass}`}>{icon}</div>
      <div className="min-w-0 text-start">
        <p className="text-xs text-neutral-500 truncate group-hover:text-neutral-700 transition-colors">{label}</p>
        {value === null ? (
          <div className="mt-1 h-5 w-8 rounded bg-neutral-100 animate-pulse" />
        ) : (
          <p className="text-xl font-bold text-neutral-900 tabular-nums leading-tight">{value}</p>
        )}
        {hint === null ? (
          <div className="mt-1.5 h-2.5 w-16 rounded bg-neutral-100 animate-pulse" />
        ) : (
          <p className="mt-0.5 text-[11px] text-neutral-400 truncate">{hint}</p>
        )}
      </div>
    </Link>
  )
}
