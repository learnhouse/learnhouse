'use client'
import React from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { ArrowRight, CheckSquareOffset, Plus, Square } from '@phosphor-icons/react'
import { Button, INPUT, SectionCard } from '@/design'
import { errorMessage } from '@services/ee/platform/api'
import { createTask, listTasks, opsKeys, updateTask, type Task } from '@services/ee/platform/ops'
import { useAccessToken, usePlatformMe, shouldRetry } from '@components/Admin/hooks'
import { Avatar, QueryError, adminPath, formatDate } from '@components/Admin/Shared/AdminKit'
import { dueInfo, fromLocalInput } from '@components/Admin/Shared/OpsKit'

// Open tasks for this org: tick one to complete it, type to add one.
// The full list (done tasks, filters) is on /admin/tasks?org_id=…

const DUE_TONE = { rose: 'text-rose-600', amber: 'text-amber-600', neutral: 'text-neutral-400' } as const

export default function OrgTasksCard({ orgId }: { orgId: number }) {
  const { t, i18n } = useTranslation()
  const token = useAccessToken()
  const qc = useQueryClient()
  const me = usePlatformMe()
  const canWrite = me.can('notes.write')
  const query = { org_id: orgId, status: 'open', sort: 'due', order: 'asc', limit: 8 }
  const key = opsKeys.tasks(query)
  const q = useQuery({ queryKey: key, queryFn: () => listTasks(token, query), enabled: !!token, retry: shouldRetry })
  const tasks: Task[] = Array.isArray(q.data?.items) ? q.data!.items : []
  const total = q.data?.total ?? tasks.length
  const [title, setTitle] = React.useState('')
  const [due, setDue] = React.useState('')
  const [adding, setAdding] = React.useState(false)

  const refresh = () => {
    qc.invalidateQueries({ queryKey: opsKeys.tasks() })
    qc.invalidateQueries({ queryKey: ['platform', 'org', String(orgId), 'timeline'] })
  }

  const add = async () => {
    const value = title.trim()
    if (!value) return
    setAdding(true)
    try {
      await createTask(token, { title: value, org_id: orgId, due_at: due ? fromLocalInput(`${due}T09:00`) : null, assignee_user_id: me.userId ?? null })
      setTitle('')
      setDue('')
      refresh()
    } catch (err) {
      toast.error(errorMessage(err, t('admin.common.error_desc')))
    } finally {
      setAdding(false)
    }
  }

  const complete = async (task: Task) => {
    // Optimistic: the row leaves the open list at once.
    qc.setQueryData(key, (prev: any) => (prev && Array.isArray(prev.items) ? { ...prev, items: prev.items.filter((x: Task) => x.task_uuid !== task.task_uuid), total: Math.max(0, (prev.total ?? 1) - 1) } : prev))
    try {
      await updateTask(token, task.task_uuid, { status: 'done' })
      toast.success(t('admin.org.tasks.done_toast'))
    } catch (err) {
      toast.error(errorMessage(err, t('admin.common.error_desc')))
    } finally {
      refresh()
    }
  }

  return (
    <SectionCard
      icon={<CheckSquareOffset size={18} />}
      title={t('admin.org.tasks.title')}
      description={t('admin.org.tasks.desc')}
      actions={
        <Link href={`/admin/tasks?org_id=${orgId}`} className="inline-flex items-center gap-1 text-xs font-semibold text-neutral-500 hover:text-neutral-900">
          {t('admin.org.tasks.all', { count: total })}
          <ArrowRight size={12} className="rtl:rotate-180" />
        </Link>
      }
      bodyClassName="pt-3 pb-4"
    >
      {q.error ? (
        <div className="px-5">
          <QueryError error={q.error} compact />
        </div>
      ) : (
        <>
          {tasks.length === 0 && !q.isLoading ? (
            <p className="px-5 pb-2 text-sm text-neutral-400">{t('admin.org.tasks.empty')}</p>
          ) : (
            <ul className="divide-y divide-neutral-100">
              {tasks.map((task) => {
                const d = dueInfo(task.due_at)
                return (
                  <li key={task.task_uuid} className="flex items-center gap-3 px-5 py-2.5">
                    <button
                      type="button"
                      disabled={!canWrite}
                      onClick={() => complete(task)}
                      aria-label={t('admin.org.tasks.complete', { title: task.title })}
                      title={t('admin.org.tasks.complete', { title: task.title })}
                      className="shrink-0 text-neutral-400 hover:text-emerald-600 disabled:opacity-40"
                    >
                      <Square size={18} />
                    </button>
                    <Link href={task.path || `/admin/tasks?task=${task.task_uuid}`} className="min-w-0 flex-1 text-sm text-neutral-800 truncate hover:underline underline-offset-2">
                      {task.title}
                    </Link>
                    {task.due_at && (
                      <span className={`shrink-0 text-xs tabular-nums ${DUE_TONE[d.tone]}`} title={formatDate(task.due_at, i18n.language, true)}>
                        {d.days !== null && d.days < 0 ? t('admin.org.tasks.overdue', { count: -d.days }) : formatDate(task.due_at, i18n.language)}
                      </span>
                    )}
                    {task.assignee && (task.assignee.user_id ?? task.assignee.id) && (
                      <Link href={adminPath.user(task.assignee.user_id ?? task.assignee.id!)} title={task.assignee.username} className="shrink-0">
                        <Avatar user={task.assignee} size={20} />
                      </Link>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
          {canWrite && (
            <div className="mt-2 flex flex-wrap items-center gap-2 px-5">
              <div className="flex-1 min-w-[12rem]">
                <input
                  value={title}
                  maxLength={200}
                  onChange={(e) => setTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') add()
                  }}
                  placeholder={t('admin.org.tasks.placeholder')}
                  aria-label={t('admin.org.tasks.placeholder')}
                  className={INPUT}
                />
              </div>
              <div className="w-40 shrink-0">
                <input type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label={t('admin.org.tasks.due')} className={INPUT} />
              </div>
              <Button icon={<Plus size={14} />} onClick={add} disabled={!title.trim()} loading={adding}>
                {t('admin.org.tasks.add')}
              </Button>
            </div>
          )}
        </>
      )}
    </SectionCard>
  )
}
