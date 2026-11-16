'use client'
import React, { useState } from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { CheckCircle, ClockCountdown, EnvelopeSimple, Prohibit, Ticket, UserPlus } from '@phosphor-icons/react'
import { Button, SearchInput, SectionCard, StatCard, buttonClass } from '@components/Dashboard/Shared/DashKit/DashKit'
import { getUriWithOrg } from '@services/config/config'
import type { InvitationStatus } from '@services/organizations/invitations'
import InviteDialog from './InviteDialog'
import InvitationsPanel, { useInvitationList } from './InvitationsPanel'
import { CapacityMeter, useInvitationAuth, useInvitationOptions } from './invitationsKit'

// The Invite tab: invite people with a role, groups and courses, then follow
// every invitation (resend, copy the link, change it while pending, revoke).
function OrgUsersAdd() {
  const { t } = useTranslation()
  const { org } = useInvitationAuth()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<'' | InvitationStatus>('')
  const [inviteOpen, setInviteOpen] = useState(false)
  // Counts for the tiles come from the same list query, unfiltered.
  const { data } = useInvitationList({ status: '', q: '', page: 1 })
  const { data: options } = useInvitationOptions()
  const counts = data?.counts
  const cap = options?.capacity
  const pick = (s: InvitationStatus) => setStatus(status === s ? '' : s)

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          icon={<ClockCountdown size={18} />}
          iconClass="bg-amber-50 text-amber-600"
          label={t('dashboard.users.invitations.status.pending')}
          value={counts ? counts.pending + (data?.legacy.length ?? 0) : null}
          active={status === 'pending'}
          onClick={() => pick('pending')}
        />
        <StatCard
          icon={<CheckCircle size={18} />}
          iconClass="bg-emerald-50 text-emerald-600"
          label={t('dashboard.users.invitations.status.accepted')}
          value={counts ? counts.accepted : null}
          active={status === 'accepted'}
          onClick={() => pick('accepted')}
        />
        <StatCard
          icon={<EnvelopeSimple size={18} />}
          iconClass="bg-neutral-100 text-neutral-500"
          label={t('dashboard.users.invitations.status.expired')}
          value={counts ? counts.expired : null}
          active={status === 'expired'}
          onClick={() => pick('expired')}
        />
        <StatCard
          icon={<Prohibit size={18} />}
          iconClass="bg-rose-50 text-rose-600"
          label={t('dashboard.users.invitations.status.revoked')}
          value={counts ? counts.revoked + counts.declined : null}
          active={status === 'revoked'}
          onClick={() => pick('revoked')}
        />
      </div>

      {cap && (cap.members.limit !== null || cap.admin_seats.limit !== null) && (
        <SectionCard bodyClassName="p-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <CapacityMeter label={t('dashboard.users.invitations.capacity.members')} {...cap.members} />
            <CapacityMeter label={t('dashboard.users.invitations.capacity.admin_seats')} {...cap.admin_seats} />
          </div>
        </SectionCard>
      )}

      <SectionCard
        icon={<EnvelopeSimple size={18} />}
        title={t('dashboard.users.invitations.list.title')}
        description={t('dashboard.users.invitations.list.subtitle')}
        actions={
          <>
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder={t('dashboard.users.invite_members.invited_users.search_placeholder')}
              className="hidden sm:flex w-56 lg:w-64"
            />
            <Button variant="primary" icon={<UserPlus size={14} />} onClick={() => setInviteOpen(true)}>
              {t('dashboard.users.invitations.invite_people')}
            </Button>
          </>
        }
        bodyClassName="pt-4"
      >
        <div className="sm:hidden px-4 pb-3">
          <SearchInput value={search} onChange={setSearch} placeholder={t('dashboard.users.invite_members.invited_users.search_placeholder')} />
        </div>
        <InvitationsPanel search={search} status={status} onStatusChange={setStatus} onInvite={() => setInviteOpen(true)} />
      </SectionCard>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white nice-shadow px-5 py-4">
        <div className="flex items-start gap-3 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-sky-50 text-sky-600 flex items-center justify-center shrink-0">
            <Ticket size={18} />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-neutral-900">{t('dashboard.users.invitations.codes_card.title')}</p>
            <p className="text-xs text-neutral-500 mt-0.5">{t('dashboard.users.invitations.codes_card.description')}</p>
          </div>
        </div>
        <Link href={getUriWithOrg(org?.slug, '/dash/users/settings/signups?section=invites')} className={buttonClass('secondary', 'md', 'shrink-0')}>
          {t('dashboard.users.invitations.codes_card.manage')}
        </Link>
      </div>

      <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} />
    </div>
  )
}

export default OrgUsersAdd
