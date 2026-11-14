'use client'
import React, { useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { CheckCircle, FileArrowUp, UploadSimple, WarningCircle } from '@phosphor-icons/react'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import { Button, Chip, TEXTAREA } from '@components/Dashboard/Shared/DashKit/DashKit'
import { useInvalidateGroups, useUG } from './groupsApi'

const SAMPLE = 'email,group,starts_at,expires_at\nana@school.edu,Grade 9,,2026-06-30\n'

export default function ImportMembersDialog({
  open,
  onOpenChange,
  usergroupUuid,
}: {
  open: boolean
  onOpenChange: (_open: boolean) => void
  usergroupUuid?: string
}) {
  const { t } = useTranslation()
  const { call, orgId } = useUG()
  const invalidate = useInvalidateGroups()
  const fileRef = useRef<HTMLInputElement>(null)
  const [csv, setCsv] = useState('')
  const [preview, setPreview] = useState<any | null>(null)
  const [busy, setBusy] = useState(false)

  const reset = () => {
    setCsv('')
    setPreview(null)
  }
  const close = (o: boolean) => {
    if (!o) reset()
    onOpenChange(o)
  }
  const body = () => ({ csv, usergroup_uuid: usergroupUuid || undefined })
  const check = async () => {
    setBusy(true)
    try {
      setPreview(await call('POST', `org/${orgId}/import/preview`, body()))
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setBusy(false)
    }
  }
  const apply = async () => {
    setBusy(true)
    try {
      const out = await call<any>('POST', `org/${orgId}/import`, body())
      toast.success(t('groups.import.done', { count: out.ok }))
      invalidate()
      close(false)
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setBusy(false)
    }
  }
  const onFile = async (f?: File | null) => {
    if (!f) return
    setCsv(await f.text())
    setPreview(null)
  }

  return (
    <Modal
      isDialogOpen={open}
      onOpenChange={close}
      size="lg"
      icon={<FileArrowUp size={16} />}
      dialogTitle={t('groups.import.title')}
      dialogDescription={usergroupUuid ? t('groups.import.desc_one') : t('groups.import.desc')}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-neutral-500">{preview ? t('groups.import.summary', { ok: preview.ok, errors: preview.errors }) : t('groups.import.dry_run_hint')}</span>
          <div className="flex gap-2">
            <Button onClick={() => close(false)}>{t('common.cancel')}</Button>
            {!preview ? (
              <Button variant="primary" disabled={!csv.trim()} loading={busy} onClick={check} data-testid="import-check">
                {t('groups.import.check')}
              </Button>
            ) : (
              <Button variant="primary" disabled={!preview.ok} loading={busy} onClick={apply} data-testid="import-apply">
                {t('groups.import.apply', { count: preview.ok })}
              </Button>
            )}
          </div>
        </div>
      }
      dialogContent={
        !preview ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button icon={<UploadSimple size={14} />} onClick={() => fileRef.current?.click()}>
                {t('groups.import.choose_file')}
              </Button>
              <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} data-testid="import-file" />
              <span className="text-xs text-neutral-500">{t('groups.import.or_paste')}</span>
            </div>
            <textarea
              className={`${TEXTAREA} font-mono text-xs`}
              rows={9}
              value={csv}
              onChange={(e) => setCsv(e.target.value)}
              placeholder={SAMPLE}
              aria-label={t('groups.import.title')}
              data-testid="import-text"
            />
            <p className="text-xs text-neutral-500">{t('groups.import.columns')}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              <Chip tone="emerald" icon={<CheckCircle size={12} weight="fill" />}>
                {t('groups.import.ok_rows', { count: preview.ok })}
              </Chip>
              {preview.errors > 0 && (
                <Chip tone="rose" icon={<WarningCircle size={12} weight="fill" />}>
                  {t('groups.import.error_rows', { count: preview.errors })}
                </Chip>
              )}
              <button type="button" onClick={() => setPreview(null)} className="ms-auto text-xs font-medium text-neutral-500 hover:text-neutral-900">
                {t('groups.import.edit')}
              </button>
            </div>
            <div className="rounded-xl ring-1 ring-inset ring-neutral-200 max-h-80 overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-neutral-50 text-xs text-neutral-500">
                  <tr>
                    <th className="text-start font-medium px-3 py-2">{t('groups.import.line')}</th>
                    <th className="text-start font-medium px-3 py-2">{t('groups.import.email')}</th>
                    <th className="text-start font-medium px-3 py-2">{t('groups.import.group')}</th>
                    <th className="text-start font-medium px-3 py-2">{t('groups.import.result')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {preview.rows.map((r: any) => (
                    <tr key={r.line} className={r.status === 'error' ? 'bg-rose-50/40' : ''}>
                      <td className="px-3 py-2 text-xs text-neutral-400 tabular-nums">{r.line}</td>
                      <td className="px-3 py-2 truncate max-w-[200px]" dir="auto">{r.email || '—'}</td>
                      <td className="px-3 py-2 truncate max-w-[160px]" dir="auto">{r.group || '—'}</td>
                      <td className="px-3 py-2">
                        {r.status === 'ok' ? (
                          <Chip tone="emerald" className="!py-0.5 !text-[11px]">
                            {r.action === 'schedule' ? t('groups.import.will_schedule') : t('groups.import.will_add')}
                          </Chip>
                        ) : (
                          <Chip tone="rose" className="!py-0.5 !text-[11px]">
                            {t(`groups.import.errors.${r.error}`, { defaultValue: r.error })}
                          </Chip>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      }
    />
  )
}
