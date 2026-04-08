'use client'
import React from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import {
  BookOpen,
  Users,
  ChatCircle,
  Microphone,
  Chalkboard,
} from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getAPIUrl } from '@services/config/config'
import { swrFetcher } from '@services/utils/ts/requests'

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

  // Courses
  const { data: coursesData } = useSWR(
    token && orgslug
      ? `${getAPIUrl()}courses/org_slug/${orgslug}/page/1/limit/500?include_unpublished=true`
      : null,
    (url) => swrFetcher(url, token),
    { revalidateOnFocus: false }
  )

  // Members
  const { data: membersData } = useSWR(
    token && orgId
      ? `${getAPIUrl()}orgs/${orgId}/users?page=1&limit=1`
      : null,
    (url) => swrFetcher(url, token),
    { revalidateOnFocus: false }
  )

  // Communities
  const communitiesEnabled = isEnabled('communities')
  const { data: communitiesData } = useSWR(
    communitiesEnabled && token && orgId
      ? `${getAPIUrl()}communities/org/${orgId}/page/1/limit/500`
      : null,
    (url) => swrFetcher(url, token),
    { revalidateOnFocus: false }
  )

  // Podcasts
  const podcastsEnabled = isEnabled('podcasts', true)
  const { data: podcastsData } = useSWR(
    podcastsEnabled && token && orgslug
      ? `${getAPIUrl()}podcasts/org_slug/${orgslug}/page/1/limit/100?include_unpublished=true`
      : null,
    (url) => swrFetcher(url, token),
    { revalidateOnFocus: false }
  )

  // Boards
  const boardsEnabled = isEnabled('boards', true)
  const { data: boardsData } = useSWR(
    boardsEnabled && token && orgId
      ? `${getAPIUrl()}boards/org/${orgId}`
      : null,
    (url) => swrFetcher(url, token),
    { revalidateOnFocus: false }
  )

  const courses: any[] = coursesData ?? []
  const totalMembers = membersData?.total ?? 0
  const communities: any[] = communitiesData ?? []
  const podcasts: any[] = podcastsData ?? []
  const boards: any[] = boardsData ?? []

  const publishedCourses = courses.filter((c: any) => c.published).length
  const draftCourses = courses.length - publishedCourses

  const cards = [
    {
      label: t('dashboard.home.courses'),
      value: courses.length,
      sub: `${publishedCourses} ${t('dashboard.home.published')} · ${draftCourses} ${t('dashboard.home.draft')}`,
      icon: BookOpen,
      iconColor: 'text-blue-500',
      iconBg: 'bg-blue-50',
      href: '/dash/courses',
      show: true,
    },
    {
      label: t('dashboard.home.members'),
      value: totalMembers,
      sub: t('dashboard.home.total_users'),
      icon: Users,
      iconColor: 'text-indigo-500',
      iconBg: 'bg-indigo-50',
      href: '/dash/users/settings/users',
      show: true,
    },
    {
      label: t('dashboard.home.communities'),
      value: communities.length,
      sub: `${communities.filter((c: any) => c.public).length} ${t('dashboard.home.public')}`,
      icon: ChatCircle,
      iconColor: 'text-violet-500',
      iconBg: 'bg-violet-50',
      href: '/dash/communities',
      show: communitiesEnabled,
    },
    {
      label: t('dashboard.home.podcasts'),
      value: podcasts.length,
      sub: `${podcasts.reduce((sum: number, p: any) => sum + (p.episode_count || 0), 0)} ${t('dashboard.home.episodes')}`,
      icon: Microphone,
      iconColor: 'text-amber-500',
      iconBg: 'bg-amber-50',
      href: '/dash/podcasts',
      show: podcastsEnabled,
    },
    {
      label: t('dashboard.home.boards'),
      value: boards.length,
      sub: `${boards.reduce((sum: number, b: any) => sum + (b.member_count || 0), 0)} ${t('dashboard.home.participants')}`,
      icon: Chalkboard,
      iconColor: 'text-rose-500',
      iconBg: 'bg-rose-50',
      href: '/dash/boards',
      show: boardsEnabled,
    },
  ]

  const visibleCards = cards.filter((c) => c.show)

  return (
    <div
      className={`grid gap-4 ${
        visibleCards.length <= 4
          ? 'grid-cols-2 sm:grid-cols-4'
          : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-6'
      }`}
    >
      {visibleCards.map((card) => (
        <Link
          key={card.label}
          href={card.href}
          className="bg-white rounded-xl nice-shadow px-5 py-4 hover:bg-gray-50 transition-colors group"
        >
          <div className="flex items-center gap-2 mb-2">
            <div className={`p-1.5 rounded-lg ${card.iconBg}`}>
              <card.icon
                size={14}
                weight="duotone"
                className={card.iconColor}
              />
            </div>
            <span className="text-xs font-medium text-gray-400">
              {card.label}
            </span>
          </div>
          <div className="text-2xl font-bold text-gray-900">{card.value}</div>
          <p className="text-[11px] text-gray-300 mt-0.5">{card.sub}</p>
        </Link>
      ))}
    </div>
  )
}
