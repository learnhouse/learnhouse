'use client'

import React, { useState } from 'react'
import { UserPlus, Trash2, Search, Check, User, Users } from 'lucide-react'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getAPIUrl } from '@services/config/config'
import useSWR, { mutate } from 'swr'
import { swrFetcher } from '@services/utils/ts/requests'
import { addBoardMembersBatch, removeBoardMember } from '@services/boards/boards'
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
  const [selectedUserIds, setSelectedUserIds] = useState<Set<number>>(new Set())
  const [activeGroup, setActiveGroup] = useState<string | null>(null) // null = "All"
  const [role, setRole] = useState('editor')
  const [isAdding, setIsAdding] = useState(false)

  const { data: orgUsers } = useSWR(
    accessToken ? `${getAPIUrl()}orgs/${orgId}/users?page=1&limit=100` : null,
    (url) => swrFetcher(url, accessToken)
  )

  const { data: usergroups } = useSWR(
    accessToken ? `${getAPIUrl()}usergroups/org/${orgId}?org_id=${orgId}` : null,
    (url) => swrFetcher(url, accessToken)
  )

  const allUsers: any[] = orgUsers?.items || []
  const allGroups: any[] = usergroups || []

  const getUserDisplayName = (u: any) => {
    const fullName = [u.first_name, u.last_name].filter(Boolean).join(' ')
    return fullName || u.username || 'Unknown'
  }

  // Filter by search query
  const searchFiltered = allUsers.filter((entry: any) => {
    if (!searchQuery.trim()) return true
    const query = searchQuery.toLowerCase()
    const u = entry.user
    return (
      u.username?.toLowerCase().includes(query) ||
      u.email?.toLowerCase().includes(query) ||
      u.first_name?.toLowerCase().includes(query) ||
      u.last_name?.toLowerCase().includes(query)
    )
  })

  // Filter by active group pill
  const groupFiltered = searchFiltered.filter((entry: any) => {
    if (activeGroup === null) return true
    const u = entry.user
    const userGroupIds: number[] = (u.usergroups || []).map((g: any) => g.id ?? g)
    const group = allGroups.find((g: any) => g.usergroup_uuid === activeGroup)
    return group ? userGroupIds.includes(group.id) : false
  })

  // Build groups for "All" view: group users under their first group; ungrouped at the end
  type GroupSection = { groupId: string | null; groupName: string; entries: any[] }
  const buildGroupedSections = (): GroupSection[] => {
    const sections: GroupSection[] = allGroups.map((g: any) => ({
      groupId: g.usergroup_uuid,
      groupName: g.name,
      entries: [],
    }))
    const ungrouped: GroupSection = { groupId: null, groupName: 'Ungrouped', entries: [] }

    groupFiltered.forEach((entry: any) => {
      const u = entry.user
      const userGroupIds: number[] = (u.usergroups || []).map((g: any) => g.id ?? g)
      let placed = false
      for (const section of sections) {
        const g = allGroups.find((g: any) => g.usergroup_uuid === section.groupId)
        if (g && userGroupIds.includes(g.id)) {
          section.entries.push(entry)
          placed = true
          break
        }
      }
      if (!placed) ungrouped.entries.push(entry)
    })

    const result = sections.filter((s) => s.entries.length > 0)
    if (ungrouped.entries.length > 0) result.push(ungrouped)
    return result
  }

  const sections = activeGroup === null ? buildGroupedSections() : [{ groupId: activeGroup, groupName: '', entries: groupFiltered }]
  const showGroupHeaders = activeGroup === null && allGroups.length > 0

  const toggleUser = (userId: number) => {
    setSelectedUserIds((prev) => {
      const next = new Set(prev)
      next.has(userId) ? next.delete(userId) : next.add(userId)
      return next
    })
  }

  const toggleGroupAll = (entries: any[]) => {
    const ids = entries.map((e: any) => e.user.id as number)
    const allSelected = ids.every((id) => selectedUserIds.has(id))
    setSelectedUserIds((prev) => {
      const next = new Set(prev)
      ids.forEach((id) => (allSelected ? next.delete(id) : next.add(id)))
      return next
    })
  }

  const handleAdd = async () => {
    if (selectedUserIds.size === 0) return
    setIsAdding(true)
    try {
      const members = Array.from(selectedUserIds).map((user_id) => ({ user_id, role }))
      await addBoardMembersBatch(boardUuid, members, accessToken)
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
    <div className="space-y-3">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t('boards.members.search_placeholder')}
          className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-black/10 focus:border-gray-400 transition-all"
          autoFocus
        />
      </div>

      {/* Group filter pills */}
      {allGroups.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => setActiveGroup(null)}
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold transition-colors ${
              activeGroup === null
                ? 'bg-gray-900 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {t('boards.members.all_groups') || 'All'}
          </button>
          {allGroups.map((g: any) => (
            <button
              key={g.usergroup_uuid}
              onClick={() => setActiveGroup(g.usergroup_uuid === activeGroup ? null : g.usergroup_uuid)}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold transition-colors ${
                activeGroup === g.usergroup_uuid
                  ? 'bg-gray-900 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              <Users className="w-3 h-3" />
              {g.name}
            </button>
          ))}
        </div>
      )}

      {/* User list */}
      <div className="max-h-[260px] overflow-y-auto border border-gray-200 rounded-lg">
        {sections.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-10">
            <User className="w-8 h-8 text-gray-300" />
            <p className="text-sm text-gray-400">{t('boards.members.no_users_found')}</p>
          </div>
        )}
        {sections.map((section) => (
          <div key={section.groupId ?? '__ungrouped'}>
            {showGroupHeaders && (
              <div className="flex items-center gap-2 px-4 py-2 bg-gray-50 border-b border-gray-100 sticky top-0 z-10">
                <input
                  type="checkbox"
                  checked={section.entries.length > 0 && section.entries.every((e: any) => selectedUserIds.has(e.user.id))}
                  onChange={() => toggleGroupAll(section.entries)}
                  className="w-3.5 h-3.5 rounded accent-gray-900 cursor-pointer"
                />
                {section.groupId ? (
                  <Users className="w-3.5 h-3.5 text-gray-400" />
                ) : (
                  <User className="w-3.5 h-3.5 text-gray-400" />
                )}
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  {section.groupName}
                </span>
                <span className="ml-auto text-xs text-gray-400">{section.entries.length}</span>
              </div>
            )}
            <div className="divide-y divide-gray-100">
              {section.entries.map((entry: any) => {
                const u = entry.user
                const isSelected = selectedUserIds.has(u.id)
                return (
                  <button
                    key={u.id}
                    onClick={() => toggleUser(u.id)}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                      isSelected ? 'bg-gray-900' : 'hover:bg-gray-50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleUser(u.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="w-3.5 h-3.5 rounded accent-gray-900 cursor-pointer shrink-0"
                    />
                    <UserAvatar
                      width={32}
                      userId={u.id?.toString()}
                      rounded="rounded-full"
                      border="border-2"
                      borderColor={isSelected ? 'border-gray-700' : undefined}
                    />
                    <div className="flex flex-col min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className={`font-semibold text-sm truncate ${isSelected ? 'text-white' : 'text-gray-800'}`}>
                          {getUserDisplayName(u)}
                        </span>
                        <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                          isSelected ? 'bg-gray-700 text-gray-300' : 'bg-gray-100 text-gray-500'
                        }`}>
                          @{u.username}
                        </span>
                      </div>
                      {u.email && (
                        <span className={`text-xs truncate ${isSelected ? 'text-gray-400' : 'text-gray-400'}`}>
                          {u.email}
                        </span>
                      )}
                    </div>
                    {isSelected && <Check className="w-4 h-4 text-white shrink-0" />}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Selected summary */}
      {selectedUserIds.size > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg border border-gray-200">
          <div className="flex -space-x-2">
            {Array.from(selectedUserIds).slice(0, 4).map((uid) => (
              <UserAvatar
                key={uid}
                width={22}
                userId={uid.toString()}
                rounded="rounded-full"
                border="border-2"
              />
            ))}
          </div>
          <span className="text-xs font-semibold text-gray-700">
            {selectedUserIds.size} {selectedUserIds.size === 1 ? 'user' : 'users'} selected
          </span>
          <button
            onClick={() => setSelectedUserIds(new Set())}
            className="ml-auto text-xs text-gray-400 hover:text-gray-600 transition-colors"
          >
            Clear all
          </button>
        </div>
      )}

      {/* Footer: role + add */}
      <div className="flex items-center justify-between pt-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">{t('boards.members.role_label')}</span>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-black/10 focus:border-gray-400 transition-all"
          >
            <option value="editor">{t('boards.members.editor')}</option>
            <option value="viewer">{t('boards.members.viewer')}</option>
          </select>
        </div>
        <button
          onClick={handleAdd}
          disabled={selectedUserIds.size === 0 || isAdding}
          className="inline-flex items-center gap-2 bg-black text-white font-semibold px-5 py-2 rounded-lg text-sm disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-800 transition-all"
        >
          <UserPlus className="w-4 h-4" />
          {isAdding
            ? t('boards.members.adding')
            : selectedUserIds.size > 1
            ? `${t('boards.members.add_member')} (${selectedUserIds.size})`
            : t('boards.members.add_member')}
        </button>
      </div>
    </div>
  )
}

export default BoardMembersTab
