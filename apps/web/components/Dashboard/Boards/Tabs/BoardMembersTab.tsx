'use client'

import React, { useState, useEffect } from 'react'
import { UserPlus, Trash2 } from 'lucide-react'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getAPIUrl } from '@services/config/config'
import useSWR, { mutate } from 'swr'
import { swrFetcher } from '@services/utils/ts/requests'
import { addBoardMember, removeBoardMember } from '@services/boards/boards'
import { getUserAvatarMediaDirectory } from '@services/media/media'
import ConfirmationModal from '@components/Objects/StyledElements/ConfirmationModal/ConfirmationModal'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import UserAvatar from '@components/Objects/UserAvatar'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'

interface BoardMembersTabProps {
  boardUuid: string
  orgId: number
}

function BoardMembersTab({ boardUuid, orgId }: BoardMembersTabProps) {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token

  const membersKey = access_token ? `${getAPIUrl()}boards/${boardUuid}/members` : null
  const { data: members } = useSWR(
    membersKey,
    (url) => swrFetcher(url, access_token),
    { revalidateOnFocus: true }
  )

  const [addMemberModal, setAddMemberModal] = useState(false)

  const handleRemoveMember = async (userId: number) => {
    try {
      await removeBoardMember(boardUuid, userId, access_token)
      toast.success(t('boards.members.member_removed'))
      if (membersKey) mutate(membersKey)
    } catch {
      toast.error(t('boards.members.member_removed_error'))
    }
  }

  const membersList = members || []

  return (
    <div>
      <div className="h-6"></div>
      <div className="mx-4 sm:mx-10 bg-white rounded-xl shadow-xs px-4 py-4">
        <div className="flex flex-col bg-gray-50 -space-y-1 px-3 sm:px-5 py-3 rounded-md mb-3">
          <div className="flex items-center justify-between">
            <h1 className="font-bold text-lg sm:text-xl text-gray-800">{t('boards.members.title')}</h1>
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
              membersList.length >= 10 ? 'bg-red-100 text-red-600' : 'bg-gray-200 text-gray-500'
            }`}>
              {membersList.length} / 10
            </span>
          </div>
          <h2 className="text-gray-500 text-xs sm:text-sm">{t('boards.members.description')}</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="table-auto w-full text-left whitespace-nowrap rounded-md overflow-hidden">
            <thead className="bg-gray-100 text-gray-500 rounded-xl uppercase">
              <tr className="font-bolder text-sm">
                <th className="py-3 px-4">{t('boards.members.user')}</th>
                <th className="py-3 px-4">{t('boards.members.role')}</th>
                <th className="py-3 px-4">{t('boards.members.actions')}</th>
              </tr>
            </thead>
            <tbody className="mt-5 bg-white rounded-md">
              {membersList.map((member: any) => (
                <tr key={member.id} className="border-b border-gray-100 text-sm">
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-3">
                      <UserAvatar
                        border="border-2"
                        rounded="rounded-full"
                        avatar_url={
                          member.avatar_image && member.user_uuid
                            ? getUserAvatarMediaDirectory(member.user_uuid, member.avatar_image)
                            : ''
                        }
                        predefined_avatar={member.avatar_image ? undefined : 'empty'}
                        width={28}
                      />
                      <div>
                        <div className="font-medium text-gray-900">{member.username || 'Unknown'}</div>
                        {member.email && (
                          <div className="text-xs text-gray-400">{member.email}</div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-bold uppercase tracking-wide ${
                      member.role === 'owner'
                        ? 'bg-purple-100 text-purple-700'
                        : member.role === 'editor'
                        ? 'bg-blue-100 text-blue-700'
                        : 'bg-gray-100 text-gray-700'
                    }`}>
                      {member.role}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    {member.role !== 'owner' && (
                      <ConfirmationModal
                        confirmationButtonText={t('boards.members.remove')}
                        confirmationMessage={t('boards.members.remove_confirm', { name: member.username || 'this user' })}
                        dialogTitle={t('boards.members.remove_member')}
                        dialogTrigger={
                          <button className="flex items-center gap-1 px-3 py-1 text-red-600 hover:bg-red-50 rounded-md text-sm transition-colors">
                            <Trash2 className="w-3.5 h-3.5" />
                            {t('boards.members.remove')}
                          </button>
                        }
                        functionToExecute={() => handleRemoveMember(member.user_id)}
                        status="warning"
                      />
                    )}
                  </td>
                </tr>
              ))}
              {membersList.length === 0 && (
                <tr>
                  <td colSpan={3} className="py-6 px-4 text-center text-gray-400 text-sm">
                    {t('boards.members.no_members')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex flex-row-reverse mt-3 mr-2 items-center gap-3">
          {membersList.length >= 10 ? (
            <span className="text-xs text-red-500 font-medium">{t('boards.members.member_limit_reached')}</span>
          ) : (
            <Modal
              isDialogOpen={addMemberModal}
              onOpenChange={setAddMemberModal}
              minHeight="no-min"
              minWidth="md"
              dialogContent={
                <AddBoardMember
                  boardUuid={boardUuid}
                  orgId={orgId}
                  accessToken={access_token}
                  setModalOpen={setAddMemberModal}
                  membersKey={membersKey}
                />
              }
              dialogTitle={t('boards.members.add_member')}
              dialogDescription={t('boards.members.add_member_description')}
              dialogTrigger={
                <button className="flex items-center gap-1 px-3 py-1.5 bg-black text-white rounded-md font-bold text-sm hover:bg-gray-800 transition-colors">
                  <UserPlus className="w-4 h-4" />
                  <span>{t('boards.members.add_member')}</span>
                </button>
              }
            />
          )}
        </div>
      </div>
    </div>
  )
}

function AddBoardMember({ boardUuid, orgId, accessToken, setModalOpen, membersKey }: {
  boardUuid: string
  orgId: number
  accessToken: string
  setModalOpen: (open: boolean) => void
  membersKey: string | null
}) {
  const { t } = useTranslation()
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null)
  const [role, setRole] = useState('editor')
  const [isAdding, setIsAdding] = useState(false)

  const { data: orgUsers } = useSWR(
    accessToken ? `${getAPIUrl()}orgs/${orgId}/users?page=1&limit=100` : null,
    (url) => swrFetcher(url, accessToken)
  )

  const allUsers = orgUsers?.items || []

  const filteredUsers = allUsers.filter((user: any) => {
    if (!searchQuery.trim()) return true
    const query = searchQuery.toLowerCase()
    return (
      user.username?.toLowerCase().includes(query) ||
      user.email?.toLowerCase().includes(query) ||
      user.first_name?.toLowerCase().includes(query) ||
      user.last_name?.toLowerCase().includes(query)
    )
  })

  const handleAdd = async () => {
    if (!selectedUserId) return
    setIsAdding(true)
    try {
      await addBoardMember(boardUuid, { user_id: selectedUserId, role }, accessToken)
      toast.success(t('boards.members.member_added'))
      setModalOpen(false)
      if (membersKey) mutate(membersKey)
    } catch {
      toast.error(t('boards.members.member_added_error'))
    } finally {
      setIsAdding(false)
    }
  }

  return (
    <div className="p-2 space-y-4">
      <div>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t('boards.members.search_placeholder')}
          className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-black focus:ring-offset-1"
        />
      </div>
      <div className="max-h-48 overflow-y-auto border rounded-lg">
        {filteredUsers.map((user: any) => (
          <button
            key={user.id}
            onClick={() => setSelectedUserId(user.id)}
            className={`w-full flex items-center gap-3 px-3 py-2 text-left text-sm hover:bg-gray-50 transition-colors ${
              selectedUserId === user.id ? 'bg-blue-50 border-l-2 border-blue-500' : ''
            }`}
          >
            <UserAvatar
              border="border-2"
              rounded="rounded-full"
              avatar_url={
                user.avatar_image && user.user_uuid
                  ? getUserAvatarMediaDirectory(user.user_uuid, user.avatar_image)
                  : ''
              }
              predefined_avatar={user.avatar_image ? undefined : 'empty'}
              width={24}
            />
            <div>
              <div className="font-medium text-gray-900">{user.username || `${user.first_name} ${user.last_name}`}</div>
              {user.email && <div className="text-xs text-gray-400">{user.email}</div>}
            </div>
          </button>
        ))}
        {filteredUsers.length === 0 && (
          <div className="px-3 py-4 text-center text-gray-400 text-sm">{t('boards.members.no_users_found')}</div>
        )}
      </div>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500">{t('boards.members.role_label')}</span>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="border rounded-md px-2 py-1 text-sm"
          >
            <option value="editor">{t('boards.members.editor')}</option>
            <option value="viewer">{t('boards.members.viewer')}</option>
          </select>
        </div>
        <button
          onClick={handleAdd}
          disabled={!selectedUserId || isAdding}
          className="bg-black text-white font-bold px-4 py-2 rounded-md text-sm disabled:opacity-50 hover:bg-gray-800 transition-colors"
        >
          {isAdding ? t('boards.members.adding') : t('boards.members.add_member')}
        </button>
      </div>
    </div>
  )
}

export default BoardMembersTab
