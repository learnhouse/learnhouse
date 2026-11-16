'use client'
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics'
import { Button, ChoiceCard, ConfirmDialog, INPUT } from '@components/Dashboard/Shared/DashKit/DashKit'
import { getAPIUrl, getUriWithOrg } from '@services/config/config'
import {
  getUserGroups,
  linkResourcesToUserGroup,
  unLinkResourcesToUserGroup,
} from '@services/usergroups/usergroups'
import { updateFolder, getFolderById } from '@services/folders/folders'
import { updateMedia, getMediaById } from '@services/media/media-resource'
import { updateCourse, getCourse } from '@services/courses/courses'
import { apiFetch } from '@services/utils/ts/requests'
import { ArrowSquareOut, CaretDown, Globe, Info, LinkSimple, Users, UsersThree } from '@phosphor-icons/react'
import Link from 'next/link'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import React, { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import useSWR from 'swr'
import { useTranslation } from 'react-i18next'

type ResourceType = 'folders' | 'courses' | 'media'

type Props = {
  resource_uuid: string
  resourceType: ResourceType
  orgslug: string
}

const asList = (data: any): any[] => (Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [])

// Rendered as the body of a "Manage access" modal by several callers, so it
// stays content-only: visibility choice on top, linked groups below.
function ManageAccessPopover({ resource_uuid, resourceType }: Props) {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const org = useOrg() as any

  // Linked usergroups for this resource
  const linkedKey = org?.id && resource_uuid ? `${getAPIUrl()}usergroups/resource/${resource_uuid}?org_id=${org.id}` : null
  const { data: usergroups, mutate: mutateGroups, isLoading: groupsLoading } = useSWR(linkedKey, (url: string) =>
    apiFetch(url, access_token)
  )

  // Current public flag of the resource
  const { data: resource, mutate: mutateResource } = useSWR(
    resource_uuid && access_token ? ['resource', resourceType, resource_uuid] : null,
    async () => {
      if (resourceType === 'folders') return getFolderById(resource_uuid, access_token)
      if (resourceType === 'courses') return getCourse(resource_uuid, null, access_token)
      if (resourceType === 'media') return getMediaById(resource_uuid, access_token)
      return null
    }
  )

  const { track } = useLHAnalytics('dashboard')
  const [isClientPublic, setIsClientPublic] = useState<boolean | undefined>(undefined)
  const [isSaving, setIsSaving] = useState(false)
  const [confirm, setConfirm] = useState<'public' | 'private' | null>(null)

  useEffect(() => {
    if (resource && typeof resource.public === 'boolean' && isClientPublic === undefined) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsClientPublic(resource.public)
    }
  }, [resource, isClientPublic])

  const persistPublic = async (value: boolean) => {
    setIsSaving(true)
    try {
      if (resourceType === 'folders') {
        await updateFolder(resource_uuid, { public: value }, access_token)
      } else if (resourceType === 'courses') {
        // PUT requires the full body; merge the new public flag in
        const body = resource ? { ...resource, public: value } : { public: value }
        await updateCourse(resource_uuid, body, access_token)
      } else if (resourceType === 'media') {
        await updateMedia(resource_uuid, { public: value }, access_token)
      }
      setIsClientPublic(value)
      mutateResource()
      track(AnalyticsEvent.ResourceVisibilityChanged, {
        resource_type: resourceType,
        resource_uuid,
        is_public: value,
      })
      toast.success(t('access.visibility_updated'))
    } catch (error: any) {
      toast.error(error?.message || t('access.visibility_update_error'))
    } finally {
      setIsSaving(false)
    }
  }

  const isReady = isClientPublic !== undefined

  return (
    <div className="flex flex-col gap-6">
      <section>
        <h3 className="text-sm font-semibold text-neutral-900">{t('library.visibility')}</h3>
        <p className="text-xs text-neutral-500 mt-0.5 mb-3">{t('library.dash.access_visibility_hint')}</p>
        {!isReady ? (
          <div className="grid sm:grid-cols-2 gap-2 animate-pulse">
            {[0, 1].map((i) => (
              <div key={i} className="h-[68px] rounded-xl bg-neutral-100" />
            ))}
          </div>
        ) : (
          <div
            role="radiogroup"
            aria-label={t('library.visibility')}
            className={`grid sm:grid-cols-2 gap-2 transition-opacity ${isSaving ? 'opacity-60 pointer-events-none' : ''}`}
          >
            <ChoiceCard
              selected={isClientPublic === true}
              onClick={() => isClientPublic !== true && setConfirm('public')}
              icon={<Globe size={16} />}
              title={t('access.public.title')}
              description={t('access.public.description')}
            />
            <ChoiceCard
              selected={isClientPublic === false}
              onClick={() => isClientPublic !== false && setConfirm('private')}
              icon={<Users size={16} />}
              title={t('access.users_only.title')}
              description={t('access.users_only.description')}
            />
          </div>
        )}
      </section>

      {isClientPublic === false && (
        <UserGroupsSection
          resource_uuid={resource_uuid}
          usergroups={asList(usergroups)}
          loading={groupsLoading}
          mutateGroups={mutateGroups}
        />
      )}

      <ConfirmDialog
        open={confirm === 'public'}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={t('access.public.confirmation_title')}
        message={t('access.public.confirmation_message')}
        confirmLabel={t('access.public.confirmation_button')}
        tone="info"
        onConfirm={() => persistPublic(true)}
      />
      <ConfirmDialog
        open={confirm === 'private'}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={t('access.users_only.confirmation_title')}
        message={t('access.users_only.confirmation_message')}
        confirmLabel={t('access.users_only.confirmation_button')}
        tone="info"
        onConfirm={() => persistPublic(false)}
      />
    </div>
  )
}

function UserGroupsSection({
  resource_uuid,
  usergroups,
  loading,
  mutateGroups,
}: {
  resource_uuid: string
  usergroups: any[]
  loading: boolean
  mutateGroups: () => void
}) {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const org = useOrg() as any
  const { track } = useLHAnalytics('dashboard')

  const { data: allGroupsData } = useSWR(org?.id ? ['usergroups', org.id] : null, () =>
    getUserGroups(org.id, access_token)
  )
  const allGroups = asList(allGroupsData)
  const linkedIds = new Set(usergroups.map((g: any) => String(g.id)))
  const available = allGroups.filter((g: any) => !linkedIds.has(String(g.id)))

  const [selected, setSelected] = useState<string>('')
  const [linking, setLinking] = useState(false)
  const [unlinkTarget, setUnlinkTarget] = useState<any>(null)
  // Default to the first group still available; reset once it gets linked.
  const selectedId = available.some((g: any) => String(g.id) === selected)
    ? selected
    : available[0]
      ? String(available[0].id)
      : ''

  const handleLink = async () => {
    if (!selectedId) return
    setLinking(true)
    try {
      const res = await linkResourcesToUserGroup(selectedId, resource_uuid, org.id, access_token)
      if (res.status === 200) {
        track(AnalyticsEvent.UsergroupLinked, { resource_uuid, usergroup_id: selectedId })
        toast.success(t('access.usergroups.link_success'))
        mutateGroups()
      } else {
        toast.error(t('access.usergroups.link_error'))
      }
    } catch {
      toast.error(t('access.usergroups.link_error'))
    } finally {
      setLinking(false)
    }
  }

  const removeLink = async (usergroup_id: number) => {
    try {
      const res = await unLinkResourcesToUserGroup(usergroup_id, resource_uuid, org.id, access_token)
      if (res.status === 200) {
        toast.success(t('access.usergroups.unlink_success'))
        mutateGroups()
      } else {
        toast.error(t('access.usergroups.unlink_error'))
      }
    } catch {
      toast.error(t('access.usergroups.unlink_error'))
    }
  }

  return (
    <section className="pt-5 border-t border-neutral-100">
      <h3 className="text-sm font-semibold text-neutral-900">{t('access.usergroups.title')}</h3>
      <p className="text-xs text-neutral-500 mt-0.5 mb-3">{t('access.usergroups.subtitle')}</p>

      {/* Link a group inline */}
      {allGroups.length === 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-neutral-50 ring-1 ring-inset ring-neutral-200/70 px-4 py-3">
          <span className="text-sm text-neutral-600">{t('library.dash.no_usergroups_yet')}</span>
          <Link
            target="_blank"
            href={getUriWithOrg(org?.slug, '/dash/users/settings/usergroups')}
            className="inline-flex items-center gap-1 text-xs font-semibold text-neutral-800 hover:text-neutral-950"
          >
            {t('access.usergroups.create_usergroup')} <ArrowSquareOut size={12} />
          </Link>
        </div>
      ) : available.length > 0 ? (
        <div className="flex gap-2">
          <div className="relative flex-1 min-w-0">
            <select
              value={selectedId}
              onChange={(e) => setSelected(e.target.value)}
              aria-label={t('access.usergroups.usergroup_name')}
              className={`${INPUT} appearance-none pe-8 cursor-pointer`}
            >
              {available.map((group: any) => (
                <option key={group.id} value={String(group.id)}>
                  {group.name}
                </option>
              ))}
            </select>
            <CaretDown size={14} className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-neutral-400" />
          </div>
          <Button variant="primary" onClick={handleLink} loading={linking} icon={<LinkSimple size={14} />} size="lg">
            {t('access.usergroups.link_button')}
          </Button>
        </div>
      ) : null}
      {allGroups.length > 0 && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-neutral-400">
          <Info size={12} className="shrink-0" /> {t('access.usergroups.warning')}
        </p>
      )}

      {/* Linked groups */}
      <div className="mt-4">
        {loading ? (
          <div className="rounded-xl ring-1 ring-inset ring-neutral-200 divide-y divide-neutral-100 animate-pulse">
            {[0, 1].map((i) => (
              <div key={i} className="flex items-center gap-3 px-3.5 py-3">
                <div className="w-8 h-8 rounded-lg bg-neutral-100" />
                <div className="h-3.5 w-40 rounded bg-neutral-100" />
              </div>
            ))}
          </div>
        ) : usergroups.length > 0 ? (
          <ul className="rounded-xl ring-1 ring-inset ring-neutral-200 divide-y divide-neutral-100">
            {usergroups.map((usergroup: any) => (
              <li key={usergroup.id} className="flex items-center gap-3 px-3.5 py-2.5">
                <span className="w-8 h-8 rounded-lg bg-sky-50 text-sky-600 flex items-center justify-center shrink-0">
                  <UsersThree size={16} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-neutral-800 truncate">{usergroup.name}</p>
                  {usergroup.description && <p className="text-xs text-neutral-400 truncate">{usergroup.description}</p>}
                </div>
                <Button variant="danger-ghost" size="sm" onClick={() => setUnlinkTarget(usergroup)}>
                  {t('access.usergroups.delete_link')}
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex flex-col items-center gap-2 py-8 text-center rounded-xl border-2 border-dashed border-neutral-200">
            <span className="w-10 h-10 rounded-xl bg-neutral-100 text-neutral-400 flex items-center justify-center">
              <UsersThree size={18} />
            </span>
            <p className="text-sm text-neutral-500 max-w-xs">{t('access.usergroups.no_usergroups')}</p>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!unlinkTarget}
        onOpenChange={(open) => !open && setUnlinkTarget(null)}
        title={t('access.usergroups.unlink_title')}
        message={t('access.usergroups.unlink_message')}
        confirmLabel={t('access.usergroups.unlink_button')}
        onConfirm={() => removeLink(unlinkTarget.id)}
      />
    </section>
  )
}

export default ManageAccessPopover
