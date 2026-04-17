'use client'

import React, { useEffect, useState } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@components/ui/popover'
import { Globe, Lock, LockOpen, Shield, Users, Plus, X, Loader2, Check } from 'lucide-react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { getUserGroups } from '@services/usergroups/usergroups'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'

export type LockType = 'public' | 'authenticated' | 'restricted'

type LockPopoverProps = {
  lockType: LockType
  onChangeLockType: (next: LockType) => Promise<void> | void
  // List + mutate usergroups (only shown when lockType === 'restricted').
  fetchAssignedUserGroups: () => Promise<UserGroup[]>
  addUserGroup: (usergroupUuid: string) => Promise<void>
  removeUserGroup: (usergroupUuid: string) => Promise<void>
  // Which locale key to use for the popover heading — selects
  // `course.lock.title_chapter` vs `title_activity` so translations can
  // keep correct grammatical gender/agreement per language.
  resourceNoun: 'chapter' | 'activity'
  disabled?: boolean
}

type UserGroup = {
  usergroup_id: number
  usergroup_uuid: string
  name: string
  description?: string | null
}

type LockOption = { value: LockType; Icon: any; tone: string }

const LOCK_OPTIONS: LockOption[] = [
  { value: 'public', Icon: Globe, tone: 'text-emerald-600' },
  { value: 'authenticated', Icon: Shield, tone: 'text-sky-600' },
  { value: 'restricted', Icon: Users, tone: 'text-rose-600' },
]

function lockTriggerAppearance(lockType: LockType) {
  switch (lockType) {
    case 'authenticated':
      return {
        titleKey: 'course.lock.trigger_authenticated_title',
        titleFallback: 'Access: signed-in users only',
        className: 'bg-sky-50 text-sky-600 ring-1 ring-sky-200 hover:bg-sky-100',
        Icon: Lock,
      }
    case 'restricted':
      return {
        titleKey: 'course.lock.trigger_restricted_title',
        titleFallback: 'Access: specific user groups only',
        className: 'bg-rose-50 text-rose-600 ring-1 ring-rose-200 hover:bg-rose-100',
        Icon: Lock,
      }
    default:
      return {
        titleKey: 'course.lock.trigger_public_title',
        titleFallback: 'Access: open to everyone',
        className: 'text-gray-300 hover:text-gray-500 hover:bg-gray-100',
        Icon: LockOpen,
      }
  }
}

export default function LockPopover({
  lockType,
  onChangeLockType,
  fetchAssignedUserGroups,
  addUserGroup,
  removeUserGroup,
  resourceNoun,
  disabled,
}: LockPopoverProps) {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const org = useOrg() as any
  const access_token = session?.data?.tokens?.access_token
  const org_id = org?.id

  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [assignedGroups, setAssignedGroups] = useState<UserGroup[]>([])
  const [allGroups, setAllGroups] = useState<UserGroup[] | null>(null)
  const [loadingGroups, setLoadingGroups] = useState(false)

  const refreshAssigned = async () => {
    try {
      const groups = await fetchAssignedUserGroups()
      setAssignedGroups(groups || [])
    } catch {
      // swallow — TOC still usable, show empty list
      setAssignedGroups([])
    }
  }

  useEffect(() => {
    if (!open || lockType !== 'restricted') return
    refreshAssigned()
    // Lazy-load org groups so we don't hit the API until the popover opens.
    if (allGroups === null && org_id && access_token) {
      setLoadingGroups(true)
      getUserGroups(org_id, access_token)
        .then((res: any) => {
          // getUserGroups returns metadata wrapper — unwrap if needed
          const list = Array.isArray(res) ? res : res?.data || []
          setAllGroups(list)
        })
        .catch(() => setAllGroups([]))
        .finally(() => setLoadingGroups(false))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, lockType])

  const assignedUuids = new Set(assignedGroups.map((g) => g.usergroup_uuid))
  const available = (allGroups || []).filter((g) => !assignedUuids.has(g.usergroup_uuid))

  const handleSelect = async (next: LockType) => {
    if (saving || next === lockType) return
    setSaving(true)
    try {
      await onChangeLockType(next)
    } finally {
      setSaving(false)
    }
  }

  const handleAdd = async (uuid: string) => {
    try {
      await addUserGroup(uuid)
      await refreshAssigned()
    } catch {
      toast.error(t('course.lock.toast_add_error', 'Could not add user group'))
    }
  }

  const handleRemove = async (uuid: string) => {
    try {
      await removeUserGroup(uuid)
      await refreshAssigned()
    } catch {
      toast.error(t('course.lock.toast_remove_error', 'Could not remove user group'))
    }
  }

  const trigger = lockTriggerAppearance(lockType)
  const TriggerIcon = trigger.Icon

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          title={t(trigger.titleKey, trigger.titleFallback)}
          className={`h-7 w-7 flex items-center justify-center rounded-md transition-colors ${trigger.className} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          <TriggerIcon size={14} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} className="w-[300px] p-0 shadow-md shadow-gray-300/25 ring-1 ring-neutral-200/70 rounded-xl overflow-hidden border-0 bg-white">
        <div className="px-4 py-3 border-b border-gray-100">
          <div className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold">
            {t('course.lock.header_access', 'Access')}
          </div>
          <div className="text-sm font-semibold text-gray-900">
            {resourceNoun === 'chapter'
              ? t('course.lock.title_chapter', 'Lock this chapter')
              : t('course.lock.title_activity', 'Lock this activity')}
          </div>
        </div>

        <div className="p-2">
          {LOCK_OPTIONS.map((opt) => {
            const selected = opt.value === lockType
            const { Icon } = opt
            return (
              <button
                key={opt.value}
                type="button"
                disabled={saving}
                onClick={() => handleSelect(opt.value)}
                className={`w-full flex items-start gap-3 p-2.5 rounded-lg text-left transition-colors ${
                  selected ? 'bg-gray-50' : 'hover:bg-gray-50'
                } ${saving ? 'opacity-50' : ''}`}
              >
                <div className={`flex-shrink-0 mt-0.5 ${opt.tone}`}>
                  <Icon size={16} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-800 flex items-center gap-1.5">
                    {t(`course.lock.option_${opt.value}_label`, opt.value === 'public' ? 'Public' : opt.value === 'authenticated' ? 'Signed-in only' : 'User groups only')}
                    {selected && <Check size={13} className="text-gray-500" />}
                  </div>
                  <div className="text-[11px] text-gray-500 leading-snug">
                    {t(`course.lock.option_${opt.value}_description`, opt.value === 'public' ? 'Anyone can open this, even without signing in.' : opt.value === 'authenticated' ? 'Only logged-in users can open this.' : 'Only members of the user groups you pick below.')}
                  </div>
                </div>
              </button>
            )
          })}
        </div>

        {lockType === 'restricted' && (
          <div className="border-t border-gray-100 p-3 space-y-2 bg-gray-50/60">
            <div className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold">
              {t('course.lock.usergroups_header', 'User groups')}
            </div>
            {assignedGroups.length === 0 ? (
              <div className="text-xs text-gray-500">
                {t('course.lock.usergroups_none_assigned', 'No groups assigned — nobody but admins can open this.')}
              </div>
            ) : (
              <div className="space-y-1">
                {assignedGroups.map((g) => (
                  <div
                    key={g.usergroup_uuid}
                    className="flex items-center justify-between gap-2 px-2 py-1.5 bg-white rounded-md border border-gray-200/70"
                  >
                    <span className="text-xs text-gray-700 truncate">{g.name}</span>
                    <button
                      type="button"
                      onClick={() => handleRemove(g.usergroup_uuid)}
                      className="text-gray-400 hover:text-red-600 transition-colors"
                      title={t('course.lock.usergroups_remove_title', 'Remove')}
                    >
                      <X size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="pt-1">
              {loadingGroups ? (
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <Loader2 size={12} className="animate-spin" /> {t('course.lock.usergroups_loading', 'Loading groups…')}
                </div>
              ) : available.length === 0 ? (
                <div className="text-xs text-gray-400">
                  {(!allGroups || allGroups.length === 0)
                    ? t('course.lock.usergroups_none_in_org', 'No user groups exist yet in this org.')
                    : t('course.lock.usergroups_all_assigned', 'All groups are already assigned.')}
                </div>
              ) : (
                <div className="space-y-1">
                  <div className="text-[11px] text-gray-500">
                    {t('course.lock.usergroups_add_a_group', 'Add a group')}
                  </div>
                  <div className="max-h-32 overflow-y-auto space-y-1 pr-0.5">
                    {available.map((g) => (
                      <button
                        key={g.usergroup_uuid}
                        type="button"
                        onClick={() => handleAdd(g.usergroup_uuid)}
                        className="w-full flex items-center justify-between gap-2 px-2 py-1.5 bg-white hover:bg-blue-50 rounded-md border border-gray-200/70 transition-colors"
                      >
                        <span className="text-xs text-gray-700 truncate">{g.name}</span>
                        <Plus size={13} className="text-gray-400" />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
