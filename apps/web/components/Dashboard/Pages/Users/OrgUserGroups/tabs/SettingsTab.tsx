'use client'
import React, { useState } from 'react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { Bell, Browser, PencilSimple, ShieldCheck, TreeStructure, UserPlus, X } from '@phosphor-icons/react'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import {
  Button,
  FieldLabel,
  INPUT,
  SearchInput,
  SectionCard,
  SettingRow,
  StickySaveBar,
  TEXTAREA,
} from '@components/Dashboard/Shared/DashKit/DashKit'
import { PersonCell, RowSkeleton, useDebounced } from '../../usersUi'
import { GROUP_COLORS, personName, useGroupsOverview, useInvalidateGroups, useUG, type GroupDetail } from '../groupsApi'
import { ProChip, Toggle } from '../ugUi'

export default function SettingsTab({ group }: { group: GroupDetail }) {
  const { t } = useTranslation()
  const { call } = useUG()
  const invalidate = useInvalidateGroups()
  const { data: overview } = useGroupsOverview()
  const [name, setName] = useState(group.name)
  const [description, setDescription] = useState(group.description)
  const [color, setColor] = useState(group.color || '')
  const [parent, setParent] = useState(group.parent?.usergroup_uuid || '')
  const [settings, setSettings] = useState(group.settings)
  const [saving, setSaving] = useState(false)
  const f = group.features

  const dirty =
    name !== group.name ||
    description !== group.description ||
    color !== (group.color || '') ||
    parent !== (group.parent?.usergroup_uuid || '') ||
    JSON.stringify(settings) !== JSON.stringify(group.settings)

  // A group can't sit under itself or one of its own sub-groups.
  const blocked = new Set<number>([group.id, ...group.children.map((c) => c.id)])
  const parents = (overview?.items ?? []).filter((g) => !blocked.has(g.id) && g.parent_id !== group.id)

  const save = async () => {
    setSaving(true)
    try {
      const body: any = { name, description, color, settings }
      if (parent !== (group.parent?.usergroup_uuid || '')) body.parent_uuid = parent
      await call('PUT', `${group.id}/settings`, body)
      toast.success(t('groups.settings.saved'))
      invalidate(group.id)
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setSaving(false)
    }
  }
  const set = (k: keyof typeof settings, v: any) => setSettings((s) => ({ ...s, [k]: v }))

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 items-start">
      <div className="flex flex-col gap-5 min-w-0">
        <SectionCard icon={<PencilSimple size={18} className="text-sky-600" />} title={t('groups.settings.details')} description={t('groups.settings.details_desc')}>
          <div className="flex flex-col gap-4">
            <label className="block">
              <FieldLabel>{t('groups.fields.name')}</FieldLabel>
              <input className={INPUT} value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="block">
              <FieldLabel hint={t('common.optional')}>{t('groups.fields.description')}</FieldLabel>
              <textarea className={TEXTAREA} rows={3} maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} />
            </label>
            <div>
              <FieldLabel>{t('groups.fields.color')}</FieldLabel>
              <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label={t('groups.fields.color')}>
                {Object.entries(GROUP_COLORS).map(([key, c]) => (
                  <button
                    key={key}
                    type="button"
                    role="radio"
                    aria-checked={color === key}
                    aria-label={key}
                    onClick={() => setColor(key)}
                    className={`w-6 h-6 rounded-full ${c.dot} ${color === key ? 'ring-2 ring-offset-2 ring-neutral-900' : 'hover:scale-110 transition-transform'}`}
                  />
                ))}
              </div>
            </div>
          </div>
        </SectionCard>

        <SectionCard
          icon={<TreeStructure size={18} className="text-amber-600" />}
          title={t('groups.settings.nesting')}
          description={t('groups.settings.nesting_desc')}
          actions={!f.nesting ? <ProChip /> : undefined}
        >
          <select className={`${INPUT} cursor-pointer`} value={parent} disabled={!f.nesting} onChange={(e) => setParent(e.target.value)} aria-label={t('groups.fields.parent')}>
            <option value="">{t('groups.settings.no_parent')}</option>
            {parents.map((g) => (
              <option key={g.id} value={g.usergroup_uuid}>
                {g.name}
              </option>
            ))}
          </select>
          {group.children.length > 0 && (
            <p className="mt-3 text-xs text-neutral-500">
              {t('groups.settings.children', { names: group.children.map((c) => c.name).join(', ') })}
            </p>
          )}
        </SectionCard>
      </div>

      <div className="flex flex-col gap-5 min-w-0">
        <SectionCard
          icon={<Browser size={18} className="text-violet-600" />}
          title={t('groups.settings.space')}
          description={t('groups.settings.space_desc')}
          actions={!f.space ? <ProChip /> : undefined}
        >
          <div className="divide-y divide-neutral-100">
            <SettingRow
              title={t('groups.settings.space_enabled')}
              description={t('groups.settings.space_enabled_desc')}
              control={<Toggle checked={settings.space_enabled} disabled={!f.space} onChange={(v) => set('space_enabled', v)} label={t('groups.settings.space_enabled')} />}
            />
            <SettingRow
              title={t('groups.settings.show_members')}
              description={t('groups.settings.show_members_desc')}
              control={<Toggle checked={settings.space_show_members} disabled={!f.space} onChange={(v) => set('space_show_members', v)} label={t('groups.settings.show_members')} />}
            />
          </div>
        </SectionCard>

        <SectionCard icon={<Bell size={18} className="text-amber-600" />} title={t('groups.settings.notifications')} description={t('groups.settings.notifications_desc')}>
          <div className="divide-y divide-neutral-100">
            <SettingRow
              title={t('groups.settings.notify_join')}
              control={<Toggle checked={settings.notify_on_join} onChange={(v) => set('notify_on_join', v)} label={t('groups.settings.notify_join')} />}
            />
            <SettingRow
              title={t('groups.settings.notify_leave')}
              control={<Toggle checked={settings.notify_on_leave} onChange={(v) => set('notify_on_leave', v)} label={t('groups.settings.notify_leave')} />}
            />
          </div>
        </SectionCard>

        <ManagersCard group={group} />
      </div>

      <StickySaveBar
        visible={dirty}
        saving={saving}
        onSave={save}
        disabled={!name.trim()}
        onDiscard={() => {
          setName(group.name)
          setDescription(group.description)
          setColor(group.color || '')
          setParent(group.parent?.usergroup_uuid || '')
          setSettings(group.settings)
        }}
      />
    </div>
  )
}

function ManagersCard({ group }: { group: GroupDetail }) {
  const { t } = useTranslation()
  const { call } = useUG()
  const invalidate = useInvalidateGroups()
  const [picking, setPicking] = useState(false)
  const locked = !group.features.managers

  const setRights = async (m: GroupDetail['managers'][number], patch: Partial<GroupDetail['managers'][number]>) => {
    try {
      await call('POST', `${group.id}/managers`, {
        user_id: m.id,
        can_manage_members: m.can_manage_members,
        can_view_progress: m.can_view_progress,
        can_post: m.can_post,
        digest: m.digest,
        ...patch,
      })
      invalidate(group.id)
    } catch (e: any) {
      toast.error(e.message)
    }
  }
  const remove = async (id: number) => {
    try {
      await call('DELETE', `${group.id}/managers/${id}`)
      invalidate(group.id)
    } catch (e: any) {
      toast.error(e.message)
    }
  }
  const rights: { key: 'can_manage_members' | 'can_view_progress' | 'can_post' | 'digest'; label: string }[] = [
    { key: 'can_manage_members', label: t('groups.managers.rights.members') },
    { key: 'can_view_progress', label: t('groups.managers.rights.progress') },
    { key: 'can_post', label: t('groups.managers.rights.post') },
    { key: 'digest', label: t('groups.managers.rights.digest') },
  ]

  return (
    <SectionCard
      icon={<ShieldCheck size={18} className="text-emerald-600" />}
      title={t('groups.managers.title')}
      description={t('groups.managers.desc')}
      actions={
        locked ? (
          <ProChip />
        ) : (
          <Button size="sm" icon={<UserPlus size={13} />} onClick={() => setPicking(true)} data-testid="add-manager">
            {t('groups.managers.add')}
          </Button>
        )
      }
      bodyClassName="px-5 pb-5 pt-3"
    >
      {group.managers.length === 0 ? (
        <p className="text-sm text-neutral-400">{t('groups.managers.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {group.managers.map((m) => (
            <li key={m.id} className="rounded-xl ring-1 ring-inset ring-neutral-200 p-3">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <PersonCell user={m} size={30} popup={false} />
                </div>
                <button type="button" onClick={() => remove(m.id)} aria-label={t('groups.managers.remove', { name: personName(m) })} className="h-8 w-8 inline-flex items-center justify-center rounded-lg text-neutral-400 hover:text-rose-600 hover:bg-rose-50">
                  <X size={14} weight="bold" />
                </button>
              </div>
              <div className="mt-2.5 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2">
                {rights.map((r) => (
                  <label key={r.key} className="flex items-center justify-between gap-2 text-xs text-neutral-600">
                    <span>{r.label}</span>
                    <Toggle checked={!!m[r.key]} onChange={(v) => setRights(m, { [r.key]: v })} label={r.label} />
                  </label>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
      <PickManagerDialog group={group} open={picking} onOpenChange={setPicking} />
    </SectionCard>
  )
}

function PickManagerDialog({ group, open, onOpenChange }: { group: GroupDetail; open: boolean; onOpenChange: (_open: boolean) => void }) {
  const { t } = useTranslation()
  const { call } = useUG()
  const invalidate = useInvalidateGroups()
  const [q, setQ] = useState('')
  const search = useDebounced(q.trim(), 250)
  const { data, isLoading } = useQuery({
    queryKey: ['usergroups', 'v2', 'members', group.id, 'pick-manager', search],
    queryFn: () => call<any>('GET', `${group.id}/members?per_page=20&q=${encodeURIComponent(search)}`),
    enabled: open,
  })
  const taken = new Set(group.managers.map((m) => m.id))
  const rows = (data?.items ?? []).filter((m: any) => !taken.has(m.id))
  const pick = async (id: number) => {
    try {
      await call('POST', `${group.id}/managers`, { user_id: id })
      toast.success(t('groups.managers.added'))
      invalidate(group.id)
      onOpenChange(false)
    } catch (e: any) {
      toast.error(e.message)
    }
  }
  return (
    <Modal
      isDialogOpen={open}
      onOpenChange={onOpenChange}
      size="sm"
      icon={<ShieldCheck size={16} />}
      dialogTitle={t('groups.managers.add_title')}
      dialogDescription={t('groups.managers.add_desc')}
      dialogContent={
        <div className="flex flex-col gap-3">
          <SearchInput value={q} onChange={setQ} placeholder={t('groups.members.search')} />
          <div className="rounded-xl ring-1 ring-inset ring-neutral-200 max-h-72 overflow-y-auto">
            {isLoading ? (
              <RowSkeleton rows={3} />
            ) : rows.length === 0 ? (
              <p className="px-4 py-6 text-sm text-neutral-500 text-center">{t('groups.managers.no_members')}</p>
            ) : (
              <ul className="divide-y divide-neutral-100">
                {rows.map((m: any) => (
                  <li key={m.id}>
                    <button type="button" onClick={() => pick(m.id)} className="w-full px-3 py-2.5 hover:bg-neutral-50 text-start" data-testid={`pick-manager-${m.username}`}>
                      <PersonCell user={m} size={30} popup={false} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      }
    />
  )
}
