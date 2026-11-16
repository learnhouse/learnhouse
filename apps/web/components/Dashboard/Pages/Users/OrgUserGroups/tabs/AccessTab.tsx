'use client'
import React, { useState } from 'react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import {
  Books,
  CalendarBlank,
  ChalkboardTeacher,
  Circuitry,
  Folder,
  Garage,
  Headphones,
  ImageSquare,
  Key,
  Plus,
  Trash,
  VideoCamera,
} from '@phosphor-icons/react'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import { Button, Chip, EmptyState, FieldLabel, INPUT, SearchInput, SegmentedControl } from '@components/Dashboard/Shared/DashKit/DashKit'
import { CheckBox, RowSkeleton, useDebounced } from '../../usersUi'
import { dateInput, formatDate, ugKeys, useInvalidateGroups, useUG, type GroupDetail } from '../groupsApi'

export const KIND_META: Record<string, { icon: React.ReactNode; tile: string }> = {
  course: { icon: <Books size={16} weight="duotone" />, tile: 'bg-sky-50 text-sky-600' },
  path: { icon: <Circuitry size={16} weight="duotone" />, tile: 'bg-indigo-50 text-indigo-600' },
  community: { icon: <Garage size={16} weight="duotone" />, tile: 'bg-emerald-50 text-emerald-600' },
  podcast: { icon: <Headphones size={16} weight="duotone" />, tile: 'bg-rose-50 text-rose-600' },
  live_session: { icon: <VideoCamera size={16} weight="duotone" />, tile: 'bg-orange-50 text-orange-600' },
  board: { icon: <ChalkboardTeacher size={16} weight="duotone" />, tile: 'bg-amber-50 text-amber-600' },
  folder: { icon: <Folder size={16} weight="duotone" />, tile: 'bg-teal-50 text-teal-600' },
  media: { icon: <ImageSquare size={16} weight="duotone" />, tile: 'bg-violet-50 text-violet-600' },
}
const KINDS = ['all', 'course', 'path', 'community', 'podcast', 'live_session', 'board', 'folder', 'media'] as const

export function KindTile({ kind }: { kind: string }) {
  const meta = KIND_META[kind] ?? KIND_META.course
  return <span className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${meta.tile}`}>{meta.icon}</span>
}

export default function AccessTab({ group }: { group: GroupDetail }) {
  const { t, i18n } = useTranslation()
  const { call } = useUG()
  const invalidate = useInvalidateGroups()
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<any | null>(null)
  const canEdit = group.capabilities.admin
  const { data, isLoading, refetch } = useQuery({ queryKey: ugKeys.access(group.id), queryFn: () => call<{ items: any[] }>('GET', `${group.id}/access`) })
  const items = data?.items ?? []

  const remove = async (uuid: string) => {
    try {
      await call('POST', `${group.id}/access/remove`, { resource_uuids: [uuid] })
      refetch()
      invalidate(group.id)
    } catch (e: any) {
      toast.error(e.message)
    }
  }
  const tone: Record<string, 'emerald' | 'sky' | 'neutral'> = { active: 'emerald', scheduled: 'sky', expired: 'neutral' }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <p className="text-sm text-neutral-500 flex-1">
          {group.parent ? t('groups.access.intro_nested', { name: group.parent.name }) : t('groups.access.intro')}
        </p>
        {canEdit && (
          <Button variant="primary" icon={<Plus size={14} />} onClick={() => setAdding(true)} data-testid="add-access">
            {t('groups.access.add')}
          </Button>
        )}
      </div>
      <div className="bg-white rounded-2xl nice-shadow overflow-hidden">
        {isLoading ? (
          <RowSkeleton rows={3} />
        ) : items.length === 0 ? (
          <EmptyState icon={<Key size={22} />} title={t('groups.access.empty')} description={t('groups.access.empty_hint')} />
        ) : (
          <ul className="divide-y divide-neutral-100">
            {items.map((it) => (
              <li key={it.resource_uuid} className="flex items-center gap-3 px-4 sm:px-5 py-3">
                <KindTile kind={it.kind} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-neutral-900 truncate" dir="auto">
                    {it.name}
                  </p>
                  <p className="text-xs text-neutral-500 truncate">
                    {t(`groups.access.kinds.${it.kind}`, { defaultValue: it.kind })}
                    {it.starts_at || it.expires_at ? ' · ' : ''}
                    {it.starts_at ? t('groups.access.from', { date: formatDate(it.starts_at, i18n.language) }) : ''}
                    {it.starts_at && it.expires_at ? ' ' : ''}
                    {it.expires_at ? t('groups.access.until', { date: formatDate(it.expires_at, i18n.language) }) : ''}
                  </p>
                </div>
                <Chip tone={tone[it.status] ?? 'neutral'}>{t(`groups.access.status.${it.status}`)}</Chip>
                {canEdit && (
                  <span className="flex items-center gap-0.5 shrink-0">
                    <button type="button" onClick={() => setEditing(it)} aria-label={t('groups.access.edit_window')} title={t('groups.access.edit_window')} className="h-8 w-8 inline-flex items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-100">
                      <CalendarBlank size={15} />
                    </button>
                    <button type="button" onClick={() => remove(it.resource_uuid)} aria-label={t('groups.access.remove')} title={t('groups.access.remove')} className="h-8 w-8 inline-flex items-center justify-center rounded-lg text-neutral-500 hover:text-rose-600 hover:bg-rose-50">
                      <Trash size={15} />
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="text-xs text-neutral-500">{t('groups.access.footnote')}</p>
      <AddAccessDialog group={group} open={adding} onOpenChange={setAdding} onDone={() => refetch()} />
      <WindowDialog group={group} item={editing} onClose={() => setEditing(null)} onDone={() => refetch()} />
    </div>
  )
}

function AddAccessDialog({ group, open, onOpenChange, onDone }: { group: GroupDetail; open: boolean; onOpenChange: (_open: boolean) => void; onDone: () => void }) {
  const { t } = useTranslation()
  const { call } = useUG()
  const invalidate = useInvalidateGroups()
  const [q, setQ] = useState('')
  const [kind, setKind] = useState<(typeof KINDS)[number]>('all')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [starts, setStarts] = useState('')
  const [ends, setEnds] = useState('')
  const [saving, setSaving] = useState(false)
  const search = useDebounced(q.trim(), 250)
  const { data, isLoading } = useQuery({
    queryKey: ['usergroups', 'v2', 'access-options', group.id, search, kind],
    queryFn: () => call<{ items: any[] }>('GET', `${group.id}/access/options?q=${encodeURIComponent(search)}&kind=${kind === 'all' ? '' : kind}`),
    enabled: open,
  })
  const options = data?.items ?? []
  const toggle = (uuid: string) =>
    setPicked((p) => {
      const n = new Set(p)
      if (n.has(uuid)) n.delete(uuid)
      else n.add(uuid)
      return n
    })
  const submit = async () => {
    setSaving(true)
    try {
      const out = await call<{ results: any[] }>('POST', `${group.id}/access`, { resource_uuids: Array.from(picked), starts_at: starts || null, expires_at: ends || null })
      const ok = out.results.filter((r) => ['linked', 'window_updated', 'already_linked'].includes(r.result)).length
      toast.success(t('groups.access.added', { count: ok }))
      invalidate(group.id)
      onDone()
      setPicked(new Set())
      setStarts('')
      setEnds('')
      onOpenChange(false)
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setSaving(false)
    }
  }
  return (
    <Modal
      isDialogOpen={open}
      onOpenChange={onOpenChange}
      size="lg"
      icon={<Key size={16} />}
      dialogTitle={t('groups.access.add_title')}
      dialogDescription={t('groups.access.add_desc')}
      footer={
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-neutral-500">{t('dashboard.users.active_users.selection.selected', { count: picked.size })}</span>
          <div className="flex gap-2">
            <Button onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
            <Button variant="primary" disabled={!picked.size} loading={saving} onClick={submit} data-testid="confirm-add-access">
              {t('groups.access.add')}
            </Button>
          </div>
        </div>
      }
      dialogContent={
        <div className="flex flex-col gap-4">
          <SearchInput value={q} onChange={setQ} placeholder={t('groups.access.search')} />
          <div className="overflow-x-auto -mx-1 px-1">
            <SegmentedControl
              value={kind}
              onChange={setKind}
              ariaLabel={t('groups.access.kind_filter')}
              options={KINDS.map((k) => ({ key: k, label: k === 'all' ? t('groups.list.all') : t(`groups.access.kinds.${k}`) }))}
            />
          </div>
          <div className="rounded-xl ring-1 ring-inset ring-neutral-200 max-h-72 overflow-y-auto">
            {isLoading ? (
              <RowSkeleton rows={3} />
            ) : options.length === 0 ? (
              <p className="px-4 py-6 text-sm text-neutral-500 text-center">{t('dashboard.users.usergroups.no_results')}</p>
            ) : (
              <ul className="divide-y divide-neutral-100">
                {options.map((o) => (
                  <li key={o.resource_uuid}>
                    <button type="button" role="checkbox" aria-checked={picked.has(o.resource_uuid)} onClick={() => toggle(o.resource_uuid)} className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-neutral-50 text-start">
                      <CheckBox indicator checked={picked.has(o.resource_uuid)} label={o.name} />
                      <KindTile kind={o.kind} />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-neutral-900 truncate" dir="auto">
                          {o.name}
                        </span>
                        <span className="block text-xs text-neutral-500">
                          {o.kind === 'path' ? t('groups.access.path_hint') : t(`groups.access.kinds.${o.kind}`)}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="block">
              <FieldLabel hint={t('groups.members.now')}>{t('groups.access.starts')}</FieldLabel>
              <input type="date" className={INPUT} value={starts} onChange={(e) => setStarts(e.target.value)} />
            </label>
            <label className="block">
              <FieldLabel hint={t('groups.members.no_end')}>{t('groups.access.ends')}</FieldLabel>
              <input type="date" className={INPUT} value={ends} onChange={(e) => setEnds(e.target.value)} />
            </label>
          </div>
        </div>
      }
    />
  )
}

function WindowDialog({ group, item, onClose, onDone }: { group: GroupDetail; item: any | null; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation()
  const { call } = useUG()
  const [starts, setStarts] = useState('')
  const [ends, setEnds] = useState('')
  const [last, setLast] = useState<string | null>(null)
  if (item && item.resource_uuid !== last) {
    setLast(item.resource_uuid)
    setStarts(dateInput(item.starts_at))
    setEnds(dateInput(item.expires_at))
  }
  const save = async () => {
    try {
      await call('POST', `${group.id}/access`, { resource_uuids: [item.resource_uuid], starts_at: starts || null, expires_at: ends || null })
      onDone()
      onClose()
    } catch (e: any) {
      toast.error(e.message)
    }
  }
  return (
    <Modal
      isDialogOpen={!!item}
      onOpenChange={(o) => !o && onClose()}
      size="sm"
      icon={<CalendarBlank size={16} />}
      dialogTitle={t('groups.access.edit_window')}
      dialogDescription={item?.name}
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={save}>
            {t('common.save')}
          </Button>
        </div>
      }
      dialogContent={
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="block">
            <FieldLabel hint={t('groups.members.now')}>{t('groups.access.starts')}</FieldLabel>
            <input type="date" className={INPUT} value={starts} onChange={(e) => setStarts(e.target.value)} />
          </label>
          <label className="block">
            <FieldLabel hint={t('groups.members.no_end')}>{t('groups.access.ends')}</FieldLabel>
            <input type="date" className={INPUT} value={ends} onChange={(e) => setEnds(e.target.value)} />
          </label>
        </div>
      }
    />
  )
}
