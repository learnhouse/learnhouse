'use client'
import React from 'react'
import toast from 'react-hot-toast'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ClockCounterClockwise, Warning } from '@phosphor-icons/react'
import { Button, FieldLabel, Modal, Skeleton } from '@/design'
import { queryKeys } from '@/lib/query/keys'
import { getAuditSettings, updateAuditSettings } from '@services/ee/audit_logs'
import { useAuditText } from './auditUi'

type Props = { orgId?: number; token?: string; open: boolean; onClose: () => void }

export function useRetentionLabel() {
  const text = useAuditText()
  return (days: number) => {
    if (days % 365 === 0) {
      const years = days / 365
      return years === 1 ? text('retention.year') : text('retention.years', undefined, { count: years })
    }
    return text('retention.days', undefined, { count: days })
  }
}

export default function AuditRetentionDialog({ orgId, token, open, onClose }: Props) {
  const text = useAuditText()
  const label = useRetentionLabel()
  const queryClient = useQueryClient()
  const key = [...queryKeys.org.auditLogs(orgId ?? 0), 'settings']
  const { data, isLoading } = useQuery({
    queryKey: key,
    queryFn: () => getAuditSettings(orgId as number, token as string),
    enabled: open && !!orgId && !!token,
  })
  const [value, setValue] = React.useState<number | null>(null)
  const [saving, setSaving] = React.useState(false)
  const selected = value ?? data?.retention_days ?? null
  const shorter = data && selected !== null && selected < data.retention_days

  const save = async () => {
    if (!orgId || !token || selected === null) return
    setSaving(true)
    try {
      const next = await updateAuditSettings(orgId, token, selected)
      queryClient.setQueryData(key, next)
      queryClient.invalidateQueries({ queryKey: queryKeys.org.auditLogs(orgId) })
      toast.success(text('retention.saved'))
      onClose()
    } catch {
      toast.error(text('retention.failed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      isDialogOpen={open}
      onOpenChange={(o) => !o && onClose()}
      size="sm"
      icon={<ClockCounterClockwise size={16} />}
      dialogTitle={text('retention.title')}
      dialogDescription={text('retention.description')}
      preventClose={saving}
      dialogContent={
        <div className="flex flex-col gap-3">
          <FieldLabel>{text('retention.label')}</FieldLabel>
          {isLoading || !data ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {[0, 1, 2].map((i) => <Skeleton key={i} className="h-10" />)}
            </div>
          ) : (
            <div role="radiogroup" aria-label={text('retention.label')} className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {data.choices.map((days) => {
                const active = selected === days
                return (
                  <button
                    key={days}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setValue(days)}
                    className={`h-10 px-3 rounded-xl text-sm font-semibold transition-colors ring-1 ring-inset ${
                      active ? 'bg-neutral-900 text-white ring-neutral-900' : 'bg-white text-neutral-700 ring-neutral-200 hover:bg-neutral-50'
                    }`}
                  >
                    {label(days)}
                    {days === data.default_retention_days && (
                      <span className={`ms-1 text-[10px] font-medium ${active ? 'text-white/60' : 'text-neutral-400'}`}>
                        ({text('retention.default')})
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          )}
          {shorter && (
            <p className="flex items-start gap-2 rounded-xl bg-amber-50 text-amber-900 text-xs px-3 py-2">
              <Warning size={14} className="shrink-0 mt-0.5" />
              {text('retention.shorter_warning')}
            </p>
          )}
        </div>
      }
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>{text('retention.cancel')}</Button>
          <Button
            variant="primary"
            onClick={save}
            loading={saving}
            disabled={!data || selected === null || selected === data.retention_days}
          >
            {text('retention.save')}
          </Button>
        </div>
      }
    />
  )
}
