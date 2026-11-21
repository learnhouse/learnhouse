'use client'
// Profile: courses this person improved (accepted suggestions), only the
// ones the viewer can open. Renders nothing for people with no credit.
import React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { HandHeart } from '@phosphor-icons/react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { getUriWithOrg } from '@services/config/config'
import { getUserContributions } from '@services/courses/contributions'

export default function ProfileContributions({ userUuid, orgslug }: { userUuid: string; orgslug: string }) {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const org = useOrg() as any
  const token: string | undefined = session?.data?.tokens?.access_token
  const { data } = useQuery({
    queryKey: ['contributions', 'profile', userUuid, org?.id, !!token],
    queryFn: () => getUserContributions(userUuid, org.id, token),
    enabled: !!userUuid && !!org?.id && session?.status !== 'loading',
    staleTime: 5 * 60_000,
    retry: false,
  })
  if (!data?.items?.length) return null
  return (
    <section className="mt-6 rounded-2xl bg-white p-5 nice-shadow" aria-labelledby="profile-contributions">
      <h2 id="profile-contributions" className="flex items-center gap-2 text-base font-semibold text-neutral-900">
        <HandHeart size={18} className="text-emerald-600" />
        {t('contributions.profile.title')}
      </h2>
      <p className="mt-0.5 text-sm text-neutral-500">{t('contributions.profile.total', { count: data.total_accepted })}</p>
      <ul className="mt-4 divide-y divide-neutral-100">
        {data.items.map((c) => (
          <li key={c.course_uuid} className="flex items-center justify-between gap-3 py-2.5">
            <Link
              href={getUriWithOrg(orgslug, `/course/${c.course_uuid.replace(/^course_/, '')}`)}
              className="min-w-0 truncate text-sm font-medium text-neutral-800 hover:underline"
            >
              {c.course_name}
            </Link>
            <span className="shrink-0 text-xs tabular-nums text-neutral-500">{t('contributions.course.edits', { count: c.accepted_count })}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
