'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import {
  Buildings,
  CalendarBlank,
  CheckSquareOffset,
  CreditCard,
  FlowArrow,
  Plus,
  SortAscending,
  Tag,
  UserCircle,
  WarningCircle,
} from '@phosphor-icons/react'
import { Button, DashPage, EmptyState, Panel, SegmentedControl, ToolbarSelect, recipes } from '@/design'
import { facetList, listOrgs } from '@services/ee/platform/api'
import { listTasks, opsKeys } from '@services/ee/platform/ops'
import { useAccessToken, useListKeyboard, usePlatformMe, useUrlQuery, shouldRetry } from '@components/Admin/hooks'
import { AdminHeader, CopyLinkButton, ListSkeleton, NoAccess, Pagination, QueryError } from '@components/Admin/Shared/AdminKit'
import FilterBar, { filterKeys, resolveDate, type FilterDef } from '@components/Admin/Shared/FilterBar'
import { useTeamList } from '@components/Admin/Shared/OpsKit'
import { TASK_GRID, TaskDrawer, TaskRow } from './taskUi'

// /admin/tasks: every follow-up the team owes an org. All view state is in
// the URL (filters, status, sort, page, `?task=` for the open drawer), so a
// filtered list or a single task is a link.

const PAGE_SIZE = 25
const SORTS = ['due:asc', 'created:desc', 'updated:desc', 'title:asc'] as const
const STATUSES = ['open', 'done', 'all'] as const

export default function TasksPage() {
  const { t } = useTranslation()
  const token = useAccessToken()
  const me = usePlatformMe()
  const [values, setValues] = useUrlQuery()
  const page = Math.max(1, Number(values.page) || 1)
  const status = (STATUSES as readonly string[]).includes(values.status ?? '') ? (values.status as (typeof STATUSES)[number]) : 'open'
  const sort = values.sort && (SORTS as readonly string[]).includes(values.sort) ? values.sort : 'due:asc'
  const team = useTeamList(me.can('platform.read'))
  const orgNames = React.useRef<Record<string, string>>({})

  const query = React.useMemo(() => {
    const [s, order] = sort.split(':')
    return {
      page,
      limit: PAGE_SIZE,
      sort: s,
      order,
      q: values.q || undefined,
      status: status === 'all' ? undefined : status,
      assignee: values.assignee || undefined,
      org_id: values.org_id || undefined,
      org_plan: values.org_plan || undefined,
      org_tag: values.org_tag || undefined,
      overdue: values.overdue || undefined,
      created_from: values.created_from || undefined,
      due_after: resolveDate(values.due_after),
      due_before: resolveDate(values.due_before, true),
    }
  }, [values, page, status, sort])

  const q = useQuery({
    queryKey: opsKeys.tasks(query),
    queryFn: () => listTasks(token, query),
    enabled: !!token && me.can('platform.read'),
    retry: shouldRetry,
    placeholderData: (prev) => prev,
  })
  const tasks = Array.isArray(q.data?.items) ? q.data!.items : []
  const openTask = (uuid: string) => setValues({ task: uuid })
  const kb = useListKeyboard(tasks, (task) => openTask(task.task_uuid))
  const statusFacet = facetList(q.data?.facets?.status)
  const overdueCount = q.data?.facets?.overdue

  const defs: FilterDef[] = [
    {
      key: 'assignee',
      kind: 'select',
      label: t('admin.tasks.filters.assignee'),
      icon: <UserCircle size={14} />,
      options: [
        { value: 'me', label: t('admin.tasks.filters.me') },
        { value: 'none', label: t('admin.tasks.unassigned') },
        ...team.members.filter((m) => m.user_id !== me.userId).map((m) => ({ value: String(m.user_id), label: m.username })),
      ],
    },
    {
      key: 'org_id',
      kind: 'async',
      label: t('admin.tasks.filters.org'),
      icon: <Buildings size={14} />,
      placeholder: t('admin.tasks.org_search'),
      load: async (text: string) => {
        const res = await listOrgs(token, { q: text, limit: 10, page: 1 })
        return (Array.isArray(res?.items) ? res.items : []).map((o) => {
          orgNames.current[String(o.id)] = o.name
          return { value: String(o.id), label: o.name }
        })
      },
      describe: (v: string) => orgNames.current[v] ?? `#${v}`,
    },
    {
      key: 'org_plan',
      kind: 'select',
      label: t('admin.tasks.filters.org_plan'),
      icon: <CreditCard size={14} />,
      options: ['free', 'paid', 'standard', 'pro', 'enterprise'].map((p) => ({ value: p, label: p === 'paid' ? t('admin.users.paid_plans') : t(`admin.plans.${p}`) })),
    },
    { key: 'org_tag', kind: 'text', label: t('admin.tasks.filters.org_tag'), icon: <Tag size={14} />, placeholder: t('admin.users.org_tag_placeholder') },
    { key: 'due', kind: 'date', label: t('admin.tasks.filters.due'), icon: <CalendarBlank size={14} />, sinceKey: 'due_after', untilKey: 'due_before' },
    {
      key: 'overdue',
      kind: 'boolean',
      label: t('admin.tasks.overdue'),
      icon: <WarningCircle size={14} />,
      trueLabel: t('admin.tasks.filters.overdue_only'),
      falseLabel: t('admin.tasks.filters.not_overdue'),
      counts: { true: typeof overdueCount === 'number' ? overdueCount : undefined },
    },
    {
      key: 'created_from',
      kind: 'select',
      label: t('admin.tasks.filters.source'),
      icon: <FlowArrow size={14} />,
      options: [
        { value: 'manual', label: t('admin.tasks.filters.manual') },
        { value: 'automation', label: t('admin.tasks.automation') },
      ],
    },
  ]

  if (!me.isLoading && !me.can('platform.read')) {
    return (
      <DashPage>
        <AdminHeader title={t('admin.tasks.title')} />
        <NoAccess />
      </DashPage>
    )
  }

  const total = q.data?.total ?? 0
  const filtered = !!values.q || filterKeys(defs).some((k) => !!values[k])
  const canWrite = me.can('notes.write')
  const clear = () => {
    const updates: Record<string, undefined> = { q: undefined, page: undefined }
    for (const k of filterKeys(defs)) updates[k] = undefined
    setValues(updates)
  }
  const countFor = (s: string) => statusFacet.find((f) => f.value === s)?.count

  return (
    <DashPage>
      <AdminHeader
        title={t('admin.tasks.title')}
        subtitle={t('admin.tasks.subtitle')}
        actions={
          <>
            <CopyLinkButton />
            {canWrite && (
              <Button variant="primary" icon={<Plus size={14} weight="bold" />} onClick={() => openTask('new')}>
                {t('admin.tasks.new')}
              </Button>
            )}
          </>
        }
      />

      <FilterBar
        values={values}
        onChange={setValues}
        defs={defs}
        search={{ key: 'q', placeholder: t('admin.tasks.search') }}
        savedViewsKey="lh:admin:views:tasks"
        end={
          <ToolbarSelect
            ariaLabel={t('admin.tasks.sort')}
            icon={<SortAscending size={14} />}
            value={sort}
            onChange={(v) => setValues({ sort: v === 'due:asc' ? undefined : v, page: undefined })}
            options={SORTS.map((s) => ({ value: s, label: t(`admin.tasks.sort_${s.split(':')[0]}`) }))}
          />
        }
      >
        <SegmentedControl
          ariaLabel={t('admin.tasks.filters.status')}
          value={status}
          onChange={(v) => setValues({ status: v === 'open' ? undefined : v, page: undefined })}
          options={STATUSES.map((s) => ({ key: s, label: t(`admin.tasks.status.${s}`), count: s === 'all' ? undefined : countFor(s) }))}
        />
      </FilterBar>

      {q.isLoading ? (
        <ListSkeleton rows={6} avatar={false} />
      ) : q.error ? (
        <QueryError error={q.error} onRetry={() => q.refetch()} />
      ) : tasks.length === 0 ? (
        <Panel>
          <EmptyState
            icon={<CheckSquareOffset size={22} />}
            title={filtered ? t('admin.tasks.no_match') : status === 'done' ? t('admin.tasks.none_done') : t('admin.tasks.empty_title')}
            description={filtered ? t('admin.tasks.no_match_desc') : t('admin.tasks.empty_desc')}
            action={
              filtered ? (
                <Button size="sm" onClick={clear}>
                  {t('admin.filters.clear_all')}
                </Button>
              ) : canWrite ? (
                <Button size="sm" variant="primary" icon={<Plus size={13} weight="bold" />} onClick={() => openTask('new')}>
                  {t('admin.tasks.new')}
                </Button>
              ) : undefined
            }
          />
        </Panel>
      ) : (
        <>
          <Panel divided className={q.isFetching ? 'opacity-70 transition-opacity' : 'transition-opacity'}>
            <div className={`${recipes.tableHead} hidden md:grid ${TASK_GRID}`}>
              <span className="w-6" />
              <span>{t('admin.tasks.col_task')}</span>
              <span>{t('admin.tasks.col_org')}</span>
              <span>{t('admin.tasks.col_assignee')}</span>
              <span>{t('admin.tasks.col_due')}</span>
            </div>
            {tasks.map((task, i) => (
              <TaskRow key={task.task_uuid} task={task} onOpen={(x) => openTask(x.task_uuid)} rowProps={kb.rowProps(i)} />
            ))}
          </Panel>
          <Pagination page={page} total={total} limit={PAGE_SIZE} onPage={(p) => setValues({ page: p === 1 ? undefined : String(p) })} />
        </>
      )}

      <TaskDrawer taskParam={values.task} onClose={() => setValues({ task: undefined })} />
    </DashPage>
  )
}
