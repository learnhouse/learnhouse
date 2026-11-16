'use client'
import React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { CheckCircle, CheckSquareOffset } from '@phosphor-icons/react'
import { Skeleton } from '@/design'
import type { Task } from '@services/ee/platform/ops'
import { orgDisplayName } from '@components/Admin/Shared/AdminKit'
import { ToneCard } from '@components/Admin/Shared/OpsKit'
import { DoneToggle, DueLabel } from './taskUi'
import { usePlatformMe } from '@components/Admin/hooks'

// Overview widget: the signed-in member's open tasks (GET /overview →
// my_tasks {items, open, overdue}). Each row opens /admin/tasks?task=<uuid>.

export default function MyTasksCard({ data, loading }: { data?: { items?: Task[]; open?: number; overdue?: number } | null; loading: boolean }) {
  const { t } = useTranslation()
  const router = useRouter()
  const me = usePlatformMe()
  const items = Array.isArray(data?.items) ? data!.items.slice(0, 6) : []
  const open = data?.open ?? items.length
  const overdue = data?.overdue ?? 0
  return (
    <ToneCard
      icon={<CheckSquareOffset size={18} weight="duotone" />}
      tone="teal"
      title={t('admin.tasks.mine_title')}
      description={
        loading
          ? t('admin.tasks.mine_desc')
          : overdue
            ? t('admin.tasks.mine_summary_overdue', { count: open, overdue })
            : t('admin.tasks.mine_summary', { count: open })
      }
      actions={
        <Link href="/admin/tasks?assignee=me" className="text-xs font-semibold text-neutral-500 hover:text-neutral-900">
          {t('admin.overview.view_all')}
        </Link>
      }
    >
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="h-5 w-5 rounded-full" />
              <Skeleton className="h-3.5 flex-1" />
              <Skeleton className="h-3 w-16" />
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="flex items-center gap-2.5 text-sm text-neutral-500">
          <CheckCircle size={18} weight="duotone" className="text-emerald-600 shrink-0" />
          {t('admin.tasks.mine_empty')}
        </div>
      ) : (
        <div className="divide-y divide-neutral-100 -my-1">
          {items.map((task) => (
            <div
              key={task.task_uuid}
              role="link"
              tabIndex={0}
              onClick={() => router.push(`/admin/tasks?task=${task.task_uuid}`)}
              onKeyDown={(e) => e.key === 'Enter' && router.push(`/admin/tasks?task=${task.task_uuid}`)}
              className="flex items-center gap-2.5 py-2 min-w-0 cursor-pointer group"
            >
              <DoneToggle task={task} disabled={!me.can('notes.write')} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-neutral-900 group-hover:underline underline-offset-2">{task.title}</span>
                {task.org && <span className="block truncate text-xs text-neutral-400">{orgDisplayName(task.org, t)}</span>}
              </span>
              <DueLabel due={task.due_at} short />
            </div>
          ))}
        </div>
      )}
    </ToneCard>
  )
}
