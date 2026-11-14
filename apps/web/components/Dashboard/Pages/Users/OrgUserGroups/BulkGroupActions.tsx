'use client'
import React, { useState } from 'react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { ArrowsLeftRight, UsersThree } from '@phosphor-icons/react'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import { BulkActionButton, Button, FieldLabel, INPUT, SegmentedControl } from '@components/Dashboard/Shared/DashKit/DashKit'
import { CheckBox } from '../usersUi'
import { useGroupsOverview, useInvalidateGroups, useUG } from './groupsApi'
import { GroupTile } from './ugUi'

type Action = 'add' | 'remove' | 'move'

/** Users table: add the selected people to groups, remove them, or move them. */
export default function BulkGroupActions({ userIds, onDone }: { userIds: number[]; onDone: () => void }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  return (
    <>
      <BulkActionButton icon={<UsersThree size={14} />} label={t('groups.bulk.button')} onClick={() => setOpen(true)} />
      {open && <BulkGroupDialog userIds={userIds} onClose={() => setOpen(false)} onDone={onDone} />}
    </>
  )
}

function BulkGroupDialog({ userIds, onClose, onDone }: { userIds: number[]; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation()
  const { call, orgId } = useUG()
  const invalidate = useInvalidateGroups()
  const { data } = useGroupsOverview()
  const groups = (data?.items ?? []).filter((g) => g.kind !== 'smart')
  const [action, setAction] = useState<Action>('add')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [ends, setEnds] = useState('')
  const [saving, setSaving] = useState(false)

  const toggle = (uuid: string) =>
    setPicked((p) => {
      const n = new Set(p)
      if (n.has(uuid)) n.delete(uuid)
      else n.add(uuid)
      return n
    })
  const ready = action === 'move' ? !!from && !!to && from !== to : picked.size > 0
  const submit = async () => {
    setSaving(true)
    try {
      const body =
        action === 'move'
          ? { action, user_ids: userIds, usergroup_uuids: [to], from_usergroup_uuid: from }
          : { action, user_ids: userIds, usergroup_uuids: Array.from(picked), expires_at: action === 'add' && ends ? ends : null }
      const out = await call<any>('POST', `org/${orgId}/bulk`, body)
      const total = Object.values(out.groups || {}).reduce((n: number, g: any) => n + (g.count || 0), 0)
      toast.success(t(`groups.bulk.done_${action}`, { count: total }))
      invalidate()
      onDone()
      onClose()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      isDialogOpen
      onOpenChange={(o) => !o && onClose()}
      size="md"
      icon={<UsersThree size={16} />}
      dialogTitle={t('groups.bulk.title', { count: userIds.length })}
      dialogDescription={t('groups.bulk.desc')}
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant={action === 'remove' ? 'danger' : 'primary'} disabled={!ready} loading={saving} onClick={submit}>
            {t(`groups.bulk.submit_${action}`)}
          </Button>
        </div>
      }
      dialogContent={
        <div className="flex flex-col gap-4">
          <SegmentedControl<Action>
            value={action}
            onChange={setAction}
            ariaLabel={t('groups.bulk.title', { count: userIds.length })}
            options={[
              { key: 'add', label: t('groups.bulk.add') },
              { key: 'remove', label: t('groups.bulk.remove') },
              { key: 'move', label: t('groups.bulk.move') },
            ]}
          />
          {action === 'move' ? (
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] items-end gap-3">
              <label className="block">
                <FieldLabel>{t('groups.bulk.from')}</FieldLabel>
                <select className={`${INPUT} cursor-pointer`} value={from} onChange={(e) => setFrom(e.target.value)}>
                  <option value="">{t('groups.create.pick_parent')}</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.usergroup_uuid}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </label>
              <ArrowsLeftRight size={16} className="hidden sm:block text-neutral-400 mb-2.5" />
              <label className="block">
                <FieldLabel>{t('groups.bulk.to')}</FieldLabel>
                <select className={`${INPUT} cursor-pointer`} value={to} onChange={(e) => setTo(e.target.value)}>
                  <option value="">{t('groups.create.pick_parent')}</option>
                  {groups.filter((g) => g.usergroup_uuid !== from).map((g) => (
                    <option key={g.id} value={g.usergroup_uuid}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : (
            <div className="rounded-xl ring-1 ring-inset ring-neutral-200 max-h-64 overflow-y-auto">
              {groups.length === 0 ? (
                <p className="px-4 py-6 text-sm text-neutral-500 text-center">{t('dashboard.users.usergroups.no_groups')}</p>
              ) : (
                <ul className="divide-y divide-neutral-100">
                  {groups.map((g) => (
                    <li key={g.id}>
                      <button type="button" role="checkbox" aria-checked={picked.has(g.usergroup_uuid)} onClick={() => toggle(g.usergroup_uuid)} className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-neutral-50 text-start">
                        <CheckBox indicator checked={picked.has(g.usergroup_uuid)} label={g.name} />
                        <GroupTile color={g.color} kind={g.kind} size={28} />
                        <span className="text-sm font-medium text-neutral-900 truncate" dir="auto">
                          {g.name}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {action === 'add' && (
            <label className="block">
              <FieldLabel hint={t('groups.members.no_end')}>{t('groups.members.ends')}</FieldLabel>
              <input type="date" className={INPUT} value={ends} onChange={(e) => setEnds(e.target.value)} />
            </label>
          )}
          <p className="text-xs text-neutral-500">{t('groups.bulk.smart_note')}</p>
        </div>
      }
    />
  )
}
