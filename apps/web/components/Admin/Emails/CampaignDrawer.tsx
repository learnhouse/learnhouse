'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  CalendarPlus,
  CheckCircle,
  Eye,
  Megaphone,
  PaperPlaneTilt,
  PencilSimple,
  Prohibit,
  Seal,
  Trash,
  Users,
  WarningCircle,
  XCircle,
  Flask,
} from '@phosphor-icons/react'
import { Button, ConfirmDialog, EmptyState, FieldLabel, INPUT, Skeleton, StatCard, Chip } from '@/design'
import { errorMessage } from '@services/ee/platform/api'
import {
  SEND_STATUSES,
  approveCampaign,
  cancelCampaign,
  deleteCampaign,
  getCampaign,
  listCampaignRecipients,
  opsKeys,
  previewCampaign,
  scheduleCampaign,
  sendCampaign,
  testCampaign,
  type Campaign,
  type CampaignPreview,
} from '@services/ee/platform/ops'
import { shouldRetry, useAccessToken, usePlatformMe } from '@components/Admin/hooks'
import { Pagination, QueryError, adminPath, formatDate } from '@components/Admin/Shared/AdminKit'
import { DetailRows, IconTile, SideDrawer, fromLocalInput, toLocalInput } from '@components/Admin/Shared/OpsKit'
import CampaignForm from './CampaignForm'
import { CampaignStatusPill, CategoryChip, EmailFrame, SendStatusPill, useTemplates } from './emailUi'
import Link from 'next/link'

// One campaign, opened from `?campaign=<uuid>` (or `new`). Drafts can be
// edited; every campaign shows its preview, the send controls its status
// allows, stats and the per-recipient log.

const RECIPIENTS_PAGE = 25

export default function CampaignDrawer({
  campaignId,
  onClose,
  onOpen,
}: {
  campaignId: string | null
  onClose: () => void
  onOpen: (uuid: string) => void
}) {
  const { t } = useTranslation()
  const token = useAccessToken()
  const isNew = campaignId === 'new'
  const q = useQuery({
    queryKey: opsKeys.campaign(campaignId ?? ''),
    queryFn: () => getCampaign(token, campaignId!),
    enabled: !!token && !!campaignId && !isNew,
    retry: shouldRetry,
  })
  const campaign = q.data
  const [editing, setEditing] = React.useState(false)
  React.useEffect(() => setEditing(false), [campaignId])

  return (
    <SideDrawer
      open={!!campaignId}
      onClose={onClose}
      width="sm:w-[min(760px,100vw)]"
      icon={<IconTile icon={<Megaphone size={18} />} tone="violet" />}
      title={isNew ? t('admin.emails.new_campaign') : campaign?.name || t('admin.emails.campaign')}
      subtitle={campaign ? <CampaignStatusPill status={campaign.status} /> : undefined}
      copyHref={isNew ? false : undefined}
    >
      {isNew ? (
        <CampaignForm onSaved={(c) => onOpen(c.campaign_uuid)} onCancel={onClose} />
      ) : q.isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : q.error || !campaign ? (
        <QueryError error={q.error} compact onRetry={() => q.refetch()} />
      ) : editing ? (
        <CampaignForm campaign={campaign} onSaved={() => setEditing(false)} onCancel={() => setEditing(false)} />
      ) : (
        <CampaignDetail campaign={campaign} onEdit={() => setEditing(true)} onDeleted={onClose} />
      )}
    </SideDrawer>
  )
}

function CampaignDetail({ campaign, onEdit, onDeleted }: { campaign: Campaign; onEdit: () => void; onDeleted: () => void }) {
  const { t, i18n } = useTranslation()
  const token = useAccessToken()
  const me = usePlatformMe()
  const qc = useQueryClient()
  const { templates } = useTemplates()
  const template = templates.find((x) => x.template_uuid === campaign.template_uuid)
  const uuid = campaign.campaign_uuid
  const status = campaign.status
  const draft = status === 'draft'
  const sendable = status === 'draft' || status === 'scheduled'
  const isOwner = me.role === 'owner' || me.legacy

  const [preview, setPreview] = React.useState<CampaignPreview | null>(null)
  const [previewing, setPreviewing] = React.useState(false)
  const [testing, setTesting] = React.useState(false)
  const [when, setWhen] = React.useState(toLocalInput(campaign.scheduled_at))
  const [confirm, setConfirm] = React.useState<'send' | 'cancel' | 'delete' | 'schedule' | null>(null)
  const [sample, setSample] = React.useState(0)

  const refresh = () => {
    qc.invalidateQueries({ queryKey: opsKeys.campaigns() })
  }
  const run = async (fn: () => Promise<unknown>, done: string) => {
    try {
      await fn()
      toast.success(done)
      refresh()
      return true
    } catch (err) {
      toast.error(errorMessage(err, t('admin.common.error_desc')))
      return false
    }
  }

  const loadPreview = async () => {
    setPreviewing(true)
    try {
      const p = await previewCampaign(token, uuid)
      setPreview(p)
      setSample(0)
      return p
    } catch (err) {
      toast.error(errorMessage(err, t('admin.common.error_desc')))
      return null
    } finally {
      setPreviewing(false)
    }
  }

  const sendTest = async () => {
    setTesting(true)
    try {
      const r = await testCampaign(token, uuid)
      if (r.ok) toast.success(t('admin.emails.test_sent', { to: r.to ?? '' }))
      else toast.error(r.error || t('admin.emails.test_failed'))
    } catch (err) {
      toast.error(errorMessage(err, t('admin.emails.test_failed')))
    } finally {
      setTesting(false)
    }
  }

  const askSend = async () => {
    const p = preview ?? (await loadPreview())
    if (p) setConfirm('send')
  }

  const needsApproval = preview?.needs_approval ?? (campaign.recipients === 'all_members' || Number(campaign.stats?.targeted ?? 0) > 500)
  const approved = preview?.approved ?? !!campaign.approved_at
  const blocked = needsApproval && !approved
  const stats = campaign.stats ?? {}
  const num = (k: string) => Number(stats[k] ?? 0) || 0
  const skipped = Object.keys(stats)
    .filter((k) => k.startsWith('skipped'))
    .reduce((a, k) => a + num(k), 0)
  const samples = Array.isArray(preview?.samples) ? preview!.samples : []
  const current = samples[sample] as (CampaignPreview['samples'][number] & { email?: string }) | undefined
  const filters = campaign.audience?.filters ?? {}

  return (
    <>
      {(status !== 'draft' || num('targeted') > 0) && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard icon={<Users size={18} />} iconClass="bg-sky-50 text-sky-600" label={t('admin.emails.stat.targeted')} value={num('targeted')} />
          <StatCard icon={<CheckCircle size={18} />} iconClass="bg-emerald-50 text-emerald-600" label={t('admin.emails.stat.sent')} value={num('sent')} />
          <StatCard icon={<XCircle size={18} />} iconClass="bg-rose-50 text-rose-600" label={t('admin.emails.stat.failed')} value={num('failed')} />
          <StatCard icon={<Prohibit size={18} />} iconClass="bg-amber-50 text-amber-600" label={t('admin.emails.stat.skipped')} value={skipped} />
        </div>
      )}

      <section className="space-y-3">
        <DetailRows
          rows={[
            {
              label: t('admin.emails.template'),
              value: template ? (
                <span className="inline-flex items-center gap-1.5">
                  <Link href={`/admin/emails?template=${template.template_uuid}`} className="hover:underline underline-offset-2">
                    {template.name}
                  </Link>
                  <CategoryChip category={template.category} />
                </span>
              ) : (
                <span className="text-rose-600">{t('admin.emails.template_missing')}</span>
              ),
            },
            { label: t('admin.emails.recipients_title'), value: t(`admin.emails.recipients.${campaign.recipients}`, { defaultValue: campaign.recipients }) },
            {
              label: t('admin.emails.audience_title'),
              value: campaign.audience?.saved_view_uuid ? (
                t('admin.emails.audience_saved_view')
              ) : Object.keys(filters).length === 0 ? (
                t('admin.emails.audience_all_orgs')
              ) : (
                <span className="inline-flex flex-wrap justify-end gap-1">
                  {Object.entries(filters).map(([k, v]) => (
                    <Chip key={k}>{`${k}: ${String(v)}`}</Chip>
                  ))}
                </span>
              ),
            },
            {
              label: t('admin.emails.approval'),
              value: approved ? (
                <span className="text-emerald-600">{t('admin.emails.approved')}</span>
              ) : needsApproval ? (
                <span className="text-amber-600">{t('admin.emails.needs_approval')}</span>
              ) : (
                t('admin.emails.no_approval_needed')
              ),
            },
            { label: t('admin.emails.scheduled_for'), value: formatDate(campaign.scheduled_at, i18n.language, true), hidden: !campaign.scheduled_at },
            { label: t('admin.emails.sent_at'), value: formatDate(campaign.sent_at, i18n.language, true), hidden: !campaign.sent_at },
            { label: t('admin.emails.created'), value: formatDate(campaign.created_at, i18n.language, true) },
          ]}
        />
      </section>

      <section className="flex flex-wrap gap-2">
        <Button icon={<Eye size={14} />} onClick={loadPreview} loading={previewing}>
          {preview ? t('admin.emails.refresh_preview') : t('admin.emails.preview')}
        </Button>
        <Button icon={<Flask size={14} />} onClick={sendTest} loading={testing}>
          {t('admin.emails.send_test')}
        </Button>
        {draft && (
          <Button icon={<PencilSimple size={14} />} onClick={onEdit}>
            {t('admin.emails.edit')}
          </Button>
        )}
        {needsApproval && !approved && isOwner && sendable && (
          <Button icon={<Seal size={14} />} onClick={() => run(() => approveCampaign(token, uuid), t('admin.emails.approved_toast')).then((ok) => { if (ok) loadPreview() })}>
            {t('admin.emails.approve')}
          </Button>
        )}
        {(status === 'draft' || status === 'scheduled' || status === 'sending') && (
          <Button variant="danger-ghost" icon={<Prohibit size={14} />} onClick={() => setConfirm('cancel')}>
            {t('admin.emails.cancel_campaign')}
          </Button>
        )}
        {(status === 'draft' || status === 'cancelled') && (
          <Button variant="danger-ghost" icon={<Trash size={14} />} onClick={() => setConfirm('delete')}>
            {t('common.delete')}
          </Button>
        )}
      </section>

      {blocked && sendable && (
        <p className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-xs text-amber-700">
          <WarningCircle size={14} className="mt-px shrink-0" />
          {isOwner ? t('admin.emails.approval_owner_hint') : t('admin.emails.approval_wait_hint')}
        </p>
      )}

      {preview && (
        <section className="space-y-3">
          <p className="text-sm text-neutral-700">
            {t('admin.emails.preview_counts', { count: preview.recipients, orgs: preview.orgs })}
          </p>
          {samples.length > 0 ? (
            <>
              <div className="flex flex-wrap items-center gap-1.5">
                {samples.map((s, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setSample(i)}
                    aria-pressed={sample === i}
                    className={`h-7 px-2.5 rounded-full text-xs font-semibold truncate max-w-[14rem] ${sample === i ? 'bg-neutral-900 text-white' : 'bg-white nice-shadow text-neutral-600'}`}
                  >
                    {(s as { email?: string }).email ?? s.to ?? t('admin.emails.sample_n', { n: i + 1 })}
                  </button>
                ))}
              </div>
              {current && (
                <div className="space-y-2">
                  <p className="text-sm font-semibold text-neutral-900 break-words">{current.subject}</p>
                  {current.html && <EmailFrame html={current.html} title={t('admin.emails.sample_n', { n: sample + 1 })} />}
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-neutral-500">{t('admin.emails.preview_no_recipients')}</p>
          )}
        </section>
      )}

      {sendable && (
        <section className="space-y-3 border-t border-neutral-100 pt-5">
          <p className="text-sm font-semibold text-neutral-900">{t('admin.emails.send_title')}</p>
          <div className="flex flex-col sm:flex-row sm:items-end gap-2">
            <div className="flex-1 min-w-0">
              <FieldLabel hint={t('admin.emails.schedule_hint')}>{t('admin.emails.schedule_for')}</FieldLabel>
              <input type="datetime-local" className={INPUT} value={when} onChange={(e) => setWhen(e.target.value)} min={toLocalInput(new Date().toISOString())} />
            </div>
            <Button icon={<CalendarPlus size={14} />} disabled={!when || blocked} onClick={() => setConfirm('schedule')}>
              {t('admin.emails.schedule')}
            </Button>
            <Button variant="primary" icon={<PaperPlaneTilt size={14} />} disabled={blocked} loading={previewing} onClick={askSend}>
              {t('admin.emails.send_now')}
            </Button>
          </div>
        </section>
      )}

      {status !== 'draft' && <RecipientsTable uuid={uuid} />}

      <ConfirmDialog
        open={confirm === 'send'}
        onOpenChange={(o) => !o && setConfirm(null)}
        tone="info"
        title={t('admin.emails.send_confirm_title', { name: campaign.name })}
        message={t('admin.emails.send_confirm_desc', { count: preview?.recipients ?? 0, orgs: preview?.orgs ?? 0 })}
        confirmLabel={t('admin.emails.send_now')}
        onConfirm={() => run(() => sendCampaign(token, uuid), t('admin.emails.sending_toast'))}
      />
      <ConfirmDialog
        open={confirm === 'schedule'}
        onOpenChange={(o) => !o && setConfirm(null)}
        tone="info"
        title={t('admin.emails.schedule_confirm_title')}
        message={t('admin.emails.schedule_confirm_desc', { date: when ? new Date(when).toLocaleString(i18n.language) : '' })}
        confirmLabel={t('admin.emails.schedule')}
        onConfirm={() => run(() => scheduleCampaign(token, uuid, fromLocalInput(when) ?? ''), t('admin.emails.scheduled_toast'))}
      />
      <ConfirmDialog
        open={confirm === 'cancel'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={t('admin.emails.cancel_confirm_title', { name: campaign.name })}
        message={t('admin.emails.cancel_confirm_desc')}
        confirmLabel={t('admin.emails.cancel_campaign')}
        onConfirm={() => run(() => cancelCampaign(token, uuid), t('admin.emails.cancelled_toast'))}
      />
      <ConfirmDialog
        open={confirm === 'delete'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={t('admin.emails.delete_campaign_title', { name: campaign.name })}
        message={t('admin.emails.delete_campaign_desc')}
        confirmLabel={t('common.delete')}
        onConfirm={() => run(() => deleteCampaign(token, uuid), t('admin.emails.campaign_deleted')).then((ok) => ok && onDeleted())}
      />
    </>
  )
}

function RecipientsTable({ uuid }: { uuid: string }) {
  const { t, i18n } = useTranslation()
  const token = useAccessToken()
  const [status, setStatus] = React.useState('')
  const [page, setPage] = React.useState(1)
  const query = { status: status || undefined, page, limit: RECIPIENTS_PAGE }
  const q = useQuery({
    queryKey: opsKeys.campaignRecipients(uuid, query),
    queryFn: () => listCampaignRecipients(token, uuid, query),
    enabled: !!token,
    retry: shouldRetry,
    placeholderData: (prev) => prev,
    refetchInterval: 15_000,
  })
  const items = Array.isArray(q.data?.items) ? q.data!.items : []
  return (
    <section className="space-y-3 border-t border-neutral-100 pt-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-neutral-900">{t('admin.emails.recipients_log', { count: q.data?.total ?? 0 })}</p>
        <select
          className={`${INPUT} w-auto`}
          value={status}
          onChange={(e) => {
            setStatus(e.target.value)
            setPage(1)
          }}
          aria-label={t('admin.emails.filter_status')}
        >
          <option value="">{t('admin.emails.all_statuses')}</option>
          {SEND_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`admin.emails.send_status.${s}`)}
            </option>
          ))}
        </select>
      </div>
      {q.isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : q.error ? (
        <QueryError error={q.error} compact onRetry={() => q.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState icon={<Users size={20} />} title={t('admin.emails.no_recipients')} description={t('admin.emails.no_recipients_desc')} />
      ) : (
        <div className="divide-y divide-neutral-100">
          {items.map((r, i) => (
            <div key={r.id ?? i} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
              <span className="min-w-0 flex-1 truncate text-sm text-neutral-900" dir="ltr">
                {r.email}
              </span>
              {r.org_id ? (
                <Link href={adminPath.org(r.org_id)} className="text-xs text-neutral-500 hover:underline underline-offset-2">
                  {r.org_name || `#${r.org_id}`}
                </Link>
              ) : null}
              <SendStatusPill status={r.status} />
              <span className="w-full sm:w-auto text-xs text-neutral-400">
                {r.error ? <span className="text-rose-600">{r.error}</span> : formatDate(r.sent_at, i18n.language, true)}
              </span>
            </div>
          ))}
        </div>
      )}
      <Pagination page={page} total={q.data?.total ?? 0} limit={RECIPIENTS_PAGE} onPage={setPage} />
    </section>
  )
}
