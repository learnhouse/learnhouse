'use client'
import ConfirmationModal from '@components/Objects/StyledElements/ConfirmationModal/ConfirmationModal'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import { getAPIUrl, getUriWithOrg } from '@services/config/config'
import {
  getUserGroups,
  linkResourcesToUserGroup,
  unLinkResourcesToUserGroup,
} from '@services/usergroups/usergroups'
import { updateFolder, getFolderById } from '@services/folders/folders'
import { updateMedia } from '@services/media/media-resource'
import { updateCourse, getCourse } from '@services/courses/courses'
import { apiFetch } from '@services/utils/ts/requests'
import { Check, Globe, Info, SquareUserRound, Users, X } from 'lucide-react'
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

const AccessCard = React.forwardRef<
  HTMLDivElement,
  {
    icon: React.ElementType
    title: string
    description: string
    selected: boolean
  } & React.HTMLAttributes<HTMLDivElement>
>(function AccessCard({ icon: Icon, title, description, selected, className, ...rest }, ref) {
  const { t } = useTranslation()
  return (
    <div
      ref={ref}
      {...rest}
      className={`
        relative w-full rounded-xl p-6 cursor-pointer select-none
        flex flex-col items-center justify-center text-center
        transition-all duration-150
        ${
          selected
            ? 'bg-white border border-indigo-200 ring-1 ring-indigo-100 shadow-xs'
            : 'bg-gray-50/80 border border-gray-100 hover:bg-gray-50 hover:border-gray-200'
        }
        ${className || ''}
      `}
      style={{ minHeight: 160 }}
    >
      {selected && (
        <div className="absolute top-3 right-3 flex items-center gap-1 text-[11px] font-semibold text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-full pl-1 pr-2 py-0.5">
          <span className="w-4 h-4 rounded-full bg-indigo-600 flex items-center justify-center">
            <Check size={10} strokeWidth={3.5} className="text-white" />
          </span>
          <span>{t('access.active')}</span>
        </div>
      )}
      <div
        className={`w-12 h-12 rounded-xl flex items-center justify-center transition-colors duration-150 ${
          selected ? 'bg-indigo-50 text-indigo-600' : 'bg-white border border-gray-100 text-gray-400'
        }`}
      >
        <Icon size={24} strokeWidth={1.75} />
      </div>
      <div className={`mt-4 text-base sm:text-lg font-bold tracking-tight ${selected ? 'text-gray-900' : 'text-gray-600'}`}>
        {title}
      </div>
      <div className="mt-1 text-xs sm:text-sm text-gray-400 leading-snug max-w-[420px]">{description}</div>
    </div>
  )
})

function SkeletonCard() {
  return (
    <div
      className="w-full rounded-xl bg-gray-50/80 border border-gray-100 animate-pulse flex flex-col items-center justify-center p-6"
      style={{ minHeight: 160 }}
    >
      <div className="w-12 h-12 rounded-xl bg-gray-100" />
      <div className="mt-4 h-4 w-28 rounded bg-gray-100" />
      <div className="mt-2 h-3 w-48 rounded bg-gray-100" />
    </div>
  )
}

function LinkUserGroup({
  resource_uuid,
  onLinked,
  closeModal,
}: {
  resource_uuid: string
  onLinked: () => void
  closeModal: () => void
}) {
  const { t } = useTranslation()
  const org = useOrg() as any
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token

  const { data } = useSWR(
    org?.id ? ['usergroups', org.id] : null,
    () => getUserGroups(org.id, access_token)
  )
  const usergroups = data?.data ?? data ?? []
  const [selected, setSelected] = useState<any>(null)

  useEffect(() => {
    if (usergroups && usergroups.length > 0 && selected == null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelected(usergroups[0].id)
    }
  }, [usergroups])

  const handleLink = async () => {
    const res = await linkResourcesToUserGroup(selected, resource_uuid, org.id, access_token)
    if (res.status === 200) {
      closeModal()
      toast.success(t('access.usergroups.link_success'))
      onLinked()
    } else {
      toast.error(t('access.usergroups.link_error'))
    }
  }

  return (
    <div className="flex flex-col space-y-1">
      <div className="flex bg-yellow-100 text-yellow-900 mx-auto w-fit mt-3 px-4 py-2 space-x-2 text-sm rounded-full items-center">
        <Info size={19} />
        <h1 className="font-medium">{t('access.usergroups.warning')}</h1>
      </div>
      <div className="p-4 flex-row flex justify-between items-center">
        {usergroups?.length >= 1 && (
          <div className="py-1">
            <span className="px-3 text-gray-400 font-bold rounded-full py-1 bg-gray-100 mx-3">
              {t('access.usergroups.usergroup_name')}
            </span>
            <select onChange={(e) => setSelected(e.target.value)} value={selected ?? ''}>
              {usergroups.map((group: any) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {usergroups?.length === 0 && (
          <div className="flex space-x-3 items-center">
            <span className="px-3 text-yellow-700 font-bold rounded-full py-1 mx-3">
              {t('access.usergroups.no_usergroups')}
            </span>
            <Link
              className="px-3 text-blue-700 font-bold rounded-full py-1 bg-blue-100 mx-1"
              target="_blank"
              href={getUriWithOrg(org.slug, '/dash/users/settings/usergroups')}
            >
              {t('access.usergroups.create_usergroup')}
            </Link>
          </div>
        )}
        <div className="py-3">
          <button
            onClick={handleLink}
            className="rounded-lg bg-black px-5 py-2 text-xs font-bold text-white nice-shadow transition-all duration-100 ease-linear antialiased hover:scale-105"
          >
            {t('access.usergroups.link_button')}
          </button>
        </div>
      </div>
    </div>
  )
}

function ManageAccessPopover({ resource_uuid, resourceType }: Props) {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const org = useOrg() as any

  // Linked usergroups for this resource
  const linkedKey = org?.id && resource_uuid ? `${getAPIUrl()}usergroups/resource/${resource_uuid}?org_id=${org.id}` : null
  const { data: usergroups, mutate: mutateGroups } = useSWR(linkedKey, (url: string) =>
    apiFetch(url, access_token)
  )

  // Current public flag of the resource
  const { data: resource, mutate: mutateResource } = useSWR(
    resource_uuid && access_token ? ['resource', resourceType, resource_uuid] : null,
    async () => {
      if (resourceType === 'folders') return getFolderById(resource_uuid, access_token)
      if (resourceType === 'courses') return getCourse(resource_uuid, null, access_token)
      return null
    }
  )

  const [isClientPublic, setIsClientPublic] = useState<boolean | undefined>(undefined)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    if (resource && typeof resource.public === 'boolean' && isClientPublic === undefined) {
      setIsClientPublic(resource.public)
    }
  }, [resource])

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
      toast.success(t('access.visibility_updated'))
    } catch (error: any) {
      toast.error(error?.message || t('access.visibility_update_error'))
    } finally {
      setIsSaving(false)
    }
  }

  const isReady = isClientPublic !== undefined

  return (
    <div className="bg-white rounded-xl">
      {/* Access type cards */}
      <div className="pb-5 border-b border-gray-100">
        <div className={`flex flex-col sm:flex-row gap-3 transition-opacity duration-200 ${isSaving ? 'opacity-50 pointer-events-none' : ''}`}>
          {!isReady ? (
            <>
              <SkeletonCard />
              <SkeletonCard />
            </>
          ) : (
            <>
              {isClientPublic === true ? (
                <AccessCard
                  icon={Globe}
                  title={t('access.public.title')}
                  description={t('access.public.description')}
                  selected
                />
              ) : (
                <ConfirmationModal
                  confirmationButtonText={t('access.public.confirmation_button')}
                  confirmationMessage={t('access.public.confirmation_message')}
                  dialogTitle={t('access.public.confirmation_title')}
                  dialogTrigger={
                    <AccessCard
                      icon={Globe}
                      title={t('access.public.title')}
                      description={t('access.public.description')}
                      selected={false}
                    />
                  }
                  functionToExecute={() => persistPublic(true)}
                  status="info"
                />
              )}

              {isClientPublic === false ? (
                <AccessCard
                  icon={Users}
                  title={t('access.users_only.title')}
                  description={t('access.users_only.description')}
                  selected
                />
              ) : (
                <ConfirmationModal
                  confirmationButtonText={t('access.users_only.confirmation_button')}
                  confirmationMessage={t('access.users_only.confirmation_message')}
                  dialogTitle={t('access.users_only.confirmation_title')}
                  dialogTrigger={
                    <AccessCard
                      icon={Users}
                      title={t('access.users_only.title')}
                      description={t('access.users_only.description')}
                      selected={false}
                    />
                  }
                  functionToExecute={() => persistPublic(false)}
                  status="info"
                />
              )}
            </>
          )}
        </div>
      </div>

      {isClientPublic === false && (
        <UserGroupsSection
          resource_uuid={resource_uuid}
          usergroups={usergroups}
          mutateGroups={mutateGroups}
        />
      )}
    </div>
  )
}

function UserGroupsSection({
  resource_uuid,
  usergroups,
  mutateGroups,
}: {
  resource_uuid: string
  usergroups: any[]
  mutateGroups: () => void
}) {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const org = useOrg() as any
  const [linkModal, setLinkModal] = useState(false)

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

  const hasGroups = usergroups && usergroups.length > 0

  return (
    <>
      <div className="flex items-center justify-between py-5 border-b border-gray-100">
        <div className="flex-1">
          <h2 className="font-bold text-lg text-gray-800">{t('access.usergroups.title')}</h2>
          <p className="text-sm text-gray-500 mt-0.5">{t('access.usergroups.subtitle')}</p>
        </div>
        <Modal
          isDialogOpen={linkModal}
          onOpenChange={() => setLinkModal(!linkModal)}
          minHeight="no-min"
          minWidth="md"
          dialogTitle={t('access.usergroups.link_title')}
          dialogContent={
            <LinkUserGroup
              resource_uuid={resource_uuid}
              onLinked={mutateGroups}
              closeModal={() => setLinkModal(false)}
            />
          }
          dialogTrigger={
            <button className="inline-flex items-center gap-1.5 px-3 py-2 border border-gray-200 rounded-lg text-sm font-medium text-gray-600 bg-white hover:bg-gray-50 transition-all">
              <SquareUserRound className="w-4 h-4" />
              <span>{t('access.usergroups.link_to_usergroup')}</span>
            </button>
          }
        />
      </div>

      <div className="relative">
        {hasGroups ? (
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider py-3">
                  {t('access.usergroups.table_name')}
                </th>
                <th className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wider py-3">
                  {t('access.usergroups.table_actions')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {usergroups.map((usergroup: any) => (
                <tr key={usergroup.id} className="hover:bg-gray-50 transition-colors">
                  <td className="py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-indigo-50 text-indigo-500 flex items-center justify-center flex-shrink-0">
                        <Users className="w-4 h-4" />
                      </div>
                      <div className="flex flex-col min-w-0">
                        <span className="font-semibold text-gray-800 text-sm truncate">{usergroup.name}</span>
                        {usergroup.description && (
                          <span className="text-xs text-gray-400 truncate">{usergroup.description}</span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="py-4 text-right">
                    <ConfirmationModal
                      confirmationButtonText={t('access.usergroups.unlink_button')}
                      confirmationMessage={t('access.usergroups.unlink_message')}
                      dialogTitle={t('access.usergroups.unlink_title')}
                      dialogTrigger={
                        <button className="inline-flex items-center gap-1.5 h-8 px-3 bg-white text-gray-600 hover:bg-rose-50 hover:text-rose-600 rounded-md text-xs font-medium nice-shadow transition-all">
                          <X className="w-3.5 h-3.5" />
                          <span>{t('access.usergroups.delete_link')}</span>
                        </button>
                      }
                      functionToExecute={() => removeLink(usergroup.id)}
                      status="warning"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="py-12 text-center">
            <div className="flex flex-col items-center gap-3">
              <div className="bg-gray-100 p-4 rounded-full">
                <Users className="w-8 h-8 text-gray-400" />
              </div>
              <p className="text-gray-400 text-sm font-medium max-w-sm">{t('access.usergroups.subtitle')}</p>
            </div>
          </div>
        )}
      </div>
    </>
  )
}

export default ManageAccessPopover
