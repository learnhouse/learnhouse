'use client'
import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { listInvitations, type InvitationList } from '@services/organizations/invitations'
import InviteDialog from './InviteDialog'
import InvitationsPanel from './InvitationsPanel'
import { useInvitationAuth } from './invitationsKit'

// What the Users tab borrows from the Invite tab: the pending count for its
// "Invited" tile, the invitations list for its "Invited" view, and the invite
// dialog behind its "Invite" button. All of it is the Invite tab's own UI.

export const invitedUsersKey = (orgId: number) => ['org', orgId, 'invitedUsers'] as const

export type InvitedUser = { email: string; pending?: boolean; email_sent?: boolean }

/** Pending invitations (database and older ones), for counts. */
export function useInvitedUsers() {
  const { orgId, token } = useInvitationAuth()
  return useQuery({
    queryKey: invitedUsersKey(orgId),
    queryFn: async () => {
      const res = await listInvitations(orgId, token, { status: 'pending', limit: 200 })
      const data = (res.success ? res.data : null) as InvitationList | null
      if (!data) return [] as InvitedUser[]
      return [
        ...data.items.map((i) => ({ email: i.email, pending: true, email_sent: i.email_sent })),
        ...data.legacy.map((i) => ({ email: i.email, pending: true, email_sent: i.email_sent })),
      ] as InvitedUser[]
    },
    enabled: !!orgId && !!token,
    staleTime: 60_000,
  })
}

export function InviteMembersModal({ open, onOpenChange }: { open: boolean; onOpenChange: (_open: boolean) => void }) {
  return <InviteDialog open={open} onOpenChange={onOpenChange} />
}

export function InvitationsList({ search = '', onInvite }: { search?: string; onInvite?: () => void }) {
  return <InvitationsPanel search={search} onInvite={onInvite} />
}
