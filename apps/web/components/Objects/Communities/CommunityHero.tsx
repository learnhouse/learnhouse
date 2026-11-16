'use client'
import React from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowRight,
  BookOpen,
  CalendarBlank,
  ChatCenteredText,
  Garage,
  GearSix,
  Globe,
  LinkSimple,
  Lock,
  PencilSimpleLine,
  Sparkle,
  Users,
} from '@phosphor-icons/react'
import ThumbnailImage from '@components/Objects/Thumbnails/ThumbnailImage'
import { Breadcrumbs } from '@components/Objects/Breadcrumbs/Breadcrumbs'
import { Button, Chip, buttonClass, formatRelative } from '@components/Dashboard/Shared/DashKit/DashKit'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useCommunityRights } from '@components/Hooks/useCommunityRights'
import { getUriWithOrg } from '@services/config/config'
import { getCourseById } from '@services/courses/courses'
import type { Community, CommunitySummary } from '@services/communities/communities'
import { getCommunityThumbnailMediaDirectory, getCourseThumbnailMediaDirectory } from '@services/media/media'
import { queryKeys } from '@/lib/query/keys'
import { communityHref, communityId, shareLink } from './communityUi'
import { coursePath } from '@/lib/seo/paths'

// Linked course, fetched only when the community has one.
export function useLinkedCourse(community: Community) {
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token
  return useQuery({
    queryKey: queryKeys.community.byCourse(String(community.course_id ?? '')),
    queryFn: () => getCourseById(String(community.course_id), null, accessToken),
    enabled: !!community.course_id && session?.status !== 'loading',
    staleTime: 60_000,
  })
}

/**
 * Top of a community page: cover, name, description, the numbers that say
 * how alive it is, and the one main action (start a discussion).
 */
export function CommunityHero({
  community,
  summary,
  orgslug,
  onCreateDiscussion,
}: {
  community: Community
  summary?: CommunitySummary | null
  orgslug: string
  /** Undefined when the visitor cannot post (signed out, paywalled…). */
  onCreateDiscussion?: () => void
}) {
  const { t, i18n } = useTranslation()
  const org = useOrg() as any
  const { canManageCommunity, canCreateDiscussion } = useCommunityRights(community.community_uuid)
  const cover =
    community.thumbnail_image && org?.org_uuid
      ? getCommunityThumbnailMediaDirectory(org.org_uuid, community.community_uuid, community.thumbnail_image)
      : null
  const lastActive = summary?.last_activity_date ? formatRelative(summary.last_activity_date, i18n.language) : null

  return (
    <section className="flex flex-col gap-4">
      <Breadcrumbs
        items={[
          { label: t('communities.title'), href: getUriWithOrg(orgslug, '/communities'), icon: <Garage size={14} /> },
          { label: community.name, href: communityHref(orgslug, community.community_uuid) },
        ]}
      />
      <div className="bg-white rounded-2xl nice-shadow overflow-hidden">
        <div className="flex flex-col md:flex-row">
          <div className="md:w-[38%] lg:w-[32%] shrink-0 aspect-video md:aspect-auto md:min-h-[200px] bg-neutral-100 relative">
            <ThumbnailImage src={cover} alt="" loading="eager" className="absolute inset-0 w-full h-full object-cover" />
          </div>
          <div className="flex-1 min-w-0 p-5 sm:p-6 flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-1.5">
              {community.public ? (
                <Chip tone="sky" icon={<Globe size={12} />}>{t('communities.public')}</Chip>
              ) : (
                <Chip tone="violet" icon={<Lock size={12} />}>{t('communities.private')}</Chip>
              )}
              {!!summary?.new_discussions_week && (
                <Chip tone="amber" icon={<Sparkle size={12} weight="fill" />}>
                  {t('communities.learner.new_this_week', { count: summary.new_discussions_week })}
                </Chip>
              )}
            </div>
            <div className="min-w-0">
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-neutral-900 break-words" dir="auto">
                {community.name}
              </h1>
              {community.description && (
                <p className="mt-2 text-sm sm:text-[15px] text-neutral-600 leading-relaxed max-w-3xl" dir="auto">
                  {community.description}
                </p>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-neutral-600">
              {summary && (
                <>
                  <span className="inline-flex items-center gap-1.5 tabular-nums" title={t('communities.learner.participants_hint')}>
                    <Users size={16} className="text-neutral-400" />
                    {t('communities.learner.participants', { count: summary.participant_count })}
                  </span>
                  <span className="inline-flex items-center gap-1.5 tabular-nums">
                    <ChatCenteredText size={16} className="text-neutral-400" />
                    {t('communities.learner.threads', { count: summary.discussion_count })}
                  </span>
                </>
              )}
              {lastActive && (
                <span className="inline-flex items-center gap-1.5">
                  <CalendarBlank size={16} className="text-neutral-400" />
                  {t('communities.learner.active', { time: lastActive })}
                </span>
              )}
            </div>
            <div className="mt-auto flex flex-wrap items-center gap-2">
              {canCreateDiscussion && onCreateDiscussion && (
                <Button variant="primary" size="lg" icon={<PencilSimpleLine size={15} />} onClick={onCreateDiscussion}>
                  {t('communities.new_discussion')}
                </Button>
              )}
              <Button
                size="lg"
                icon={<LinkSimple size={15} />}
                onClick={() =>
                  shareLink(
                    communityHref(orgslug, community.community_uuid),
                    community.name,
                    t('communities.learner.link_copied'),
                    t('communities.learner.link_failed')
                  )
                }
              >
                {t('communities.learner.share')}
              </Button>
              {canManageCommunity && (
                <Link
                  href={getUriWithOrg(orgslug, `/dash/communities/${communityId(community.community_uuid)}/discussions`)}
                  className={buttonClass('ghost', 'lg')}
                >
                  <GearSix size={15} />
                  {t('communities.manage')}
                </Link>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

/** Side column: the linked course and the house rules. */
export function CommunityAbout({ community, orgslug }: { community: Community; orgslug: string }) {
  const { t, i18n } = useTranslation()
  const org = useOrg() as any
  const { data: course } = useLinkedCourse(community)
  const courseThumb =
    course?.thumbnail_image && org?.org_uuid
      ? getCourseThumbnailMediaDirectory(org.org_uuid, course.course_uuid, course.thumbnail_image)
      : null
  const createdAt = community.creation_date ? new Date(community.creation_date) : null
  const created =
    createdAt && !isNaN(createdAt.getTime())
      ? new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(createdAt)
      : null

  return (
    <div className="flex flex-col gap-4">
      {course && (
        <Link
          href={getUriWithOrg(orgslug, coursePath(course))}
          className="group bg-white rounded-2xl nice-shadow overflow-hidden flex flex-col transition-shadow hover:shadow-lg"
        >
          <ThumbnailImage src={courseThumb} alt="" className="w-full aspect-[16/7] object-cover" />
          <div className="p-4 flex items-start gap-3">
            <span className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
              <BookOpen size={16} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">{t('communities.linked_course')}</p>
              <p className="text-sm font-semibold text-neutral-900 line-clamp-2" dir="auto">{course.name}</p>
            </div>
            <ArrowRight size={16} className="mt-1 text-neutral-300 group-hover:text-neutral-600 transition-colors rtl:rotate-180" />
          </div>
        </Link>
      )}
      <div className="bg-white rounded-2xl nice-shadow p-4 flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-neutral-900">{t('communities.community_guidelines')}</h2>
        <p className="text-sm text-neutral-500 leading-relaxed">{t('communities.community_guidelines_text')}</p>
        {created && (
          <p className="pt-2 mt-1 border-t border-neutral-100 text-xs text-neutral-400">
            {t('communities.learner.created_on', { date: created })}
          </p>
        )}
      </div>
    </div>
  )
}
