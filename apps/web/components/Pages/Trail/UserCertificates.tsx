'use client'

import React, { useState } from 'react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { getUriWithOrg } from '@services/config/config'
import Link from 'next/link'
import { ArrowRight, Medal, Trophy } from '@phosphor-icons/react'
import { buttonClass, SegmentedControl } from '@components/Dashboard/Shared/DashKit/DashKit'
// Play badges (EE): the OSS stub returns none and renders nothing.
import { PlayBadgeGrids, usePlayBadgesToEarn, type TrailBadge } from '@ee/components/Plays/Trail/PlayTrail'
import { TrailEmpty, TrailSection } from './trailUi'
import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { getAllUserCertificates } from '@services/courses/certifications'
import { useContentLanguage } from '@/hooks/useContentLanguage'
import { asArray } from '@services/utils/ts/requests'
import { useTranslation } from 'react-i18next'
import CertificateCard from '@components/Objects/Certificates/CertificateCard'
import { useMyPathCertificates } from '@/hooks/queries/usePaths'
import { formatDate } from '@/lib/format'

interface UserCertificatesProps {
  orgslug: string
  /** Play badges, when the org has Plays and the API answered. */
  badges?: TrailBadge[] | null
}

type Filter = 'all' | 'certificates' | 'badges'

type Entry = {
  key: string
  href: string
  createdAt: string
  subtitle: string
  tag?: string
  certificate: React.ComponentProps<typeof CertificateCard>['certificate']
}

/** Every certificate the learner earned in this org, course and path
 * certificates together, newest first. */
const UserCertificates: React.FC<UserCertificatesProps> = ({ orgslug, badges }) => {
  const { t, i18n } = useTranslation()
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const org = useOrg() as any
  const pathsEnabled = org?.config?.config?.resolved_features?.paths?.enabled === true
  const user = session?.data?.user
  const learnerName = [user?.first_name, user?.last_name].filter(Boolean).join(' ') || user?.username

  const contentLang = useContentLanguage()
  const { data: certificates, error, isLoading } = useQuery({
    // Course names in the learner's content language (same key as the other list).
    queryKey: [...queryKeys.certifications.detail(`user_all_${org?.id}`), contentLang.lang],
    queryFn: () => getAllUserCertificates(org.id, access_token, contentLang.lang || undefined),
    select: (res: any) => asArray(res),
    enabled: !!access_token && !!org?.id && contentLang.ready,
    staleTime: 60_000,
  })
  const { data: pathCertificates } = useMyPathCertificates(pathsEnabled)
  const [filter, setFilter] = useState<Filter>('all')

  const entries: Entry[] = [
    ...((certificates ?? []) as any[]).map((c) => {
      const config = c.certification?.config || {}
      return {
        key: c.certificate_user.user_certification_uuid,
        href: getUriWithOrg(orgslug, `/certificates/${c.certificate_user.user_certification_uuid}/verify`),
        createdAt: c.certificate_user.created_at,
        subtitle: c.course?.name,
        tag: t('certificate.kind_course'),
        certificate: {
          certificationName: config.certification_name || c.course?.name,
          certificationDescription: config.certification_description,
          certificationType: config.certification_type,
          certificatePattern: config.certificate_pattern,
          certificateInstructor: config.certificate_instructor,
          certificateId: c.certificate_user.user_certification_uuid,
          awardedDate: formatDate(c.certificate_user.created_at, i18n.language, { dateStyle: 'long' }),
          learnerName,
        },
      }
    }),
    ...(pathCertificates ?? [])
      .filter((c) => c.org.org_uuid === org?.org_uuid)
      .map((c) => {
        const config = c.path.certificate_config || {}
        return {
          key: c.certificate.certificate_uuid,
          href: getUriWithOrg(orgslug, `/paths/certificate/${c.certificate.certificate_uuid}`),
          createdAt: c.certificate.created_at,
          subtitle: c.path.name,
          tag: t('paths.path'),
          certificate: {
            certificationName: config.certification_name || c.path.name,
            certificationDescription: config.certification_description || c.path.description,
            certificationType: config.certification_type || 'specialization',
            certificatePattern: config.certificate_pattern,
            certificateInstructor: config.certificate_instructor,
            certificateId: c.certificate.certificate_uuid,
            awardedDate: formatDate(c.certificate.created_at, i18n.language, { dateStyle: 'long' }),
            learnerName,
          },
        }
      }),
  ].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))

  const badgeList = (Array.isArray(badges) ? [...badges] : []).sort((a, b) => (a.awarded_at < b.awarded_at ? 1 : -1))
  // The org's plays, only to list the badges still up for grabs.
  const toEarn = usePlayBadgesToEarn({ orgId: org?.id, accessToken: access_token, earned: badges })
  const total = entries.length + badgeList.length
  const showFilter = entries.length > 0 && (badgeList.length > 0 || toEarn.length > 0)
  const showCertificates = filter !== 'badges' && entries.length > 0
  const showBadges = filter !== 'certificates'

  const section = (body: React.ReactNode) => (
    <TrailSection
      id="trail-achievements"
      icon={<Trophy size={18} />}
      title={t('trail.achievements.title', 'Achievements')}
      description={t('trail.achievements.description', 'Certificates from courses and paths, and badges from Plays.')}
      count={total}
      actions={
        showFilter ? (
          <SegmentedControl<Filter>
            value={filter}
            onChange={setFilter}
            ariaLabel={t('trail.achievements.title', 'Achievements')}
            options={[
              { key: 'all', label: t('common.all', 'All') },
              { key: 'certificates', label: t('trail.achievements.certificates', 'Certificates'), count: entries.length },
              { key: 'badges', label: t('trail.achievements.badges', 'Badges'), count: badgeList.length },
            ]}
          />
        ) : undefined
      }
    >
      {body}
    </TrailSection>
  )

  if (isLoading) {
    return section(
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="bg-white rounded-2xl nice-shadow overflow-hidden animate-pulse">
            <div className="aspect-[1123/794] bg-neutral-100" />
            <div className="p-3 space-y-2">
              <div className="h-4 bg-neutral-100 rounded w-3/4" />
              <div className="h-3 bg-neutral-100 rounded w-1/2" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (error && badgeList.length === 0) {
    return section(<TrailEmpty icon={<Medal size={22} />} title={t('certificate.failed_load_certificates')} />)
  }

  if (total === 0 && toEarn.length === 0) {
    return section(
      <TrailEmpty
        icon={<Medal size={22} />}
        title={t('certificate.no_certificates_earned')}
        description={t('certificate.complete_courses_to_earn')}
        action={
          <Link href={getUriWithOrg(orgslug, '/courses')} className={buttonClass('secondary', 'md', 'rounded-full! px-4')}>
            {t('trail.start.button', 'Browse courses')}
            <ArrowRight size={13} weight="bold" className="rtl:rotate-180" />
          </Link>
        }
      />
    )
  }

  return section(
    <div className="space-y-6">
      {showCertificates && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {entries.map((entry) => (
            <CertificateCard
              key={entry.key}
              href={entry.href}
              certificate={entry.certificate}
              subtitle={entry.subtitle}
              tag={entry.tag}
              date={entry.certificate.awardedDate as string}
            />
          ))}
        </div>
      )}
      {showBadges && <PlayBadgeGrids orgslug={orgslug} badges={badgeList} toEarn={toEarn} />}
    </div>
  )
}

export default UserCertificates
