'use client'
import React from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as PopoverPrimitive from '@radix-ui/react-popover'
import toast from 'react-hot-toast'
import {
  Buildings,
  CalendarBlank,
  CheckCircle,
  CheckSquareOffset,
  Circle,
  FlowArrow,
  MagnifyingGlass,
  Trash,
  UserCircle,
  X,
} from '@phosphor-icons/react'
import { Button, ConfirmDialog, FieldLabel, INPUT, Skeleton, StatusPill, TEXTAREA, formatRelative } from '@/design'
import { errorMessage, listOrgs } from '@services/ee/platform/api'
import { createTask, deleteTask, getTask, opsKeys, updateTask, type Task, type TaskBody } from '@services/ee/platform/ops'
import { useAccessToken, useDebounced, usePlatformMe, shouldRetry } from '@components/Admin/hooks'
import { Avatar, adminPath, formatDate, orgDisplayName } from '@components/Admin/Shared/AdminKit'
import { IconTile, SideDrawer, dueInfo, fromLocalInput, toLocalInput, useTeamList } from '@components/Admin/Shared/OpsKit'

// Tasks (CRM-lite, §9.6): the drawer that creates/edits one (`?task=<uuid>` or
// `?task=new`), the row used by every task list, and the small pickers they
// need. Writing needs notes.write; the API also lets the creator, the
// assignee and owners/admins delete.

/** Everything that shows tasks: the tasks list, the overview widget, org pages. */
export function useInvalidateTasks() {
  const qc = useQueryClient()
  return () => {
    qc.invalidateQueries({ queryKey: opsKeys.tasks() })
    qc.invalidateQueries({ queryKey: ['platform', 'overview'] })
    qc.invalidateQueries({ queryKey: ['platform', 'org'] })
  }
}

export function TaskStatusPill({ task }: { task: Pick<Task, 'status' | 'overdue'> }) {
  const { t } = useTranslation()
  if (task.status === 'done') return <StatusPill status="success" dot>{t('admin.tasks.status.done')}</StatusPill>
  if (task.overdue) return <StatusPill status="danger" dot>{t('admin.tasks.overdue')}</StatusPill>
  return <StatusPill status="info" dot>{t('admin.tasks.status.open')}</StatusPill>
}

/** "Due in 3 days" / "2 days overdue" / "Due today", colored by urgency. */
export function DueLabel({ due, done, short }: { due?: string | null; done?: boolean; short?: boolean }) {
  const { t, i18n } = useTranslation()
  if (!due) return <span className="text-xs text-neutral-400">{short ? '–' : t('admin.tasks.no_due')}</span>
  const { days, tone } = dueInfo(due)
  const cls = done ? 'text-neutral-400' : tone === 'rose' ? 'text-rose-600 font-semibold' : tone === 'amber' ? 'text-amber-700 font-semibold' : 'text-neutral-600'
  const text =
    days === null
      ? formatDate(due, i18n.language)
      : days < 0
        ? t('admin.tasks.overdue_days', { count: -days })
        : days === 0
          ? t('admin.tasks.due_today')
          : t('admin.tasks.due_in', { count: days })
  return (
    <span className={`inline-flex items-center gap-1 text-xs whitespace-nowrap ${cls}`} title={formatDate(due, i18n.language, true)}>
      <CalendarBlank size={12} className="shrink-0" />
      {text}
    </span>
  )
}

/** Round checkbox that toggles a task done/open (optimistic, then refetch). */
export function DoneToggle({ task, disabled }: { task: Task; disabled?: boolean }) {
  const { t } = useTranslation()
  const token = useAccessToken()
  const invalidate = useInvalidateTasks()
  const [optimistic, setOptimistic] = React.useState<string | null>(null)
  const done = (optimistic ?? task.status) === 'done'
  React.useEffect(() => setOptimistic(null), [task.status])
  const toggle = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (disabled) return
    const next = done ? 'open' : 'done'
    setOptimistic(next)
    try {
      await updateTask(token, task.task_uuid, { status: next })
      if (next === 'done') toast.success(t('admin.tasks.marked_done'))
      invalidate()
    } catch (err) {
      setOptimistic(null)
      toast.error(errorMessage(err, t('admin.common.error_desc')))
    }
  }
  return (
    <button
      type="button"
      onClick={toggle}
      disabled={disabled}
      role="checkbox"
      aria-checked={done}
      aria-label={done ? t('admin.tasks.reopen_named', { title: task.title }) : t('admin.tasks.mark_done_named', { title: task.title })}
      title={done ? t('admin.tasks.reopen') : t('admin.tasks.mark_done')}
      className={`h-6 w-6 shrink-0 inline-flex items-center justify-center rounded-full transition-colors disabled:cursor-default ${
        done ? 'text-emerald-600' : 'text-neutral-300 hover:text-emerald-600'
      }`}
    >
      {done ? <CheckCircle size={20} weight="fill" /> : <Circle size={20} />}
    </button>
  )
}

// ─── org picker ──────────────────────────────────────────────────────────────

export interface OrgPick {
  id: number
  name: string
}

/** Type-to-search org picker (GET /organizations?q=). */
export function OrgSearchPick({ value, onChange, disabled }: { value: OrgPick | null; onChange: (v: OrgPick | null) => void; disabled?: boolean }) {
  const { t } = useTranslation()
  const token = useAccessToken()
  const [open, setOpen] = React.useState(false)
  const [text, setText] = React.useState('')
  const q = useDebounced(text, 250)
  const res = useQuery({
    queryKey: ['platform', 'org-pick', q],
    queryFn: () => listOrgs(token, { q: q || undefined, limit: 8, page: 1 }),
    enabled: !!token && open,
    retry: shouldRetry,
    staleTime: 30_000,
  })
  const items = Array.isArray(res.data?.items) ? res.data!.items : []
  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
        <PopoverPrimitive.Trigger asChild>
          <button type="button" disabled={disabled} className={`${INPUT} flex items-center gap-2 text-start disabled:opacity-60`}>
            <Buildings size={14} className="shrink-0 text-neutral-400" />
            <span className={`truncate flex-1 ${value ? 'text-neutral-900' : 'text-neutral-400'}`}>{value ? value.name : t('admin.tasks.no_org')}</span>
          </button>
        </PopoverPrimitive.Trigger>
        <PopoverPrimitive.Portal>
          <PopoverPrimitive.Content
            align="start"
            sideOffset={6}
            collisionPadding={12}
            className="w-[min(22rem,calc(100vw-2rem))] rounded-xl bg-white p-2 shadow-[0_12px_40px_-12px_rgba(0,0,0,0.25)] ring-1 ring-neutral-200/80 focus:outline-none"
            style={{ zIndex: 'var(--z-popover)' as any }}
          >
            <div className="relative">
              <MagnifyingGlass size={14} className="absolute start-3 top-1/2 -translate-y-1/2 text-neutral-400" />
              <input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder={t('admin.tasks.org_search')} className={`${INPUT} h-8 ps-8 text-[13px]`} />
            </div>
            <div className="mt-1.5 max-h-60 overflow-y-auto">
              {res.isLoading ? (
                <p className="px-2.5 py-2 text-xs text-neutral-400">{t('common.loading')}</p>
              ) : items.length === 0 ? (
                <p className="px-2.5 py-2 text-xs text-neutral-400">{t('admin.tasks.org_none')}</p>
              ) : (
                items.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => {
                      onChange({ id: o.id, name: orgDisplayName(o, t) })
                      setOpen(false)
                    }}
                    className="w-full flex items-center gap-2 rounded-lg px-2.5 h-8 text-start text-[13px] text-neutral-700 hover:bg-neutral-100"
                  >
                    <span className="truncate flex-1">{orgDisplayName(o, t)}</span>
                    <span className="text-[11px] text-neutral-400 tabular-nums">#{o.id}</span>
                  </button>
                ))
              )}
            </div>
          </PopoverPrimitive.Content>
        </PopoverPrimitive.Portal>
      </PopoverPrimitive.Root>
      {value && !disabled && (
        <button
          type="button"
          onClick={() => onChange(null)}
          aria-label={t('admin.tasks.clear_org')}
          className="h-9 w-9 shrink-0 inline-flex items-center justify-center rounded-lg text-neutral-400 hover:text-neutral-900 hover:bg-neutral-100"
        >
          <X size={14} />
        </button>
      )}
    </div>
  )
}

// ─── row ─────────────────────────────────────────────────────────────────────

export const TASK_GRID =
  'grid grid-cols-[auto_minmax(0,1fr)_auto] md:grid-cols-[auto_minmax(0,1.5fr)_minmax(0,1fr)_9rem_8rem] gap-x-3'

export function TaskRow({
  task,
  onOpen,
  rowProps,
  hideOrg,
}: {
  task: Task
  onOpen: (t: Task) => void
  rowProps?: Record<string, unknown>
  hideOrg?: boolean
}) {
  const { t } = useTranslation()
  const me = usePlatformMe()
  const done = task.status === 'done'
  const stop = (e: React.MouseEvent) => e.stopPropagation()
  const fromAutomation = task.created_from?.startsWith('automation')
  const autoUuid = fromAutomation ? task.created_from?.split(':')[1] : undefined
  const orgName = task.org ? orgDisplayName(task.org, t) : null
  return (
    <div
      {...rowProps}
      onClick={() => onOpen(task)}
      className={`${hideOrg ? 'grid grid-cols-[auto_minmax(0,1fr)_auto] md:grid-cols-[auto_minmax(0,1fr)_9rem_8rem] gap-x-3' : TASK_GRID} items-center gap-y-1 px-5 py-3 cursor-pointer hover:bg-neutral-50 data-[active=true]:bg-neutral-50`}
    >
      <DoneToggle task={task} disabled={!me.can('notes.write')} />
      <div className="min-w-0">
        <p className={`text-sm font-medium truncate ${done ? 'text-neutral-400 line-through' : 'text-neutral-900'}`}>{task.title}</p>
        <div className="flex items-center gap-2 min-w-0 text-xs text-neutral-400">
          {task.notes && <span className="truncate">{task.notes}</span>}
          {fromAutomation && (
            <span className="inline-flex items-center gap-1 shrink-0 text-amber-600" title={t('admin.tasks.from_automation')}>
              <FlowArrow size={12} weight="bold" />
              {autoUuid ? (
                <Link href={adminPath.automation(autoUuid)} onClick={stop} className="hover:underline underline-offset-2">
                  {t('admin.tasks.automation')}
                </Link>
              ) : (
                t('admin.tasks.automation')
              )}
            </span>
          )}
          {/* Phones: org + due under the title */}
          {!hideOrg && orgName && <span className="md:hidden truncate">· {orgName}</span>}
        </div>
      </div>
      {!hideOrg && (
        <div className="hidden md:block min-w-0">
          {task.org_id ? (
            <Link href={adminPath.org(task.org_id)} onClick={stop} className="block truncate text-sm text-neutral-700 hover:text-neutral-900 hover:underline underline-offset-2">
              {orgName ?? `#${task.org_id}`}
            </Link>
          ) : (
            <span className="text-xs text-neutral-400">{t('admin.tasks.no_org_short')}</span>
          )}
        </div>
      )}
      <div className="hidden md:flex items-center gap-1.5 min-w-0">
        {task.assignee ? (
          <Link href={adminPath.user(task.assignee.user_id ?? task.assignee.id ?? task.assignee_user_id ?? '')} onClick={stop} className="flex items-center gap-1.5 min-w-0 hover:underline underline-offset-2">
            <Avatar user={task.assignee} size={20} />
            <span className="truncate text-xs text-neutral-600">{task.assignee.username}</span>
          </Link>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs text-neutral-400">
            <UserCircle size={14} />
            {t('admin.tasks.unassigned')}
          </span>
        )}
      </div>
      <div className="flex justify-end md:justify-start">
        <DueLabel due={task.due_at} done={done} short />
      </div>
    </div>
  )
}

// ─── drawer ──────────────────────────────────────────────────────────────────

interface Draft {
  title: string
  notes: string
  org: OrgPick | null
  assignee: string
  due: string
  status: 'open' | 'done'
}

function toDraft(task?: Task | null, preset?: OrgPick | null, meId?: number): Draft {
  return {
    title: task?.title ?? '',
    notes: task?.notes ?? '',
    org: task?.org_id ? { id: task.org_id, name: task.org?.name || `#${task.org_id}` } : preset ?? null,
    assignee: task ? (task.assignee_user_id ? String(task.assignee_user_id) : '') : meId ? String(meId) : '',
    due: toLocalInput(task?.due_at),
    status: task?.status === 'done' ? 'done' : 'open',
  }
}

/** Create/edit one task. `taskParam` is the `?task=` value (`new` or a uuid). */
export function TaskDrawer({ taskParam, onClose, presetOrg }: { taskParam?: string; onClose: () => void; presetOrg?: OrgPick | null }) {
  const { t, i18n } = useTranslation()
  const token = useAccessToken()
  const me = usePlatformMe()
  const invalidate = useInvalidateTasks()
  const isNew = taskParam === 'new'
  const canWrite = me.can('notes.write')
  const team = useTeamList(!!taskParam && canWrite)
  const q = useQuery({
    queryKey: opsKeys.task(taskParam ?? ''),
    queryFn: () => getTask(token, taskParam!),
    enabled: !!token && !!taskParam && !isNew,
    retry: shouldRetry,
  })
  const task = isNew ? null : q.data
  const [draft, setDraft] = React.useState<Draft>(() => toDraft(null, presetOrg, me.userId))
  const [busy, setBusy] = React.useState(false)
  const [confirmDelete, setConfirmDelete] = React.useState(false)
  const [error, setError] = React.useState('')

  // Reset the form whenever another task opens or its data lands.
  React.useEffect(() => {
    if (!taskParam) return
    setDraft(toDraft(task, presetOrg, me.userId))
    setError('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskParam, task?.task_uuid, task?.updated_at])

  const patch = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }))
  const save = async () => {
    const title = draft.title.trim()
    if (!title) {
      setError(t('admin.tasks.title_required'))
      return
    }
    const body: TaskBody = {
      title: title.slice(0, 200),
      notes: draft.notes.trim() || null,
      org_id: draft.org?.id ?? null,
      assignee_user_id: draft.assignee ? Number(draft.assignee) : null,
      due_at: fromLocalInput(draft.due),
      status: draft.status,
    }
    setBusy(true)
    try {
      if (isNew) {
        await createTask(token, body)
        toast.success(t('admin.tasks.created'))
      } else if (task) {
        await updateTask(token, task.task_uuid, body)
        toast.success(t('admin.tasks.saved'))
      }
      invalidate()
      onClose()
    } catch (err) {
      toast.error(errorMessage(err, t('admin.common.error_desc')))
    } finally {
      setBusy(false)
    }
  }
  const remove = async () => {
    if (!task) return
    try {
      await deleteTask(token, task.task_uuid)
      toast.success(t('admin.tasks.deleted'))
      invalidate()
      onClose()
    } catch (err) {
      toast.error(errorMessage(err, t('admin.common.error_desc')))
    }
  }

  const members = team.members
  const notFound = !isNew && !q.isLoading && !task
  const readOnly = !canWrite

  return (
    <>
      <SideDrawer
        open={!!taskParam}
        onClose={onClose}
        icon={<IconTile icon={<CheckSquareOffset size={20} weight="duotone" />} tone="teal" size="lg" />}
        title={isNew ? t('admin.tasks.new_title') : task?.title || t('admin.tasks.task')}
        subtitle={
          task ? (
            <>
              <TaskStatusPill task={task} />
              {task.created_at && <span>{t('admin.tasks.created_ago', { when: formatRelative(task.created_at, i18n.language) })}</span>}
              {task.done_at && <span>· {t('admin.tasks.done_ago', { when: formatRelative(task.done_at, i18n.language) })}</span>}
            </>
          ) : undefined
        }
        copyHref={isNew ? false : task ? `/admin/tasks?task=${task.task_uuid}` : undefined}
        footer={
          readOnly || notFound ? undefined : (
            <>
              {task && (
                <Button variant="danger-ghost" icon={<Trash size={14} />} onClick={() => setConfirmDelete(true)} className="me-auto">
                  {t('common.delete')}
                </Button>
              )}
              <Button onClick={onClose} disabled={busy}>
                {t('common.cancel')}
              </Button>
              <Button variant="primary" onClick={save} loading={busy}>
                {isNew ? t('admin.tasks.create') : t('common.save')}
              </Button>
            </>
          )
        }
      >
        {!isNew && q.isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-9 w-2/3" />
          </div>
        ) : notFound ? (
          <p className="text-sm text-neutral-500">{t('admin.tasks.not_found')}</p>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault()
              save()
            }}
          >
            <div>
              <FieldLabel error={error || undefined}>{t('admin.tasks.field_title')}</FieldLabel>
              <input
                autoFocus={isNew}
                className={INPUT}
                value={draft.title}
                maxLength={200}
                disabled={readOnly}
                onChange={(e) => {
                  patch({ title: e.target.value })
                  if (error) setError('')
                }}
                placeholder={t('admin.tasks.title_placeholder')}
              />
            </div>
            <div>
              <FieldLabel>{t('admin.tasks.field_notes')}</FieldLabel>
              <textarea className={TEXTAREA} rows={4} value={draft.notes} disabled={readOnly} onChange={(e) => patch({ notes: e.target.value })} placeholder={t('admin.tasks.notes_placeholder')} />
            </div>
            <div>
              <FieldLabel hint={draft.org ? <Link href={adminPath.org(draft.org.id)} className="hover:underline">{t('admin.tasks.open_org')}</Link> : undefined}>
                {t('admin.tasks.field_org')}
              </FieldLabel>
              <OrgSearchPick value={draft.org} onChange={(org) => patch({ org })} disabled={readOnly} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <FieldLabel>{t('admin.tasks.field_assignee')}</FieldLabel>
                <select className={INPUT} value={draft.assignee} disabled={readOnly} onChange={(e) => patch({ assignee: e.target.value })}>
                  <option value="">{t('admin.tasks.unassigned')}</option>
                  {members.map((m) => (
                    <option key={m.user_id} value={String(m.user_id)}>
                      {m.user_id === me.userId ? t('admin.tasks.me_named', { name: m.username }) : m.username}
                    </option>
                  ))}
                  {/* Keep a current assignee that's no longer on the team selectable. */}
                  {draft.assignee && !members.some((m) => String(m.user_id) === draft.assignee) && (
                    <option value={draft.assignee}>{task?.assignee?.username ?? `#${draft.assignee}`}</option>
                  )}
                </select>
              </div>
              <div>
                <FieldLabel>{t('admin.tasks.field_due')}</FieldLabel>
                <input type="datetime-local" className={INPUT} value={draft.due} disabled={readOnly} onChange={(e) => patch({ due: e.target.value })} />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {[1, 3, 7].map((d) => (
                <button
                  key={d}
                  type="button"
                  disabled={readOnly}
                  onClick={() => {
                    const at = new Date(Date.now() + d * 86_400_000)
                    at.setHours(9, 0, 0, 0)
                    patch({ due: toLocalInput(at.toISOString()) })
                  }}
                  className="h-7 px-2.5 rounded-full bg-neutral-100 text-xs font-medium text-neutral-600 hover:text-neutral-900 disabled:opacity-50"
                >
                  {t('admin.tasks.in_days', { count: d })}
                </button>
              ))}
              {draft.due && (
                <button type="button" disabled={readOnly} onClick={() => patch({ due: '' })} className="h-7 px-2.5 rounded-full text-xs font-medium text-neutral-500 hover:text-neutral-900">
                  {t('admin.tasks.clear_due')}
                </button>
              )}
            </div>
            {!isNew && (
              <label className="flex items-center gap-2.5 text-sm text-neutral-700">
                <input type="checkbox" className="h-4 w-4 accent-emerald-600" checked={draft.status === 'done'} disabled={readOnly} onChange={(e) => patch({ status: e.target.checked ? 'done' : 'open' })} />
                {t('admin.tasks.field_done')}
              </label>
            )}
            {readOnly && <p className="text-xs text-neutral-400">{t('admin.tasks.read_only')}</p>}
            <button type="submit" className="hidden" />
          </form>
        )}
      </SideDrawer>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t('admin.tasks.delete_title')}
        message={t('admin.tasks.delete_message', { title: task?.title ?? '' })}
        confirmLabel={t('common.delete')}
        onConfirm={remove}
      />
    </>
  )
}
