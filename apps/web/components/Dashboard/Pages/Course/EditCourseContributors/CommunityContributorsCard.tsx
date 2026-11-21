'use client'
// On the Authors tab: community contributors are not authors. They are
// credited elsewhere (course page, next to what they wrote) and managed in
// the Contributions tab.
import React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ArrowRight, HandHeart } from '@phosphor-icons/react'
import { SectionCard, buttonClass } from '@/design'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getUriWithOrg } from '@services/config/config'
import { listCourseContributors } from '@services/courses/contributions'
import { ContributorAvatars } from '@components/Objects/Contributions/contributorUi'

export default function CommunityContributorsCard({ orgslug, courseUuid }: { orgslug: string; courseUuid: string }) {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const token = session?.data?.tokens?.access_token
  const { data } = useQuery({
    queryKey: ['contributions', 'contributors', courseUuid, 'public'],
    queryFn: () => listCourseContributors(courseUuid, token),
    enabled: !!token && !!courseUuid,
    staleTime: 60_000,
  })
  const people = data?.items ?? []
  const href = getUriWithOrg(orgslug, `/dash/courses/course/${courseUuid.replace(/^course_/, '')}/contributions`)
  return (
    <SectionCard
      icon={<HandHeart size={18} />}
      title={t('dashboard.courses.authors.community.title')}
      description={t('dashboard.courses.authors.community.description')}
      actions={
        <Link href={href} className={buttonClass('secondary', 'sm')}>
          {t('dashboard.courses.authors.community.open')}
          <ArrowRight size={13} className="rtl:rotate-180" />
        </Link>
      }
    >
      {people.length > 0 ? (
        <div className="flex items-center gap-3">
          <ContributorAvatars users={people.map((p) => p.user)} max={6} size={28} />
          <span className="text-sm text-neutral-600">{t('dashboard.courses.authors.community.count', { count: people.length })}</span>
        </div>
      ) : (
        <p className="text-sm text-neutral-500">{t('dashboard.courses.authors.community.none')}</p>
      )}
    </SectionCard>
  )
}
