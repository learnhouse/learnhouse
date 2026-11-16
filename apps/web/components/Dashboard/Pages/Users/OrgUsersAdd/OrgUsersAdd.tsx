'use client'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { EnvelopeSimple, PaperPlaneTilt } from '@phosphor-icons/react'
import { SearchInput, SectionCard } from '@components/Dashboard/Shared/DashKit/DashKit'
import { InviteForm, InvitationsList, useInvitedUsers } from './invites'

// The Invite tab: send invitations by email, then follow them below. The
// same list shows under the Users tab's "Invited" filter.
function OrgUsersAdd() {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const { data: invited } = useInvitedUsers()
  const pending = (invited ?? []).filter((u) => u.pending).length

  return (
    <div className="flex flex-col gap-5">
      <SectionCard
        icon={<PaperPlaneTilt size={18} />}
        title={t('dashboard.users.invite_members.title')}
        description={t('dashboard.users.invite_members.subtitle')}
      >
        <InviteForm />
      </SectionCard>

      <SectionCard
        icon={<EnvelopeSimple size={18} />}
        title={t('dashboard.users.invite_members.invited_users.title')}
        description={
          invited?.length
            ? t('dashboard.users.dash.invites.list_summary', { count: invited.length, pending })
            : t('dashboard.users.invite_members.invited_users.subtitle')
        }
        actions={
          (invited?.length ?? 0) > 0 ? (
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder={t('dashboard.users.invite_members.invited_users.search_placeholder')}
              className="w-56 sm:w-64"
            />
          ) : undefined
        }
        bodyClassName="pt-4"
      >
        <div className="border-t border-neutral-100">
          <InvitationsList search={search} />
        </div>
      </SectionCard>
    </div>
  )
}

export default OrgUsersAdd
