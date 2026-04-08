'use client'
import React from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import { useTranslation } from 'react-i18next'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getAPIUrl } from '@services/config/config'
import { swrFetcher } from '@services/utils/ts/requests'
import { Users, ShieldCheck, Clock, EnvelopeSimple } from '@phosphor-icons/react'

export default function RecentMembers() {
  const { t } = useTranslation()
  const org = useOrg() as any
  const session = useLHSession() as any
  const token = session?.data?.tokens?.access_token
  const orgId = org?.id

  const { data: membersData, isLoading } = useSWR(
    token && orgId
      ? `${getAPIUrl()}orgs/${orgId}/users?page=1&limit=8&sort_order=desc`
      : null,
    (url) => swrFetcher(url, token),
    { revalidateOnFocus: false }
  )

  const members: any[] = membersData?.items ?? []
  const totalMembers = membersData?.total ?? 0

  return (
    <div className="bg-white rounded-xl nice-shadow overflow-hidden">
      <div className="flex items-center justify-between px-5 pt-4 pb-3">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold text-gray-700">
            {t('dashboard.home.recent_members')}
          </h3>
          {totalMembers > 0 && (
            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-600">
              {totalMembers} {t('dashboard.home.total')}
            </span>
          )}
        </div>
        <Link
          href="/dash/users/settings/users"
          className="text-[11px] font-medium text-gray-400 hover:text-gray-600 transition-colors"
        >
          {t('dashboard.home.view_all')} &rarr;
        </Link>
      </div>

      {isLoading ? (
        <div className="px-5 pb-4 space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-center gap-3 animate-pulse">
              <div className="w-8 h-8 bg-gray-100 rounded-full shrink-0" />
              <div className="flex-1">
                <div className="h-3 bg-gray-100 rounded w-32 mb-1.5" />
                <div className="h-2 bg-gray-50 rounded w-44" />
              </div>
            </div>
          ))}
        </div>
      ) : members.length === 0 ? (
        <div className="px-5 pb-5">
          <div className="flex flex-col items-center justify-center py-6 text-center">
            <div className="p-3 rounded-full bg-gray-100 mb-3">
              <Users size={20} weight="duotone" className="text-gray-400" />
            </div>
            <p className="text-xs text-gray-400">{t('dashboard.home.no_members_yet')}</p>
          </div>
        </div>
      ) : (
        <div className="divide-y divide-gray-50">
          {members.map((member: any) => {
            const user = member.user
            const role = member.role
            const joinedAt = member.joined_at
              ? new Date(member.joined_at).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })
              : null
            const displayName =
              user.first_name || user.last_name
                ? `${user.first_name || ''} ${user.last_name || ''}`.trim()
                : user.username
            const initials = `${(user.first_name?.[0] || user.username?.[0] || '').toUpperCase()}${(user.last_name?.[0] || '').toUpperCase()}`

            return (
              <div
                key={user.user_uuid}
                className="flex items-center gap-3 px-5 py-3"
              >
                {/* Avatar */}
                <div className="w-8 h-8 rounded-full bg-indigo-100 shrink-0 flex items-center justify-center">
                  <span className="text-[11px] font-semibold text-indigo-600">
                    {initials}
                  </span>
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-gray-700 truncate">
                      {displayName}
                    </p>
                    {!user.email_verified && (
                      <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-amber-50 text-amber-600">
                        {t('dashboard.home.unverified')}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-0.5">
                    <span className="flex items-center gap-1 text-[10px] text-gray-400 truncate">
                      <EnvelopeSimple size={10} />
                      {user.email}
                    </span>
                    {joinedAt && (
                      <span className="flex items-center gap-1 text-[10px] text-gray-400 shrink-0">
                        <Clock size={10} />
                        {joinedAt}
                      </span>
                    )}
                  </div>
                </div>

                {/* Role badge */}
                {role && (
                  <span className="flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 shrink-0">
                    <ShieldCheck size={10} />
                    {role.name}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
