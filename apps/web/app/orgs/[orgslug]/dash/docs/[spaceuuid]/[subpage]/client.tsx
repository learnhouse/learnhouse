'use client'

import React from 'react'
import { Info, GalleryVerticalEnd, Globe, Eye, GlobeLock, Loader2, Check, SaveAllIcon, AlertCircle, Users, SquareUserRound, X } from 'lucide-react'
import { FileText } from 'lucide-react'
import Link from 'next/link'
import { motion } from 'motion/react'
import { DocSpaceProvider, useDocSpace, useDocSpaceDispatch } from '@components/Contexts/DocSpaceContext'
import { Breadcrumbs } from '@components/Objects/Breadcrumbs/Breadcrumbs'
import EditDocSpaceGeneral from '@components/Dashboard/Pages/Docs/EditDocSpaceGeneral'
import EditDocSpaceStructure from '@components/Dashboard/Pages/Docs/EditDocSpaceStructure'
import { getUriWithOrg } from '@services/config/config'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { updateDocSpace } from '@services/docs/docspaces'
import { unLinkResourcesToUserGroup } from '@services/usergroups/usergroups'
import ConfirmationModal from '@components/Objects/StyledElements/ConfirmationModal/ConfirmationModal'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import LinkDocSpaceToUserGroup from '@components/Objects/Modals/Dash/EditDocSpaceAccess/LinkDocSpaceToUserGroup'
import { swrFetcher } from '@services/utils/ts/requests'
import useSWR, { mutate } from 'swr'
import { getAPIUrl } from '@services/config/config'
import toast from 'react-hot-toast'
import { useState, useCallback, useRef, useEffect } from 'react'

interface DocSpaceEditorClientProps {
  org_id: number
  orgslug: string
  spaceuuid: string
  subpage: string
}

const tabs = [
  {
    key: 'general',
    label: 'General',
    icon: Info,
  },
  {
    key: 'structure',
    label: 'Content',
    icon: GalleryVerticalEnd,
  },
  {
    key: 'access',
    label: 'Access',
    icon: Globe,
  },
]

function DocSpaceSaveState({ spaceuuid }: { spaceuuid: string }) {
  const { docSpaceStructure, isSaving, isSaved, saveError } = useDocSpace()
  const dispatch = useDocSpaceDispatch()
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const saveInProgressRef = useRef(false)

  const saveDocSpaceState = useCallback(async () => {
    if (isSaved || isSaving || saveInProgressRef.current || !docSpaceStructure) return
    saveInProgressRef.current = true
    dispatch({ type: 'SET_SAVING', payload: true })
    dispatch({ type: 'SET_SAVE_ERROR', payload: null })

    try {
      await updateDocSpace(spaceuuid, {
        name: docSpaceStructure.name,
        description: docSpaceStructure.description,
        published: docSpaceStructure.published,
        public: docSpaceStructure.public,
      }, access_token)

      await mutate(`${getAPIUrl()}docs/${spaceuuid}/meta`)
      dispatch({ type: 'SET_SAVED', payload: true })
      toast.success('Changes saved')
    } catch (error) {
      dispatch({ type: 'SET_SAVE_ERROR', payload: 'Failed to save' })
      toast.error('Failed to save changes')
      dispatch({ type: 'SET_IS_NOT_SAVED' })
    } finally {
      dispatch({ type: 'SET_SAVING', payload: false })
      saveInProgressRef.current = false
    }
  }, [isSaved, isSaving, docSpaceStructure, spaceuuid, access_token, dispatch])

  return (
    <button
      className={
        `px-3.5 py-2 text-sm font-semibold flex items-center space-x-2 transition-colors ` +
        (isSaved && !saveError
          ? 'text-neutral-500 cursor-default'
          : saveError
            ? 'bg-red-600 text-white hover:bg-red-700 cursor-pointer'
            : 'bg-neutral-900 text-white hover:bg-neutral-800 cursor-pointer') +
        (isSaving ? ' opacity-50 cursor-not-allowed' : '')
      }
      onClick={saveDocSpaceState}
      disabled={isSaving}
    >
      {isSaving ? (
        <Loader2 className="w-4 h-4 animate-spin" />
      ) : isSaved && !saveError ? (
        <Check className="w-4 h-4" />
      ) : saveError ? (
        <AlertCircle className="w-4 h-4" />
      ) : (
        <SaveAllIcon className="w-4 h-4" />
      )}
      <span>
        {isSaving
          ? 'Saving...'
          : isSaved && !saveError
            ? 'Saved'
            : saveError
              ? 'Retry'
              : 'Save'}
      </span>
      {!isSaved && !saveError && !isSaving && (
        <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-white/20 text-white rounded whitespace-nowrap">
          Unsaved
        </span>
      )}
    </button>
  )
}

function DocSpaceOverviewTop({ spaceuuid, orgslug }: { spaceuuid: string; orgslug: string }) {
  const { docSpaceStructure, isLoading } = useDocSpace()
  const dispatch = useDocSpaceDispatch()
  const org = useOrg() as any
  const session = useLHSession() as any
  const [isPublishing, setIsPublishing] = useState(false)

  const togglePublishStatus = useCallback(async () => {
    if (isPublishing || !docSpaceStructure) return
    setIsPublishing(true)

    const newPublishedStatus = !docSpaceStructure.published
    const toastId = toast.loading(newPublishedStatus ? 'Publishing...' : 'Unpublishing...')

    dispatch({ type: 'MERGE_CHANGES', payload: { published: newPublishedStatus } })

    try {
      await updateDocSpace(spaceuuid, {
        published: newPublishedStatus,
      }, session.data?.tokens?.access_token)

      await mutate(`${getAPIUrl()}docs/${spaceuuid}/meta`)

      toast.dismiss(toastId)
      toast.success(newPublishedStatus ? 'Published' : 'Unpublished')
    } catch (error) {
      dispatch({ type: 'MERGE_CHANGES', payload: { published: !newPublishedStatus } })
      toast.dismiss(toastId)
      toast.error('Failed to update publish status')
    } finally {
      setIsPublishing(false)
    }
  }, [isPublishing, docSpaceStructure, spaceuuid, session.data?.tokens?.access_token, dispatch])

  if (isLoading || !docSpaceStructure) {
    return null
  }

  const isPublished = docSpaceStructure.published

  return (
        <div className="flex items-center self-center rounded-lg shadow-sm shadow-neutral-300/40 ring-1 ring-neutral-200/60 overflow-hidden">
          <DocSpaceSaveState spaceuuid={spaceuuid} />
          <div className="w-px self-stretch bg-neutral-200/80" />
          <button
            onClick={togglePublishStatus}
            disabled={isPublishing}
            className={`group px-3.5 py-2 text-sm font-semibold flex items-center space-x-2 transition-colors ${
              isPublished
                ? 'bg-green-50/70 text-green-700 hover:bg-green-100/70'
                : 'bg-yellow-50/70 text-yellow-700 hover:bg-yellow-100/70'
            } ${isPublishing ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
          >
            {isPublishing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : isPublished ? (
              <Globe className="w-4 h-4" />
            ) : (
              <GlobeLock className="w-4 h-4" />
            )}
            <span>
              {isPublishing
                ? 'Processing...'
                : isPublished
                  ? 'Published'
                  : 'Unpublished'
              }
            </span>
            {!isPublishing && (
              <span className="inline-flex overflow-hidden max-w-0 group-hover:max-w-[150px] opacity-0 group-hover:opacity-100 transition-all duration-300 ease-in-out">
                <span className={`px-1.5 py-0.5 text-[10px] font-semibold rounded whitespace-nowrap ${
                  isPublished
                    ? 'bg-green-200/80 text-green-800'
                    : 'bg-yellow-200/80 text-yellow-800'
                }`}>
                  {isPublished ? 'Click to unpublish' : 'Click to publish'}
                </span>
              </span>
            )}
          </button>
          <div className="w-px self-stretch bg-neutral-200/80" />
          <Link
            href={getUriWithOrg(org?.slug, '') + `/docs/${docSpaceStructure.slug || spaceuuid}`}
            target="_blank"
            className="px-3.5 py-2 text-sm font-semibold text-neutral-600 bg-neutral-50/70 hover:bg-neutral-100/70 transition-colors flex items-center space-x-2"
          >
            <Eye className="w-4 h-4" />
            <span>Preview</span>
          </Link>
        </div>
  )
}

function DocSpaceAccessSettings({ spaceuuid }: { spaceuuid: string }) {
  const { docSpaceStructure, isLoading, isSaving } = useDocSpace()
  const dispatch = useDocSpaceDispatch()
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const org = useOrg() as any

  const [isClientPublic, setIsClientPublic] = useState<boolean | undefined>(undefined)
  const hasInitializedRef = useRef(false)
  const previousPublicRef = useRef<boolean | undefined>(undefined)

  const { data: usergroups } = useSWR(
    docSpaceStructure?.docspace_uuid && org?.id
      ? `${getAPIUrl()}usergroups/resource/${docSpaceStructure.docspace_uuid}?org_id=${org.id}`
      : null,
    (url: string) => swrFetcher(url, access_token)
  )

  useEffect(() => {
    if (!isLoading && docSpaceStructure?.public !== undefined && !hasInitializedRef.current) {
      setIsClientPublic(docSpaceStructure.public)
      previousPublicRef.current = docSpaceStructure.public
      hasInitializedRef.current = true
    }
  }, [isLoading, docSpaceStructure?.public])

  useEffect(() => {
    if (!hasInitializedRef.current || isLoading || isSaving) return
    if (isClientPublic === undefined) return
    if (isClientPublic === previousPublicRef.current) return
    dispatch({ type: 'MERGE_CHANGES', payload: { public: isClientPublic } })
    previousPublicRef.current = isClientPublic
  }, [isClientPublic, isLoading, isSaving, dispatch])

  const handleSetPublic = useCallback((value: boolean) => {
    setIsClientPublic(value)
  }, [])

  const removeUserGroupLink = async (usergroup_id: number) => {
    try {
      const res = await unLinkResourcesToUserGroup(usergroup_id, docSpaceStructure.docspace_uuid, org.id, access_token)
      if (res.status === 200) {
        toast.success('UserGroup unlinked')
        mutate(`${getAPIUrl()}usergroups/resource/${docSpaceStructure.docspace_uuid}?org_id=${org.id}`)
      } else {
        toast.error(`Failed to unlink: ${res.data?.detail || 'Unknown error'}`)
      }
    } catch (error) {
      toast.error('Failed to unlink UserGroup')
    }
  }

  if (isLoading || !docSpaceStructure) {
    return (
      <div className="h-full flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
      </div>
    )
  }

  return (
    <div>
      <div className="h-6" />
      <div className="mx-4 sm:mx-10 bg-white rounded-xl shadow-xs px-4 py-4">
        <div className={`flex flex-col sm:flex-row sm:space-x-2 space-y-2 sm:space-y-0 mx-auto mb-3 ${isSaving ? 'opacity-50 pointer-events-none' : ''}`}>
          <ConfirmationModal
            confirmationButtonText="Set Public"
            confirmationMessage="This documentation will be accessible to everyone, including unauthenticated users."
            dialogTitle="Make Documentation Public"
            dialogTrigger={
              <div className="w-full h-[200px] bg-slate-100 rounded-lg cursor-pointer hover:bg-slate-200 transition-all">
                {isClientPublic && (
                  <div className="bg-green-200 text-green-600 font-bold w-fit my-3 mx-3 absolute text-sm px-3 py-1 rounded-lg">
                    Active
                  </div>
                )}
                <div className="flex flex-col space-y-1 justify-center items-center h-full p-2 sm:p-4">
                  <Globe className="text-slate-400" size={32} />
                  <div className="text-xl sm:text-2xl text-slate-700 font-bold">
                    Public
                  </div>
                  <div className="text-gray-400 text-sm sm:text-md tracking-tight w-full sm:w-[500px] leading-5 text-center">
                    Anyone can view this documentation without needing to log in
                  </div>
                </div>
              </div>
            }
            functionToExecute={() => handleSetPublic(true)}
            status="info"
          />
          <ConfirmationModal
            confirmationButtonText="Set Users Only"
            confirmationMessage="Only authenticated users or members of linked UserGroups will be able to access this documentation."
            dialogTitle="Restrict Documentation Access"
            dialogTrigger={
              <div className="w-full h-[200px] bg-slate-100 rounded-lg cursor-pointer hover:bg-slate-200 transition-all">
                {!isClientPublic && (
                  <div className="bg-green-200 text-green-600 font-bold w-fit my-3 mx-3 absolute text-sm px-3 py-1 rounded-lg">
                    Active
                  </div>
                )}
                <div className="flex flex-col space-y-1 justify-center items-center h-full p-2 sm:p-4">
                  <Users className="text-slate-400" size={32} />
                  <div className="text-xl sm:text-2xl text-slate-700 font-bold">
                    Users Only
                  </div>
                  <div className="text-gray-400 text-sm sm:text-md tracking-tight w-full sm:w-[500px] leading-5 text-center">
                    Only members of linked UserGroups can access this documentation
                  </div>
                </div>
              </div>
            }
            functionToExecute={() => handleSetPublic(false)}
            status="info"
          />
        </div>
        {!isClientPublic && (
          <>
            <div className="flex flex-col bg-gray-50 -space-y-1 px-3 sm:px-5 py-3 rounded-md mb-3">
              <h1 className="font-bold text-lg sm:text-xl text-gray-800">UserGroups</h1>
              <h2 className="text-gray-500 text-xs sm:text-sm">
                Manage which UserGroups have access to this documentation
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="table-auto w-full text-left whitespace-nowrap rounded-md overflow-hidden">
                <thead className="bg-gray-100 text-gray-500 rounded-xl uppercase">
                  <tr className="font-bolder text-sm">
                    <th className="py-3 px-4">Name</th>
                    <th className="py-3 px-4">Actions</th>
                  </tr>
                </thead>
                <tbody className="mt-5 bg-white rounded-md">
                  {usergroups?.map((usergroup: any) => (
                    <tr key={usergroup.usergroup_uuid} className="border-b border-gray-100 text-sm">
                      <td className="py-3 px-4">{usergroup.name}</td>
                      <td className="py-3 px-4">
                        <ConfirmationModal
                          confirmationButtonText="Unlink"
                          confirmationMessage="This UserGroup will no longer have access to this documentation."
                          dialogTitle="Unlink UserGroup"
                          dialogTrigger={
                            <button className="mr-2 flex space-x-2 hover:cursor-pointer p-1 px-3 bg-rose-700 rounded-md font-bold items-center text-sm text-rose-100">
                              <X className="w-4 h-4" />
                              <span>Unlink</span>
                            </button>
                          }
                          functionToExecute={() => removeUserGroupLink(usergroup.id)}
                          status="warning"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <DocSpaceUserGroupLinkButton />
          </>
        )}
      </div>
    </div>
  )
}

function DocSpaceUserGroupLinkButton() {
  const [userGroupModal, setUserGroupModal] = useState(false)

  return (
    <div className="flex flex-row-reverse mt-3 mr-2">
      <Modal
        isDialogOpen={userGroupModal}
        onOpenChange={() => setUserGroupModal(!userGroupModal)}
        minHeight="no-min"
        minWidth="md"
        dialogContent={<LinkDocSpaceToUserGroup setUserGroupModal={setUserGroupModal} />}
        dialogTitle="Link to UserGroup"
        dialogDescription="Select a UserGroup to grant access to this documentation."
        dialogTrigger={
          <button className="flex space-x-2 hover:cursor-pointer p-1 px-3 bg-green-700 rounded-md font-bold items-center text-xs sm:text-sm text-green-100">
            <SquareUserRound className="w-3 h-3 sm:w-4 sm:h-4" />
            <span>Link to UserGroup</span>
          </button>
        }
      />
    </div>
  )
}

const subpageLabels: Record<string, { title: string; subtitle: string }> = {
  general: {
    title: 'General',
    subtitle: 'Manage basic settings for this documentation space',
  },
  structure: {
    title: 'Content',
    subtitle: 'Organize sections, groups, and pages in your documentation',
  },
  access: {
    title: 'Access',
    subtitle: 'Choose who can access this documentation',
  },
}

function DocSpaceEditorContent({ org_id, orgslug, spaceuuid, subpage }: DocSpaceEditorClientProps) {
  const labels = subpageLabels[subpage]
  const { docSpaceStructure } = useDocSpace()

  return (
    <div className="h-screen w-full bg-[#f8f8f8] grid grid-rows-[auto_1fr]">
      <div className="pl-10 pr-10 tracking-tight bg-[#fcfbfc] z-10 nice-shadow flex-shrink-0 relative">
        <div className="pt-6 pb-4">
          <Breadcrumbs items={[
            { label: 'Documentation', href: '/dash/docs', icon: <FileText size={14} /> },
            { label: docSpaceStructure?.name || '' }
          ]} />
        </div>
        <div className="my-2 py-3 flex items-start justify-between">
          <div className="w-100 flex flex-col space-y-1">
            {labels && (
              <>
                <div className="pt-3 flex font-bold text-4xl tracking-tighter">
                  {labels.title}
                </div>
                <div className="flex font-medium text-gray-400 text-md">
                  {labels.subtitle}
                </div>
              </>
            )}
          </div>
          <DocSpaceOverviewTop spaceuuid={spaceuuid} orgslug={orgslug} />
        </div>
        <div className="flex space-x-5 font-black text-sm">
          {tabs.map((tab) => {
            const IconComponent = tab.icon
            const isActive = subpage === tab.key

            return (
              <Link
                key={tab.key}
                href={`/dash/docs/${spaceuuid}/${tab.key}`}
              >
                <div
                  className={`py-2 w-fit text-center border-black transition-all ease-linear ${
                    isActive ? 'border-b-4' : 'opacity-50'
                  } cursor-pointer`}
                >
                  <div className="flex items-center space-x-2.5 mx-2">
                    <IconComponent size={16} />
                    <div>{tab.label}</div>
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
      </div>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.1, type: 'spring', stiffness: 80 }}
        className="h-full overflow-y-auto"
      >
        <div>
          {subpage === 'general' && (
            <EditDocSpaceGeneral spaceuuid={spaceuuid} />
          )}
          {subpage === 'structure' && (
            <EditDocSpaceStructure spaceuuid={spaceuuid} orgId={org_id} orgslug={orgslug} />
          )}
          {subpage === 'access' && (
            <DocSpaceAccessSettings spaceuuid={spaceuuid} />
          )}
        </div>
      </motion.div>
    </div>
  )
}

const DocSpaceEditorClient = ({ org_id, orgslug, spaceuuid, subpage }: DocSpaceEditorClientProps) => {
  return (
    <DocSpaceProvider docspaceUUID={spaceuuid}>
      <DocSpaceEditorContent
        org_id={org_id}
        orgslug={orgslug}
        spaceuuid={spaceuuid}
        subpage={subpage}
      />
    </DocSpaceProvider>
  )
}

export default DocSpaceEditorClient
