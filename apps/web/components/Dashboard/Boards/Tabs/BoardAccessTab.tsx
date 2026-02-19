'use client'

import React, { useState, useEffect } from 'react'
import { Globe, Users, X, SquareUserRound } from 'lucide-react'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getAPIUrl, getUriWithOrg } from '@services/config/config'
import useSWR, { mutate } from 'swr'
import { swrFetcher } from '@services/utils/ts/requests'
import { updateBoard } from '@services/boards/boards'
import { linkResourcesToUserGroup, unLinkResourcesToUserGroup } from '@services/usergroups/usergroups'
import ConfirmationModal from '@components/Objects/StyledElements/ConfirmationModal/ConfirmationModal'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import toast from 'react-hot-toast'
import Link from 'next/link'

interface BoardAccessTabProps {
  board: any
  boardUuid: string
  orgId: number
  boardKey: string | null
}

function BoardAccessTab({ board, boardUuid, orgId, boardKey }: BoardAccessTabProps) {
  const org = useOrg() as any
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token

  const [isPublic, setIsPublic] = useState<boolean>(board.public ?? true)
  const [isSaving, setIsSaving] = useState(false)
  const [userGroupModal, setUserGroupModal] = useState(false)

  useEffect(() => {
    setIsPublic(board.public ?? true)
  }, [board.public])

  const { data: usergroups } = useSWR(
    !isPublic && boardUuid && org?.id
      ? `${getAPIUrl()}usergroups/resource/${boardUuid}?org_id=${org.id}`
      : null,
    (url) => swrFetcher(url, access_token)
  )

  const handleSetAccess = async (value: boolean) => {
    setIsSaving(true)
    setIsPublic(value)
    try {
      await updateBoard(boardUuid, { public: value }, access_token)
      toast.success(value ? 'Board set to public' : 'Board set to private')
      if (boardKey) mutate(boardKey)
      mutate((key) => typeof key === 'string' && key.includes('/boards/org/'), undefined, { revalidate: true })
    } catch {
      setIsPublic(!value)
      toast.error('Failed to update access')
    } finally {
      setIsSaving(false)
    }
  }

  const removeUserGroupLink = async (usergroup_id: number) => {
    try {
      const res = await unLinkResourcesToUserGroup(usergroup_id, boardUuid, orgId, access_token)
      if (res.status === 200) {
        toast.success('User group unlinked')
        mutate(`${getAPIUrl()}usergroups/resource/${boardUuid}?org_id=${org.id}`)
      } else {
        toast.error(`Failed to unlink: ${res.data?.detail || 'Unknown error'}`)
      }
    } catch {
      toast.error('Failed to unlink user group')
    }
  }

  return (
    <div>
      <div className="h-6"></div>
      <div className="mx-4 sm:mx-10 bg-white rounded-xl shadow-xs px-4 py-4">
        <div className="flex flex-col bg-gray-50 -space-y-1 px-3 sm:px-5 py-3 rounded-md mb-3">
          <h1 className="font-bold text-lg sm:text-xl text-gray-800">Access Control</h1>
          <h2 className="text-gray-500 text-xs sm:text-sm">Control who can access this board</h2>
        </div>
        <div className={`flex flex-col sm:flex-row sm:space-x-2 space-y-2 sm:space-y-0 mx-auto mb-3 ${isSaving ? 'opacity-50 pointer-events-none' : ''}`}>
          <ConfirmationModal
            confirmationButtonText="Set to Public"
            confirmationMessage="All signed-in organization members will be able to access this board."
            dialogTitle="Make Board Public"
            dialogTrigger={
              <div className="w-full h-[200px] bg-slate-100 rounded-lg cursor-pointer hover:bg-slate-200 transition-all">
                {isPublic && (
                  <div className="bg-green-200 text-green-600 font-bold w-fit my-3 mx-3 absolute text-sm px-3 py-1 rounded-lg">
                    Active
                  </div>
                )}
                <div className="flex flex-col space-y-1 justify-center items-center h-full p-2 sm:p-4">
                  <Globe className="text-slate-400" size={32} />
                  <div className="text-xl sm:text-2xl text-slate-700 font-bold">Public</div>
                  <div className="text-gray-400 text-sm sm:text-md tracking-tight w-full sm:w-[500px] leading-5 text-center">
                    All signed-in organization members can access this board
                  </div>
                </div>
              </div>
            }
            functionToExecute={() => handleSetAccess(true)}
            status="info"
          />
          <ConfirmationModal
            confirmationButtonText="Set to Private"
            confirmationMessage="Only members of linked UserGroups will be able to access this board."
            dialogTitle="Make Board Private"
            dialogTrigger={
              <div className="w-full h-[200px] bg-slate-100 rounded-lg cursor-pointer hover:bg-slate-200 transition-all">
                {!isPublic && (
                  <div className="bg-green-200 text-green-600 font-bold w-fit my-3 mx-3 absolute text-sm px-3 py-1 rounded-lg">
                    Active
                  </div>
                )}
                <div className="flex flex-col space-y-1 justify-center items-center h-full p-2 sm:p-4">
                  <Users className="text-slate-400" size={32} />
                  <div className="text-xl sm:text-2xl text-slate-700 font-bold">Users Only</div>
                  <div className="text-gray-400 text-sm sm:text-md tracking-tight w-full sm:w-[500px] leading-5 text-center">
                    Only linked UserGroups can access this board
                  </div>
                </div>
              </div>
            }
            functionToExecute={() => handleSetAccess(false)}
            status="info"
          />
        </div>

        {/* UserGroups Section (shown when private) */}
        {!isPublic && (
          <>
            <div className="flex flex-col bg-gray-50 -space-y-1 px-3 sm:px-5 py-3 rounded-md mb-3">
              <h1 className="font-bold text-lg sm:text-xl text-gray-800">User Groups</h1>
              <h2 className="text-gray-500 text-xs sm:text-sm">
                Manage which user groups have access to this board
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
                    <tr key={usergroup.id} className="border-b border-gray-100 text-sm">
                      <td className="py-3 px-4">{usergroup.name}</td>
                      <td className="py-3 px-4">
                        <ConfirmationModal
                          confirmationButtonText="Unlink"
                          confirmationMessage="This user group will no longer have access to this board."
                          dialogTitle="Unlink User Group"
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
                  {(!usergroups || usergroups.length === 0) && (
                    <tr>
                      <td colSpan={2} className="py-6 px-4 text-center text-gray-400 text-sm">
                        No user groups linked yet
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="flex flex-row-reverse mt-3 mr-2">
              <Modal
                isDialogOpen={userGroupModal}
                onOpenChange={() => setUserGroupModal(!userGroupModal)}
                minHeight="no-min"
                minWidth="md"
                dialogContent={
                  <LinkUserGroupToBoard
                    boardUuid={boardUuid}
                    orgId={orgId}
                    accessToken={access_token}
                    setModalOpen={setUserGroupModal}
                  />
                }
                dialogTitle="Link to User Group"
                dialogDescription="Select a user group to give them access to this board"
                dialogTrigger={
                  <button className="flex space-x-2 hover:cursor-pointer p-1 px-3 bg-green-700 rounded-md font-bold items-center text-xs sm:text-sm text-green-100">
                    <SquareUserRound className="w-3 h-3 sm:w-4 sm:h-4" />
                    <span>Link to UserGroup</span>
                  </button>
                }
              />
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function LinkUserGroupToBoard({ boardUuid, orgId, accessToken, setModalOpen }: {
  boardUuid: string
  orgId: number
  accessToken: string
  setModalOpen: (open: boolean) => void
}) {
  const org = useOrg() as any

  const { data: usergroups } = useSWR(
    org ? `${getAPIUrl()}usergroups/org/${org.id}?org_id=${org.id}` : null,
    (url) => swrFetcher(url, accessToken)
  )

  const [selectedUserGroup, setSelectedUserGroup] = useState<number | null>(null)

  useEffect(() => {
    if (usergroups && usergroups.length > 0) {
      setSelectedUserGroup(usergroups[0].id)
    }
  }, [usergroups])

  const handleLink = async () => {
    if (!selectedUserGroup) return
    const res = await linkResourcesToUserGroup(selectedUserGroup, boardUuid, orgId, accessToken)
    if (res.status === 200) {
      setModalOpen(false)
      toast.success('User group linked')
      mutate(`${getAPIUrl()}usergroups/resource/${boardUuid}?org_id=${org.id}`)
    } else {
      toast.error(`Failed to link: ${res.data?.detail || 'Unknown error'}`)
    }
  }

  return (
    <div className="flex flex-col space-y-1">
      <div className="p-4 flex-row flex justify-between items-center">
        {usergroups?.length >= 1 ? (
          <div className="py-1">
            <span className="px-3 text-gray-400 font-bold rounded-full py-1 bg-gray-100 mx-3">
              User Group
            </span>
            <select
              onChange={(e) => setSelectedUserGroup(Number(e.target.value))}
              defaultValue={selectedUserGroup ?? undefined}
            >
              {usergroups.map((group: any) => (
                <option key={group.id} value={group.id}>{group.name}</option>
              ))}
            </select>
          </div>
        ) : (
          <div className="flex space-x-3 items-center">
            <span className="px-3 text-yellow-700 font-bold rounded-full py-1 mx-3">
              No user groups available
            </span>
            <Link
              className="px-3 text-blue-700 font-bold rounded-full py-1 bg-blue-100 mx-1"
              target="_blank"
              href={getUriWithOrg(org?.slug, '/dash/users/settings/usergroups')}
            >
              Create User Group
            </Link>
          </div>
        )}
        <div className="py-3">
          <button
            onClick={handleLink}
            disabled={!selectedUserGroup}
            className="bg-green-700 text-white font-bold px-4 py-2 rounded-md shadow-sm disabled:opacity-50"
          >
            Link
          </button>
        </div>
      </div>
    </div>
  )
}

export default BoardAccessTab
