'use client'
import React, { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Info, LinkSimple, Plus, UsersThree, X } from '@phosphor-icons/react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { useCommunity } from '@components/Contexts/CommunityContext'
import { getUserGroups, linkResourcesToUserGroup, unLinkResourcesToUserGroup } from '@services/usergroups/usergroups'
import { asArray, RequestBodyWithAuthHeader } from '@services/utils/ts/requests'
import { getAPIUrl, getUriWithOrg } from '@services/config/config'
import { queryKeys } from '@/lib/query/keys'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import {
  Button,
  ConfirmDialog,
  EmptyState,
  FieldLabel,
  SectionCard,
  buttonClass,
} from '@components/Dashboard/Shared/DashKit/DashKit'

const resourceGroupsKey = (communityUuid?: string, orgId?: number) => ['usergroups', 'resource', communityUuid, orgId]

// Who can see a restricted community: the user groups linked to it. Part of
// the Settings tab; linking and unlinking apply at once.
export function UserGroupsSection() {
  const { t } = useTranslation()
  const community = useCommunity()?.community
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token
  const org = useOrg() as any
  const queryClient = useQueryClient()
  const [linkOpen, setLinkOpen] = useState(false)
  const [unlinking, setUnlinking] = useState<any | null>(null)

  const key = resourceGroupsKey(community?.community_uuid, org?.id)
  const { data, isLoading } = useQuery({
    queryKey: key,
    queryFn: async () => {
      const url = `${getAPIUrl()}usergroups/resource/${community!.community_uuid}?org_id=${org.id}`
      const res = await fetch(url, RequestBodyWithAuthHeader('GET', null, null, accessToken))
      if (!res.ok) throw new Error('Failed to fetch usergroups')
      return res.json()
    },
    enabled: !!(community?.community_uuid && org?.id),
    staleTime: 60_000,
  })
  const linked: any[] = asArray<any>(data)

  if (!community) return null

  const removeLink = async (usergroup: any) => {
    try {
      const res = await unLinkResourcesToUserGroup(usergroup.id, community.community_uuid, org.id, accessToken)
      if (res.status === 200) {
        toast.success(t('dashboard.courses.communities.access.usergroups.toasts.unlink_success'))
        queryClient.invalidateQueries({ queryKey: key })
      } else {
        toast.error(
          t('dashboard.courses.communities.access.usergroups.toasts.link_error', {
            status: res.status,
            detail: res.data?.detail,
          })
        )
      }
    } catch {
      toast.error(t('dashboard.courses.communities.access.usergroups.toasts.unlink_error'))
    }
  }

  return (
    <SectionCard
      icon={<UsersThree size={18} />}
      title={t('dashboard.courses.communities.access.usergroups.title')}
      description={t('dashboard.courses.communities.access.usergroups.subtitle')}
      actions={
        <Button icon={<Plus size={14} />} onClick={() => setLinkOpen(true)}>
          {t('dashboard.courses.communities.access.usergroups.actions.link_to_usergroup')}
        </Button>
      }
      bodyClassName="px-5 pb-5 pt-4"
    >
      {isLoading ? (
        <div className="rounded-xl ring-1 ring-inset ring-neutral-100 divide-y divide-neutral-100 animate-pulse">
          {[0, 1].map((i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3">
              <div className="w-8 h-8 rounded-lg bg-neutral-100" />
              <div className="h-3.5 w-40 rounded bg-neutral-100" />
            </div>
          ))}
        </div>
      ) : linked.length === 0 ? (
        <div className="rounded-xl ring-1 ring-inset ring-neutral-100">
          <EmptyState
            icon={<UsersThree size={22} />}
            title={t('communities.dash.access.no_groups')}
            description={t('communities.dash.access.no_groups_description')}
            action={
              <Button size="sm" variant="primary" icon={<Plus size={13} />} onClick={() => setLinkOpen(true)}>
                {t('dashboard.courses.communities.access.usergroups.actions.link_to_usergroup')}
              </Button>
            }
          />
        </div>
      ) : (
        <ul className="rounded-xl ring-1 ring-inset ring-neutral-100 divide-y divide-neutral-100">
          {linked.map((usergroup: any) => (
            <li key={usergroup.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="flex items-center gap-3 min-w-0">
                <span className="w-8 h-8 rounded-lg bg-neutral-100 text-neutral-500 flex items-center justify-center shrink-0">
                  <UsersThree size={16} />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-neutral-900 truncate" dir="auto">{usergroup.name}</p>
                  {usergroup.description && (
                    <p className="text-xs text-neutral-500 truncate" dir="auto">{usergroup.description}</p>
                  )}
                </div>
              </div>
              <Button size="sm" variant="danger-ghost" icon={<X size={13} />} onClick={() => setUnlinking(usergroup)}>
                {t('dashboard.courses.communities.access.usergroups.actions.delete_link')}
              </Button>
            </li>
          ))}
        </ul>
      )}

      <LinkUserGroupDialog
        open={linkOpen}
        onOpenChange={setLinkOpen}
        linkedIds={linked.map((g) => g.id)}
        onLinked={() => queryClient.invalidateQueries({ queryKey: key })}
      />
      <ConfirmDialog
        open={!!unlinking}
        onOpenChange={(open) => !open && setUnlinking(null)}
        title={t('dashboard.courses.communities.access.usergroups.modals.unlink_title')}
        message={t('dashboard.courses.communities.access.usergroups.modals.unlink_message')}
        confirmLabel={t('dashboard.courses.communities.access.usergroups.modals.unlink_button')}
        onConfirm={() => (unlinking ? removeLink(unlinking) : undefined)}
      />
    </SectionCard>
  )
}

function LinkUserGroupDialog({
  open,
  onOpenChange,
  linkedIds,
  onLinked,
}: {
  open: boolean
  onOpenChange: (_open: boolean) => void
  linkedIds: number[]
  onLinked: () => void
}) {
  const { t } = useTranslation()
  const community = useCommunity()?.community
  const org = useOrg() as any
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token
  const [selected, setSelected] = useState<string>('')
  const [submitting, setSubmitting] = useState(false)

  const { data: usergroups = [], isLoading } = useQuery({
    queryKey: queryKeys.usergroups.list(org?.id),
    queryFn: () => getUserGroups(org.id, accessToken),
    select: (res: any) => asArray<any>(res),
    enabled: open && !!(org?.id && accessToken),
    staleTime: 60_000,
  })
  // Groups that already grant access are left out of the picker.
  const linkedKey = linkedIds.join(',')
  const available = useMemo(
    () => usergroups.filter((g: any) => !linkedKey.split(',').includes(String(g.id))),
    [usergroups, linkedKey]
  )

  // Preselect the first available group each time the list changes.
  useEffect(() => {
    if (!available.some((g: any) => String(g.id) === selected)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelected(available[0] ? String(available[0].id) : '')
    }
  }, [available, selected])

  const handleLink = async () => {
    if (!community || !selected) return
    setSubmitting(true)
    try {
      const res = await linkResourcesToUserGroup(selected, community.community_uuid, org.id, accessToken)
      if (res.status === 200) {
        toast.success(t('dashboard.courses.communities.access.usergroups.toasts.link_success'))
        onLinked()
        onOpenChange(false)
      } else {
        toast.error(
          t('dashboard.courses.communities.access.usergroups.toasts.link_error', {
            status: res.status,
            detail: res.data?.detail,
          })
        )
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      isDialogOpen={open}
      onOpenChange={onOpenChange}
      icon={<LinkSimple size={16} />}
      size="sm"
      preventClose={submitting}
      dialogTitle={t('dashboard.courses.communities.access.usergroups.modals.link_title')}
      dialogDescription={t('dashboard.courses.communities.access.usergroups.modals.link_description')}
      dialogContent={
        <div className="flex flex-col gap-4">
          {isLoading ? (
            <div className="h-9 rounded-lg bg-neutral-100 animate-pulse" />
          ) : available.length === 0 ? (
            <div className="rounded-xl bg-neutral-50 ring-1 ring-inset ring-neutral-100 px-4 py-4 text-sm text-neutral-600">
              <p className="font-semibold text-neutral-800">
                {usergroups.length === 0
                  ? t('dashboard.courses.communities.access.usergroups.modals.no_usergroups')
                  : t('communities.dash.access.all_linked')}
              </p>
              <Link
                href={getUriWithOrg(org?.slug, '/dash/users/settings/usergroups')}
                target="_blank"
                className={buttonClass('secondary', 'sm', 'mt-3')}
              >
                <Plus size={13} />
                {t('dashboard.courses.communities.access.usergroups.modals.create_usergroup')}
              </Link>
            </div>
          ) : (
            <div>
              <FieldLabel>{t('dashboard.courses.communities.access.usergroups.modals.usergroup_name')}</FieldLabel>
              <select
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
                aria-label={t('dashboard.courses.communities.access.usergroups.modals.usergroup_name')}
                className="w-full h-9 px-3 text-sm bg-white rounded-lg ring-1 ring-inset ring-neutral-200 focus:outline-none focus:ring-2 focus:ring-neutral-900/15"
              >
                {available.map((group: any) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="flex items-start gap-2 rounded-xl bg-amber-50 ring-1 ring-inset ring-amber-200/70 px-3.5 py-3 text-xs text-amber-800">
            <Info size={15} className="shrink-0 mt-px" />
            <span>{t('dashboard.courses.communities.access.usergroups.modals.warning')}</span>
          </div>
        </div>
      }
      footer={
        <>
          <Button onClick={() => onOpenChange(false)} disabled={submitting}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" onClick={handleLink} loading={submitting} disabled={!selected}>
            {t('dashboard.courses.communities.access.usergroups.modals.link_button')}
          </Button>
        </>
      }
    />
  )
}

