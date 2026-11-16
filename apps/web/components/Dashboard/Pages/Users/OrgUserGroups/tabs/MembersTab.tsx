'use client'
import React, { useState } from 'react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import {
  CalendarBlank,
  CalendarPlus,
  Copy,
  DotsThree,
  Key,
  Lightning,
  Link as LinkIcon,
  Plus,
  Prohibit,
  Ticket,
  Trash,
  UserMinus,
  UserPlus,
  UsersThree,
} from '@phosphor-icons/react'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import {
  Button,
  Chip,
  ConfirmDialog,
  EmptyState,
  FieldLabel,
  INPUT,
  SearchInput,
  SectionCard,
  ToolbarSelect,
} from '@components/Dashboard/Shared/DashKit/DashKit'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@components/ui/dropdown-menu'
import { getAPIUrl, getUriWithOrg } from '@services/config/config'
import { apiFetch, asArray } from '@services/utils/ts/requests'
import { CheckBox, ListPager, PersonCell, RowSkeleton, useDebounced } from '../../usersUi'
import { dateInput, formatDate, personName, ugKeys, useInvalidateGroups, useUG, type GroupDetail } from '../groupsApi'
import { SourceChips } from '../ugUi'

const PER_PAGE = 50

export default function MembersTab({ group }: { group: GroupDetail }) {
  const { t, i18n } = useTranslation()
  const { call } = useUG()
  const invalidate = useInvalidateGroups()
  const [q, setQ] = useState('')
  const [source, setSource] = useState('')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState<number[] | null>(null)
  const [expiring, setExpiring] = useState<any | null>(null)
  const search = useDebounced(q.trim(), 250)
  const canEdit = group.capabilities.members
  const smartOnly = group.kind === 'smart'

  const { data, isLoading } = useQuery({
    queryKey: ugKeys.members(group.id, search, source, page),
    queryFn: () =>
      call<any>('GET', `${group.id}/members?page=${page}&per_page=${PER_PAGE}&q=${encodeURIComponent(search)}&source=${source}`),
    placeholderData: (p) => p,
  })
  const items: any[] = data?.items ?? []
  const scheduled: any[] = data?.scheduled ?? []

  const remove = async (ids: number[]) => {
    try {
      const out = await call<any>('POST', `${group.id}/members/remove`, { user_ids: ids })
      if (out.kept?.length) toast(t('groups.members.kept_notice', { count: out.kept.length }), { icon: '⚡' })
      if (out.removed?.length) toast.success(t('groups.members.removed', { count: out.removed.length }))
      setSelected(new Set())
      invalidate(group.id)
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  const cancelSchedule = async (id: number) => {
    try {
      await call('DELETE', `${group.id}/schedules/${id}`)
      invalidate(group.id)
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  const toggle = (id: number) =>
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  const sources = Object.keys(group.members_by_source || {})

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px] gap-5 items-start">
      <div className="flex flex-col gap-4 min-w-0">
        {smartOnly && (
          <div className="flex items-start gap-3 rounded-2xl bg-violet-50 ring-1 ring-inset ring-violet-600/10 px-4 py-3">
            <Lightning size={18} weight="fill" className="text-violet-600 mt-0.5 shrink-0" />
            <p className="text-sm text-violet-900">{t('groups.members.smart_notice')}</p>
          </div>
        )}
        <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
          <SearchInput
            value={q}
            onChange={(v) => {
              setQ(v)
              setPage(1)
            }}
            placeholder={t('groups.members.search')}
            className="sm:max-w-xs"
          />
          {sources.length > 1 && (
            <div className="self-start sm:self-auto">
            <ToolbarSelect
              value={source}
              onChange={(v) => {
                setSource(v)
                setPage(1)
              }}
              ariaLabel={t('groups.members.filter_source')}
              options={[
                { value: '', label: t('groups.members.all_sources') },
                ...sources.map((s) => ({ value: s, label: `${t(`groups.sources.${s}`)} · ${group.members_by_source[s]}` })),
              ]}
            />
            </div>
          )}
          {canEdit && !smartOnly && (
            <Button variant="primary" icon={<UserPlus size={14} />} onClick={() => setAdding(true)} className="sm:ms-auto" data-testid="add-members">
              {t('groups.members.add')}
            </Button>
          )}
        </div>

        <div className="bg-white rounded-2xl nice-shadow overflow-hidden">
          {isLoading && !data ? (
            <RowSkeleton rows={4} />
          ) : items.length === 0 ? (
            <EmptyState
              icon={<UsersThree size={22} />}
              title={search ? t('dashboard.users.usergroups.no_results') : t('groups.members.empty')}
              description={search ? undefined : smartOnly ? t('groups.members.empty_smart') : t('groups.members.empty_hint')}
            />
          ) : (
            <ul className="divide-y divide-neutral-100">
              {items.map((m) => {
                const direct = (m.sources || []).some((s: string) => ['manual', 'code', 'import', 'domain'].includes(s))
                return (
                  <li key={m.id} className="flex items-center gap-3 px-4 sm:px-5 py-3">
                    {canEdit && direct && (
                      <CheckBox checked={selected.has(m.id)} onChange={() => toggle(m.id)} label={personName(m)} />
                    )}
                    <div className="min-w-0 flex-1">
                      <PersonCell user={m} size={34} />
                    </div>
                    <div className="hidden md:flex flex-col items-end gap-1 shrink-0">
                      <SourceChips sources={m.sources || []} />
                      {m.expires_at && (
                        <span className="inline-flex items-center gap-1 text-xs text-amber-700">
                          <CalendarBlank size={12} /> {t('groups.members.leaves_on', { date: formatDate(m.expires_at, i18n.language) })}
                        </span>
                      )}
                    </div>
                    {canEdit && direct && (
                      <DropdownMenu modal={false}>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            aria-label={t('dashboard.users.active_users.table.actions')}
                            className="h-8 w-8 inline-flex items-center justify-center rounded-lg text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100 shrink-0"
                          >
                            <DotsThree size={16} weight="bold" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-52 rounded-xl p-1.5">
                          <DropdownMenuItem onSelect={() => setExpiring(m)} className="flex items-center gap-2 cursor-pointer">
                            <CalendarPlus size={15} /> {t('groups.members.set_end')}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onSelect={() => setRemoving([m.id])} className="flex items-center gap-2 cursor-pointer text-rose-600 focus:text-rose-700 focus:bg-rose-50">
                            <UserMinus size={15} /> {t('groups.members.remove')}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
          <ListPager page={page} total={data?.total ?? 0} pageSize={PER_PAGE} onPage={setPage} />
        </div>

        {selected.size > 0 && (
          <div className="flex items-center gap-3 rounded-2xl bg-neutral-900 text-white ps-4 pe-2 py-2 self-start">
            <span className="text-sm font-semibold">{t('dashboard.users.active_users.selection.selected', { count: selected.size })}</span>
            <Button size="sm" variant="danger" icon={<Trash size={13} />} onClick={() => setRemoving(Array.from(selected))}>
              {t('groups.members.remove')}
            </Button>
          </div>
        )}

        {scheduled.length > 0 && (
          <SectionCard icon={<CalendarPlus size={18} className="text-sky-600" />} title={t('groups.members.scheduled_title')} description={t('groups.members.scheduled_desc')} bodyClassName="px-5 pb-4 pt-3">
            <ul className="divide-y divide-neutral-100">
              {scheduled.map((s) => (
                <li key={s.id} className="flex items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <PersonCell user={s.user} size={30} secondary={t('groups.members.joins_on', { date: formatDate(s.starts_at, i18n.language) })} />
                  </div>
                  {canEdit && (
                    <Button size="sm" variant="ghost" onClick={() => cancelSchedule(s.id)}>
                      {t('common.cancel')}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </SectionCard>
        )}
      </div>

      <div className="flex flex-col gap-5 min-w-0">
        <SummaryCard group={group} />
        {group.capabilities.admin && !smartOnly && <JoinCodesCard group={group} />}
      </div>

      <AddMembersDialog group={group} open={adding} onOpenChange={setAdding} />
      <ExpiryDialog group={group} member={expiring} onClose={() => setExpiring(null)} />
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={t('groups.members.remove_title', { count: removing?.length ?? 0 })}
        message={t('groups.members.remove_message')}
        confirmLabel={t('groups.members.remove')}
        onConfirm={() => {
          const ids = removing
          setRemoving(null)
          if (ids) remove(ids)
        }}
      />
    </div>
  )
}

function SummaryCard({ group }: { group: GroupDetail }) {
  const { t } = useTranslation()
  const rows = Object.entries(group.members_by_source || {})
  return (
    <SectionCard icon={<UsersThree size={18} className="text-sky-600" />} title={t('groups.members.how_title')} description={t('groups.members.how_desc')} bodyClassName="px-5 pb-5 pt-3">
      {rows.length === 0 ? (
        <p className="text-sm text-neutral-400">{t('groups.members.none_yet')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map(([s, n]) => (
            <li key={s} className="flex items-center justify-between gap-3">
              <SourceChips sources={[s]} />
              <span className="text-sm font-semibold tabular-nums text-neutral-900">{n}</span>
            </li>
          ))}
        </ul>
      )}
      {group.pending_schedules > 0 && (
        <p className="mt-3 text-xs text-neutral-500">{t('groups.members.pending', { count: group.pending_schedules })}</p>
      )}
    </SectionCard>
  )
}

function JoinCodesCard({ group }: { group: GroupDetail }) {
  const { t, i18n } = useTranslation()
  const { call, org } = useUG()
  const [creating, setCreating] = useState(false)
  const { data, refetch } = useQuery({
    queryKey: ugKeys.codes(group.id),
    queryFn: () => call<{ items: any[] }>('GET', `${group.id}/codes`),
  })
  const codes = data?.items ?? []
  const joinUrl = (code: string) =>
    `${typeof window !== 'undefined' ? window.location.origin : ''}${getUriWithOrg(org?.slug, `/groups/join?code=${code}`).replace(/^https?:\/\/[^/]+/, '')}`
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(t('groups.codes.copied'))
    } catch {
      toast.error(t('groups.errors.generic'))
    }
  }
  const revoke = async (id: number) => {
    try {
      await call('PATCH', `${group.id}/codes/${id}`, { active: false })
      refetch()
    } catch (e: any) {
      toast.error(e.message)
    }
  }
  const tone: Record<string, 'emerald' | 'amber' | 'rose' | 'neutral'> = { active: 'emerald', full: 'amber', expired: 'neutral', revoked: 'rose' }
  return (
    <SectionCard
      icon={<Ticket size={18} className="text-emerald-600" />}
      title={t('groups.codes.title')}
      description={t('groups.codes.desc')}
      actions={
        <Button size="sm" icon={<Plus size={13} />} onClick={() => setCreating(true)} data-testid="new-code">
          {t('groups.codes.new')}
        </Button>
      }
      bodyClassName="px-5 pb-5 pt-3"
    >
      {codes.length === 0 ? (
        <p className="text-sm text-neutral-400">{t('groups.codes.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {codes.map((c) => (
            <li key={c.id} className="rounded-xl ring-1 ring-inset ring-neutral-200 px-3 py-2.5">
              <div className="flex items-center gap-2">
                <Key size={14} className="text-neutral-400" />
                <code className="font-mono text-sm font-bold tracking-wider text-neutral-900" data-testid="join-code">
                  {c.code}
                </code>
                <Chip tone={tone[c.status] ?? 'neutral'} className="!py-0.5 !text-[11px]">
                  {t(`groups.codes.status.${c.status}`)}
                </Chip>
                <span className="ms-auto flex items-center gap-0.5">
                  <button type="button" onClick={() => copy(c.code)} aria-label={t('groups.codes.copy_code')} title={t('groups.codes.copy_code')} className="h-7 w-7 inline-flex items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-100">
                    <Copy size={14} />
                  </button>
                  <button type="button" onClick={() => copy(joinUrl(c.code))} aria-label={t('groups.codes.copy_link')} title={t('groups.codes.copy_link')} className="h-7 w-7 inline-flex items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-100">
                    <LinkIcon size={14} />
                  </button>
                  {c.status === 'active' && (
                    <button type="button" onClick={() => revoke(c.id)} aria-label={t('groups.codes.revoke')} title={t('groups.codes.revoke')} className="h-7 w-7 inline-flex items-center justify-center rounded-lg text-neutral-500 hover:text-rose-600 hover:bg-rose-50">
                      <Prohibit size={14} />
                    </button>
                  )}
                </span>
              </div>
              <p className="mt-1 text-xs text-neutral-500">
                {[
                  c.label,
                  c.max_uses ? t('groups.codes.uses_of', { uses: c.uses, max: c.max_uses }) : t('groups.codes.uses', { count: c.uses }),
                  c.expires_at ? t('groups.codes.expires', { date: formatDate(c.expires_at, i18n.language) }) : null,
                  c.membership_days ? t('groups.codes.days', { count: c.membership_days }) : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </li>
          ))}
        </ul>
      )}
      <CodeDialog group={group} open={creating} onOpenChange={setCreating} onCreated={() => refetch()} />
    </SectionCard>
  )
}

function CodeDialog({ group, open, onOpenChange, onCreated }: { group: GroupDetail; open: boolean; onOpenChange: (_open: boolean) => void; onCreated: () => void }) {
  const { t } = useTranslation()
  const { call } = useUG()
  const [label, setLabel] = useState('')
  const [maxUses, setMaxUses] = useState('')
  const [expires, setExpires] = useState('')
  const [days, setDays] = useState('')
  const [saving, setSaving] = useState(false)
  const submit = async () => {
    setSaving(true)
    try {
      await call('POST', `${group.id}/codes`, {
        label,
        max_uses: maxUses ? Number(maxUses) : null,
        expires_at: expires || null,
        membership_days: days ? Number(days) : null,
      })
      toast.success(t('groups.codes.created'))
      onCreated()
      onOpenChange(false)
      setLabel('')
      setMaxUses('')
      setExpires('')
      setDays('')
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
      size="sm"
      icon={<Ticket size={16} />}
      dialogTitle={t('groups.codes.new_title')}
      dialogDescription={t('groups.codes.new_desc')}
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
          <Button variant="primary" loading={saving} onClick={submit} data-testid="create-code">
            {t('groups.codes.create')}
          </Button>
        </div>
      }
      dialogContent={
        <div className="flex flex-col gap-4">
          <label className="block">
            <FieldLabel hint={t('common.optional')}>{t('groups.codes.label')}</FieldLabel>
            <input className={INPUT} value={label} maxLength={120} onChange={(e) => setLabel(e.target.value)} placeholder={t('groups.codes.label_placeholder')} />
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="block">
              <FieldLabel hint={t('groups.codes.unlimited')}>{t('groups.codes.max_uses')}</FieldLabel>
              <input type="number" min={1} className={INPUT} value={maxUses} onChange={(e) => setMaxUses(e.target.value)} />
            </label>
            <label className="block">
              <FieldLabel hint={t('groups.codes.never')}>{t('groups.codes.expires_on')}</FieldLabel>
              <input type="date" className={INPUT} value={expires} onChange={(e) => setExpires(e.target.value)} />
            </label>
          </div>
          <label className="block">
            <FieldLabel hint={t('groups.codes.days_hint')}>{t('groups.codes.membership_days')}</FieldLabel>
            <input type="number" min={1} className={INPUT} value={days} onChange={(e) => setDays(e.target.value)} />
          </label>
        </div>
      }
    />
  )
}

function AddMembersDialog({ group, open, onOpenChange }: { group: GroupDetail; open: boolean; onOpenChange: (_open: boolean) => void }) {
  const { t } = useTranslation()
  const { call, orgId, token } = useUG()
  const invalidate = useInvalidateGroups()
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<Map<number, any>>(new Map())
  const [starts, setStarts] = useState('')
  const [ends, setEnds] = useState('')
  const [saving, setSaving] = useState(false)
  const search = useDebounced(q.trim(), 250)
  const { data, isLoading, isError } = useQuery({
    queryKey: ['org', orgId, 'users', 'group-add', group.id, search],
    queryFn: () =>
      apiFetch(
        `${getAPIUrl()}orgs/${orgId}/users?page=1&limit=20&usergroup_id=${group.id}&usergroup_filter=not_in_group${search ? `&search=${encodeURIComponent(search)}` : ''}`,
        token
      ),
    enabled: open && !!orgId,
  })
  const rows = asArray<any>(data?.items)
  const toggle = (row: any) =>
    setPicked((p) => {
      const n = new Map(p)
      if (n.has(row.user.id)) n.delete(row.user.id)
      else n.set(row.user.id, row.user)
      return n
    })
  const submit = async () => {
    setSaving(true)
    try {
      const out = await call<any>('POST', `${group.id}/members`, {
        user_ids: Array.from(picked.keys()),
        starts_at: starts || null,
        expires_at: ends || null,
      })
      const n = (out.added?.length ?? 0) + (out.updated?.length ?? 0)
      if (n) toast.success(t('groups.members.added', { count: n }))
      if (out.scheduled?.length) toast.success(t('groups.members.scheduled', { count: out.scheduled.length }))
      invalidate(group.id)
      setPicked(new Map())
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
      size="md"
      icon={<UserPlus size={16} />}
      dialogTitle={t('groups.members.add_title', { name: group.name })}
      dialogDescription={t('groups.members.add_desc')}
      footer={
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-neutral-500">{t('dashboard.users.active_users.selection.selected', { count: picked.size })}</span>
          <div className="flex gap-2">
            <Button onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
            <Button variant="primary" disabled={!picked.size} loading={saving} onClick={submit} data-testid="confirm-add-members">
              {starts ? t('groups.members.schedule_btn') : t('groups.members.add')}
            </Button>
          </div>
        </div>
      }
      dialogContent={
        <div className="flex flex-col gap-4">
          <SearchInput value={q} onChange={setQ} placeholder={t('groups.members.search_people')} />
          <div className="rounded-xl ring-1 ring-inset ring-neutral-200 max-h-72 overflow-y-auto">
            {isLoading ? (
              <RowSkeleton rows={3} />
            ) : isError ? (
              <p className="px-4 py-6 text-sm text-neutral-500 text-center">{t('groups.members.search_unavailable')}</p>
            ) : rows.length === 0 ? (
              <p className="px-4 py-6 text-sm text-neutral-500 text-center">{t('dashboard.users.usergroups.no_results')}</p>
            ) : (
              <ul className="divide-y divide-neutral-100">
                {rows.map((row) => (
                  <li key={row.user.id}>
                    <button type="button" role="checkbox" aria-checked={picked.has(row.user.id)} onClick={() => toggle(row)} className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-neutral-50 text-start">
                      <CheckBox indicator checked={picked.has(row.user.id)} label={personName(row.user)} />
                      <PersonCell user={row.user} size={30} popup={false} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="block">
              <FieldLabel hint={t('groups.members.now')}>{t('groups.members.starts')}</FieldLabel>
              <input type="date" className={INPUT} value={starts} onChange={(e) => setStarts(e.target.value)} />
            </label>
            <label className="block">
              <FieldLabel hint={t('groups.members.no_end')}>{t('groups.members.ends')}</FieldLabel>
              <input type="date" className={INPUT} value={ends} onChange={(e) => setEnds(e.target.value)} />
            </label>
          </div>
        </div>
      }
    />
  )
}

function ExpiryDialog({ group, member, onClose }: { group: GroupDetail; member: any | null; onClose: () => void }) {
  const { t } = useTranslation()
  const { call } = useUG()
  const invalidate = useInvalidateGroups()
  const [value, setValue] = useState('')
  const [lastId, setLastId] = useState<number | null>(null)
  if (member && member.id !== lastId) {
    setLastId(member.id)
    setValue(dateInput(member.expires_at))
  }
  const save = async (v: string | null) => {
    try {
      await call('PATCH', `${group.id}/members/${member.id}`, { expires_at: v })
      invalidate(group.id)
      onClose()
    } catch (e: any) {
      toast.error(e.message)
    }
  }
  return (
    <Modal
      isDialogOpen={!!member}
      onOpenChange={(o) => !o && onClose()}
      size="sm"
      icon={<CalendarPlus size={16} />}
      dialogTitle={t('groups.members.set_end')}
      dialogDescription={member ? t('groups.members.set_end_desc', { name: personName(member) }) : ''}
      footer={
        <div className="flex justify-between gap-2">
          <Button variant="ghost" onClick={() => save(null)}>
            {t('groups.members.no_end')}
          </Button>
          <div className="flex gap-2">
            <Button onClick={onClose}>{t('common.cancel')}</Button>
            <Button variant="primary" disabled={!value} onClick={() => save(value)}>
              {t('common.save')}
            </Button>
          </div>
        </div>
      }
      dialogContent={<input type="date" className={INPUT} value={value} onChange={(e) => setValue(e.target.value)} aria-label={t('groups.members.ends')} />}
    />
  )
}
