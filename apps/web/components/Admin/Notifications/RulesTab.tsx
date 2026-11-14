'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { ListChecks, MoonStars, Plus, Trash } from '@phosphor-icons/react'
import { Button, Chip, ConfirmDialog, EmptyState, Panel } from '@/design'
import { errorMessage } from '@services/ee/platform/api'
import { deleteRule, listRules, opsKeys, updateRule, type Rule } from '@services/ee/platform/ops'
import { shouldRetry, useAccessToken, useListKeyboard } from '@components/Admin/hooks'
import { ListSkeleton, QueryError, Switch } from '@components/Admin/Shared/AdminKit'
import { useEventCatalog } from '@components/Admin/Shared/OpsKit'
import { KindIcon } from './channelVisuals'
import RuleDialog from './RuleDialog'

// Notification rules: event patterns → filters → channel or inbox. Rows show
// what each rule listens to and where it goes; `?rule=<uuid>` opens one,
// `?rule=new` starts a new one.

const MODE_TONE: Record<string, 'neutral' | 'sky' | 'violet'> = { instant: 'neutral', digest_hourly: 'sky', digest_daily: 'violet' }

export default function RulesTab({
  values,
  setValues,
}: {
  values: Record<string, string | undefined>
  setValues: (_u: Record<string, string | undefined>, _o?: { replace?: boolean }) => void
}) {
  const { t } = useTranslation()
  const token = useAccessToken()
  const catalog = useEventCatalog()
  const q = useQuery({ queryKey: opsKeys.rules(), queryFn: () => listRules(token), enabled: !!token, retry: shouldRetry })
  const rules: Rule[] = Array.isArray(q.data) ? q.data : []
  const openId = values.rule
  const editing = openId && openId !== 'new' ? rules.find((r) => r.rule_uuid === openId) ?? null : null
  const kb = useListKeyboard(rules, (r) => setValues({ rule: r.rule_uuid }))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-neutral-500 max-w-2xl">{t('admin.notifications.rules.intro')}</p>
        <Button variant="primary" icon={<Plus size={13} weight="bold" />} onClick={() => setValues({ rule: 'new' })}>
          {t('admin.notifications.rules.add')}
        </Button>
      </div>

      {q.isLoading ? (
        <ListSkeleton rows={4} />
      ) : q.error ? (
        <QueryError error={q.error} onRetry={() => q.refetch()} />
      ) : rules.length === 0 ? (
        <Panel>
          <EmptyState
            icon={<ListChecks size={22} />}
            title={t('admin.notifications.rules.empty_title')}
            description={t('admin.notifications.rules.empty_desc')}
            action={
              <Button size="sm" variant="primary" icon={<Plus size={12} weight="bold" />} onClick={() => setValues({ rule: 'new' })}>
                {t('admin.notifications.rules.add')}
              </Button>
            }
          />
        </Panel>
      ) : (
        <Panel divided>
          {rules.map((r, i) => (
            <RuleRow key={r.rule_uuid} rule={r} label={catalog.label} rowProps={kb.rowProps(i)} onOpen={() => setValues({ rule: r.rule_uuid })} />
          ))}
        </Panel>
      )}

      <RuleDialog open={openId === 'new' || !!editing} rule={editing} onClose={() => setValues({ rule: undefined })} />
    </div>
  )
}

function RuleRow({ rule: r, label, rowProps, onOpen }: { rule: Rule; label: (_k: string) => string; rowProps: Record<string, unknown>; onOpen: () => void }) {
  const { t } = useTranslation()
  const token = useAccessToken()
  const queryClient = useQueryClient()
  // Optimistic switch value until the refetched list catches up.
  const [pending, setPending] = React.useState<boolean | null>(null)
  const enabled = pending ?? r.enabled
  const [confirm, setConfirm] = React.useState(false)
  const refresh = () => queryClient.invalidateQueries({ queryKey: opsKeys.rules() })

  const toggle = async (v: boolean) => {
    setPending(v)
    try {
      await updateRule(token, r.rule_uuid, { enabled: v })
    } catch (err) {
      toast.error(errorMessage(err, t('admin.common.error_desc')))
    } finally {
      await refresh()
      setPending(null)
    }
  }
  const remove = async () => {
    try {
      await deleteRule(token, r.rule_uuid)
      toast.success(t('admin.notifications.rules.deleted'))
      refresh()
    } catch (err) {
      toast.error(errorMessage(err, t('admin.common.error_desc')))
    }
  }

  const events = Array.isArray(r.event_types) ? r.event_types : []
  const f = r.filters ?? {}
  const filterBits = [
    ...(Array.isArray(f.plan) ? f.plan.map((p) => t(`admin.plans.${p}`, { defaultValue: p })) : []),
    ...(Array.isArray(f.lifecycle) ? f.lifecycle.map((l) => t(`admin.lifecycle.${l}`, { defaultValue: l })) : []),
    ...(Array.isArray(f.tags_any) ? f.tags_any.map((x) => `#${x}`) : []),
    ...(f.severity_min ? [t('admin.notifications.rules.severity_at_least', { severity: t(`admin.ops.severity.${f.severity_min}`, { defaultValue: f.severity_min }) })] : []),
  ]
  const roles = Array.isArray(r.inbox_roles) ? r.inbox_roles : []
  const dest = r.channel_uuid
    ? r.channel_name || t('admin.notifications.rules.deleted_channel')
    : roles.length
      ? t('admin.notifications.rules.inbox_of', { roles: roles.map((x) => t(`admin.roles.${x}`, { defaultValue: x })).join(', ') })
      : t('admin.notifications.rules.inbox_everyone')
  const eventLabel = (k: string) => (k === '*' ? t('admin.notifications.rules.all_events') : k.endsWith('.*') ? t('admin.notifications.rules.group_all', { group: t(`admin.notifications.groups.${k.slice(0, -2)}`, { defaultValue: k.slice(0, -2) }) }) : label(k))

  return (
    <div {...rowProps} onClick={onOpen} className="flex items-start gap-3 px-5 py-3.5 cursor-pointer hover:bg-neutral-50 data-[active=true]:bg-neutral-50">
      <KindIcon kind={r.channel_kind || (r.channel_uuid ? null : 'inbox')} />
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`text-sm font-semibold ${enabled ? 'text-neutral-900' : 'text-neutral-400'}`}>{r.name}</span>
          <Chip tone={MODE_TONE[r.mode] ?? 'neutral'}>{t(`admin.notifications.modes.${r.mode}`, { defaultValue: r.mode })}</Chip>
          {r.quiet_hours && (
            <span className="inline-flex items-center gap-1 text-[11px] text-indigo-500" title={t('admin.notifications.rules.quiet')}>
              <MoonStars size={12} weight="fill" />
              {r.quiet_hours.start}–{r.quiet_hours.end}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {events.slice(0, 4).map((k) => (
            <span key={k} className="inline-flex items-center rounded-md bg-neutral-100 px-1.5 py-0.5 text-[11px] font-medium text-neutral-600">
              {eventLabel(k)}
            </span>
          ))}
          {events.length > 4 && <span className="text-[11px] tabular-nums text-neutral-400">+{events.length - 4}</span>}
        </div>
        <p className="text-xs text-neutral-500 break-words">
          {t('admin.notifications.rules.to', { dest })}
          {filterBits.length > 0 && <span className="text-neutral-400"> · {filterBits.join(', ')}</span>}
        </p>
      </div>
      <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
        <Switch checked={enabled} onChange={toggle} label={t('admin.notifications.rules.enabled_label', { name: r.name })} />
        <button
          type="button"
          onClick={() => setConfirm(true)}
          aria-label={t('admin.notifications.rules.delete')}
          title={t('admin.notifications.rules.delete')}
          className="h-8 w-8 inline-flex items-center justify-center rounded-lg text-neutral-400 hover:text-rose-600 hover:bg-rose-50"
        >
          <Trash size={14} />
        </button>
        <ConfirmDialog
          open={confirm}
          onOpenChange={setConfirm}
          title={t('admin.notifications.rules.delete_title', { name: r.name })}
          message={t('admin.notifications.rules.delete_desc')}
          confirmLabel={t('admin.notifications.rules.delete')}
          onConfirm={remove}
        />
      </div>
    </div>
  )
}
