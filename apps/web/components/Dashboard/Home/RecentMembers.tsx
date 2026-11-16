'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { Users, ShieldCheck, Clock } from '@phosphor-icons/react'
import { formatDate } from '@/lib/format'
import { Chip, EmptyState, SectionCard, formatRelative } from '@components/Dashboard/Shared/DashKit/DashKit'
import { useHomeMembers } from './homeData'
import { CardLink, ListSkeleton } from './homeKit'

export default function RecentMembers() {
  const { t } = useTranslation()
  const { data: membersData, isLoading } = useHomeMembers()

  const members: any[] = membersData?.items ?? []
  const totalMembers = membersData?.total ?? 0

  return (
    <SectionCard
      title={
        <span className="inline-flex items-center gap-2">
          {t('dashboard.home.recent_members')}
          {totalMembers > 0 && (
            <Chip className="tabular-nums">
              {totalMembers} {t('dashboard.home.total')}
            </Chip>
          )}
        </span>
      }
      actions={<CardLink href="/dash/users/settings/users">{t('dashboard.home.view_all')}</CardLink>}
      className="overflow-hidden"
      bodyClassName="pt-3 pb-1"
    >
      {isLoading ? (
        <ListSkeleton rows={4} media="avatar" />
      ) : members.length === 0 ? (
        <EmptyState icon={<Users size={22} />} title={t('dashboard.home.no_members_yet')} />
      ) : (
        <ul className="divide-y divide-neutral-100">
          {members.map((member: any) => (
            <MemberRow key={member.user?.user_uuid} member={member} />
          ))}
        </ul>
      )}
    </SectionCard>
  )
}

function MemberRow({ member }: { member: any }) {
  const { t, i18n } = useTranslation()
  const user = member.user || {}
  const role = member.role
  const displayName =
    user.first_name || user.last_name ? `${user.first_name || ''} ${user.last_name || ''}`.trim() : user.username
  const initials = `${(user.first_name?.[0] || user.username?.[0] || '').toUpperCase()}${(user.last_name?.[0] || '').toUpperCase()}`
  const joined = formatRelative(member.joined_at, i18n.language)
  const joinedFull = member.joined_at ? formatDate(member.joined_at, i18n.language) : undefined

  return (
    <li className="flex items-center gap-3 px-5 py-3">
      <div className="w-9 h-9 rounded-full bg-neutral-100 text-neutral-600 shrink-0 flex items-center justify-center text-xs font-semibold">
        {initials}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 min-w-0">
          <p className="text-sm font-semibold text-neutral-900 truncate" dir="auto">
            {displayName}
          </p>
          {!user.email_verified && (
            <Chip tone="amber" className="shrink-0">
              {t('dashboard.home.unverified')}
            </Chip>
          )}
        </div>
        <p className="text-xs text-neutral-500 truncate">{user.email}</p>
      </div>
      {joined && (
        <span className="hidden md:inline-flex items-center gap-1 text-xs text-neutral-500 shrink-0" title={joinedFull}>
          <Clock size={12} className="text-neutral-400" />
          {joined}
        </span>
      )}
      {role && (
        <Chip className="shrink-0" icon={<ShieldCheck size={12} />}>
          {role.name}
        </Chip>
      )}
    </li>
  )
}
