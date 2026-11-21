'use client'
// Course page side column: "Improved by" the community. Separate from the
// authors (who build the course); renders nothing until someone is credited.
import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { HandHeart } from '@phosphor-icons/react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { listCourseContributors } from '@services/courses/contributions'
import { ContributorAvatars, contributorName } from './contributorUi'

export default function CourseContributorsStrip({ courseUuid }: { courseUuid: string }) {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const token: string | undefined = session?.data?.tokens?.access_token
  const { data } = useQuery({
    queryKey: ['contributions', 'contributors', courseUuid, 'public', !!token],
    queryFn: () => listCourseContributors(courseUuid, token),
    enabled: !!courseUuid && session?.status !== 'loading',
    staleTime: 5 * 60_000,
    retry: false,
  })
  const people = data?.items ?? []
  if (!people.length) return null
  const names = people.slice(0, 3).map((p) => contributorName(p.user))
  const edits = people.reduce((sum, p) => sum + p.accepted_count, 0)
  return (
    <div className="rounded-2xl bg-white p-4 nice-shadow">
      <p className="mb-3 flex items-center gap-1.5 text-xs font-semibold text-neutral-400">
        <HandHeart size={14} />
        {t('contributions.course.title')}
      </p>
      <div className="flex items-center gap-3">
        <ContributorAvatars users={people.map((p) => p.user)} max={5} size={28} />
        <p className="min-w-0 text-sm text-neutral-700">
          <span className="line-clamp-2">
            {people.length > 3
              ? t('contributions.course.names_more', { names: names.join(', '), count: people.length - 3 })
              : names.join(', ')}
          </span>
          <span className="block text-xs text-neutral-500">{t('contributions.course.edits', { count: edits })}</span>
        </p>
      </div>
    </div>
  )
}
