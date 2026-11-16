'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { PaperPlaneTilt, PencilSimple, Plugs, Plus, Trash, WarningCircle } from '@phosphor-icons/react'
import { Button, ConfirmDialog, EmptyState, Panel, Skeleton, formatRelative } from '@/design'
import { errorMessage } from '@services/ee/platform/api'
import { deleteChannel, opsKeys, testChannel, updateChannel, type Channel, type ChannelTestResult } from '@services/ee/platform/ops'
import { useAccessToken } from '@components/Admin/hooks'
import { QueryError, Switch, formatDate } from '@components/Admin/Shared/AdminKit'
import { useChannelList } from '@components/Admin/Shared/OpsKit'
import { KindIcon, maskedSummary } from './channelVisuals'
import ChannelDialog from './ChannelDialog'
import NotionCheck, { TestResultLine } from './NotionCheck'

// Where notifications go: Discord, Slack, Notion, a signed webhook or email
// to team members. Each card shows the masked destination, whether it is
// healthy (consecutive failures, auto-disable reason) and a Test button.
// `?channel=<uuid>` opens one for editing, `?channel=new` the setup.

export default function ChannelsTab({
  values,
  setValues,
}: {
  values: Record<string, string | undefined>
  setValues: (_u: Record<string, string | undefined>, _o?: { replace?: boolean }) => void
}) {
  const { t } = useTranslation()
  const q = useChannelList()
  const channels = q.channels
  const openId = values.channel
  const editing = openId && openId !== 'new' ? channels.find((c) => c.channel_uuid === openId) ?? null : null
  const dialogOpen = openId === 'new' || !!editing

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-neutral-500 max-w-2xl">{t('admin.notifications.channels.intro')}</p>
        <Button variant="primary" icon={<Plus size={13} weight="bold" />} onClick={() => setValues({ channel: 'new' })}>
          {t('admin.notifications.channels.add')}
        </Button>
      </div>

      {q.isLoading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-36 rounded-2xl" />
          ))}
        </div>
      ) : q.error ? (
        <QueryError error={q.error} onRetry={() => q.refetch()} />
      ) : channels.length === 0 ? (
        <Panel>
          <EmptyState
            icon={<Plugs size={22} />}
            title={t('admin.notifications.channels.empty_title')}
            description={t('admin.notifications.channels.empty_desc')}
            action={
              <Button size="sm" variant="primary" icon={<Plus size={12} weight="bold" />} onClick={() => setValues({ channel: 'new' })}>
                {t('admin.notifications.channels.add')}
              </Button>
            }
          />
        </Panel>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {channels.map((c) => (
            <ChannelCard key={c.channel_uuid} channel={c} onEdit={() => setValues({ channel: c.channel_uuid })} />
          ))}
        </div>
      )}

      <ChannelDialog open={dialogOpen} channel={editing} onClose={() => setValues({ channel: undefined })} />
    </div>
  )
}

function ChannelCard({ channel: c, onEdit }: { channel: Channel; onEdit: () => void }) {
  const { t, i18n } = useTranslation()
  const token = useAccessToken()
  const queryClient = useQueryClient()
  const [testing, setTesting] = React.useState(false)
  const [result, setResult] = React.useState<ChannelTestResult | null>(null)
  const [confirmDelete, setConfirmDelete] = React.useState(false)
  // Optimistic switch value until the refetched list catches up.
  const [pending, setPending] = React.useState<boolean | null>(null)
  const enabled = pending ?? c.enabled

  const refresh = () => queryClient.invalidateQueries({ queryKey: opsKeys.channels() })
  const toggle = async (v: boolean) => {
    setPending(v)
    try {
      await updateChannel(token, c.channel_uuid, { enabled: v })
      toast.success(v ? t('admin.notifications.channels.enabled_toast') : t('admin.notifications.channels.disabled_toast'))
    } catch (err) {
      toast.error(errorMessage(err, t('admin.common.error_desc')))
    } finally {
      await refresh()
      setPending(null)
    }
  }
  const test = async () => {
    setTesting(true)
    try {
      setResult(await testChannel(token, c.channel_uuid))
    } catch (err) {
      setResult({ ok: false, detail: errorMessage(err, t('admin.notifications.channels.test_failed')) })
    } finally {
      setTesting(false)
      refresh()
    }
  }
  const remove = async () => {
    try {
      await deleteChannel(token, c.channel_uuid)
      toast.success(t('admin.notifications.channels.deleted'))
      refresh()
    } catch (err) {
      toast.error(errorMessage(err, t('admin.common.error_desc')))
    }
  }

  const failing = (c.failure_count ?? 0) > 0 || !!c.disabled_reason
  const summary = maskedSummary(c.kind, c.config, t)

  return (
    <section className={`bg-white rounded-2xl nice-shadow p-5 flex flex-col gap-3 min-w-0 ${failing ? 'ring-1 ring-rose-200' : ''}`}>
      <div className="flex items-start gap-3 min-w-0">
        <KindIcon kind={c.kind} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <h3 className="truncate text-sm font-semibold text-neutral-900">{c.name}</h3>
            <span className="shrink-0 text-[11px] font-medium text-neutral-400">{t(`admin.notifications.kinds.${c.kind}`, { defaultValue: c.kind })}</span>
          </div>
          {summary && (
            <p className="mt-0.5 truncate font-mono text-[11px] text-neutral-500" dir="ltr" title={summary}>
              {summary}
            </p>
          )}
        </div>
        <Switch checked={enabled} onChange={toggle} label={t('admin.notifications.channels.enabled_label', { name: c.name })} />
      </div>

      {c.disabled_reason && (
        <p className="flex items-start gap-1.5 text-xs text-rose-600">
          <WarningCircle size={14} weight="fill" className="mt-px shrink-0" />
          <span className="min-w-0 break-words">{t('admin.notifications.channels.auto_disabled', { reason: c.disabled_reason })}</span>
        </p>
      )}
      {(c.failure_count ?? 0) > 0 && (
        <p className="flex items-start gap-1.5 text-xs text-rose-600">
          <WarningCircle size={14} weight="fill" className="mt-px shrink-0" />
          <span className="min-w-0 break-words">
            {t('admin.notifications.channels.failures', { count: c.failure_count ?? 0 })}
            {c.last_error ? ` · ${c.last_error}` : ''}
          </span>
        </p>
      )}

      <p className="text-xs text-neutral-400" title={formatDate(c.last_delivery_at, i18n.language, true)}>
        {c.last_delivery_at
          ? t('admin.notifications.channels.last_delivery', { when: formatRelative(c.last_delivery_at, i18n.language) })
          : t('admin.notifications.channels.never_delivered')}
      </p>

      {c.kind === 'notion' ? (
        <NotionCheck channelUuid={c.channel_uuid} />
      ) : (
        result && <TestResultLine result={result} />
      )}

      <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
        {c.kind !== 'notion' && (
          <Button size="sm" icon={<PaperPlaneTilt size={13} />} onClick={test} loading={testing}>
            {t('admin.notifications.channels.test')}
          </Button>
        )}
        <Button size="sm" icon={<PencilSimple size={13} />} onClick={onEdit}>
          {t('admin.notifications.channels.edit')}
        </Button>
        <Button size="sm" variant="danger-ghost" icon={<Trash size={13} />} onClick={() => setConfirmDelete(true)} className="ms-auto">
          {t('admin.notifications.channels.delete')}
        </Button>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t('admin.notifications.channels.delete_title', { name: c.name })}
        message={t('admin.notifications.channels.delete_desc')}
        confirmLabel={t('admin.notifications.channels.delete')}
        onConfirm={remove}
      />
    </section>
  )
}
