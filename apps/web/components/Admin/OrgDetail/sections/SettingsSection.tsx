'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Buildings, CreditCard, Pause, Play, Prohibit, Tag, Trash, UserCircle, Warning, X } from '@phosphor-icons/react'
import { Button, ConfirmDialog, FieldLabel, INPUT, SectionCard, SegmentedControl, TEXTAREA } from '@/design'
import { errorMessage, saRequest, updateOrgPlan, updateOrgProfile, updateOrgSettings } from '@services/ee/platform/api'
import { platformKeys } from '@services/ee/platform/keys'
import type { OrgProfile } from '@services/ee/platform/types'
import { usePlatformMe, useAccessToken } from '@components/Admin/hooks'
import { QueryError } from '@components/Admin/Shared/AdminKit'
import { useInvalidateOrg, useTeamMembers } from '../orgQueries'
import { DeleteOrgRow } from '../DeletionPanel'

// Settings are edited where they sit: each field saves on its own (a small
// Save / Cancel shows up next to the one you changed). Anything that can hurt
// lives in the Danger zone at the bottom, with the consequence spelled out.

// ─── inline field ────────────────────────────────────────────────────────────

function InlineField({
  label,
  hint,
  value,
  onSave,
  disabled,
  multiline,
  mono,
  type = 'text',
  warning,
  validate,
}: {
  label: string
  hint?: string
  value: string
  onSave: (_next: string) => Promise<void>
  disabled?: boolean
  multiline?: boolean
  mono?: boolean
  type?: string
  /** Shown while the value differs from the saved one. */
  warning?: string
  /** Returns an error message for an invalid value (Save stays disabled). */
  validate?: (_value: string) => string | null
}) {
  const { t } = useTranslation()
  const [draft, setDraft] = React.useState(value)
  const [saving, setSaving] = React.useState(false)
  React.useEffect(() => setDraft(value), [value])
  const dirty = draft !== value
  const error = dirty && validate ? validate(draft.trim()) : null

  const save = async () => {
    if (error) return
    setSaving(true)
    try {
      await onSave(draft.trim())
    } catch {
      // onSave already showed the error in a toast; keep the draft for a retry.
    } finally {
      setSaving(false)
    }
  }
  const field = multiline ? (
    <textarea rows={3} value={draft} disabled={disabled} onChange={(e) => setDraft(e.target.value)} className={TEXTAREA} />
  ) : (
    <input
      type={type}
      value={draft}
      dir={mono ? 'ltr' : undefined}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && dirty && !error) save()
        if (e.key === 'Escape') setDraft(value)
      }}
      className={`${INPUT} ${mono ? 'font-mono' : ''}`}
    />
  )
  return (
    <div className="grid grid-cols-1 md:grid-cols-[14rem_minmax(0,1fr)] gap-x-6 gap-y-2 py-4 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-neutral-900 flex items-center gap-2">
          {label}
          {dirty && <span className="h-1.5 w-1.5 rounded-full bg-amber-400" aria-label={t('dashboard.kit.unsaved_changes')} />}
        </p>
        {hint && <p className="mt-0.5 text-xs text-neutral-500">{hint}</p>}
      </div>
      <div className="min-w-0 space-y-2">
        {field}
        {error && <p className="text-xs font-medium text-rose-600">{error}</p>}
        {dirty && warning && !error && (
          <p className="flex items-start gap-1.5 text-xs font-medium text-amber-700">
            <Warning size={13} className="mt-px shrink-0" />
            {warning}
          </p>
        )}
        {dirty && (
          <div className="flex justify-end gap-2">
            <Button size="sm" onClick={() => setDraft(value)} disabled={saving}>
              {t('common.cancel')}
            </Button>
            <Button size="sm" variant="primary" onClick={save} loading={saving} disabled={!!error}>
              {t('common.save')}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

/** Label column + control column, the same grid as InlineField. */
function FormRow({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-[14rem_minmax(0,1fr)] gap-x-6 gap-y-2 py-4 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-neutral-900">{label}</p>
        {hint && <p className="mt-0.5 text-xs text-neutral-500">{hint}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

// ─── identity ────────────────────────────────────────────────────────────────

function IdentitySettings({ org, orgId }: { org: any; orgId: string }) {
  const { t } = useTranslation()
  const token = useAccessToken()
  const me = usePlatformMe()
  const invalidate = useInvalidateOrg(orgId)
  const canEdit = me.can('orgs.update')
  const current = { name: org.name || '', slug: org.slug || '', email: org.email || '', description: org.description || '' }

  // The settings endpoint takes the whole set; send the saved values plus the one change.
  const saveField = (key: keyof typeof current) => async (next: string) => {
    try {
      await updateOrgSettings(token, orgId, { ...current, [key]: next })
      toast.success(t('admin.org_detail.settings_saved'))
      invalidate()
    } catch (err) {
      toast.error(errorMessage(err, t('admin.org_detail.failed_save')))
      throw err
    }
  }

  const required = (v: string) => (v ? null : t('admin.org.v_name_required'))
  const slugRule = (v: string) => (/^[a-z0-9]+(-[a-z0-9]+)*$/.test(v) ? null : t('admin.create_org.slug_invalid'))
  const emailRule = (v: string) => (!v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? null : t('admin.create_org.email_invalid'))

  return (
    <SectionCard icon={<Buildings size={18} />} title={t('admin.org_detail.org_settings')} description={canEdit ? t('admin.org.settings_desc_inline') : t('admin.org.settings_readonly')}>
      <div className="divide-y divide-neutral-100">
        <InlineField label={t('admin.org_detail.name')} hint={t('admin.org.name_hint')} value={current.name} onSave={saveField('name')} disabled={!canEdit} validate={required} />
        <InlineField label={t('admin.org_detail.email')} hint={t('admin.org.email_hint')} type="email" value={current.email} onSave={saveField('email')} disabled={!canEdit} validate={emailRule} />
        <InlineField
          label={t('admin.org_detail.slug')}
          hint={t('admin.org.slug_short_hint')}
          value={current.slug}
          onSave={saveField('slug')}
          disabled={!canEdit}
          mono
          warning={t('admin.org_detail.slug_hint')}
          validate={slugRule}
        />
        <InlineField label={t('admin.org_detail.description')} value={current.description} onSave={saveField('description')} disabled={!canEdit} multiline />
      </div>
    </SectionCard>
  )
}

// ─── tags + account owner ────────────────────────────────────────────────────

function AccountSettings({ orgId, profileQ }: { orgId: string; profileQ: UseQueryResult<OrgProfile, unknown> }) {
  const { t } = useTranslation()
  const token = useAccessToken()
  const qc = useQueryClient()
  const me = usePlatformMe()
  const invalidate = useInvalidateOrg(orgId)
  const canWrite = me.can('notes.write')
  const team = useTeamMembers(!!profileQ.data)
  const members = Array.isArray(team.data?.members) ? team.data!.members : []
  const profile = profileQ.data
  const tags = Array.isArray(profile?.tags) ? profile!.tags : []
  const [tagInput, setTagInput] = React.useState('')

  const saveProfile = async (body: { tags?: string[]; account_owner_user_id?: number | null }, ok: string) => {
    const key = platformKeys.orgProfile(orgId)
    const prev = qc.getQueryData<OrgProfile>(key)
    if (prev) qc.setQueryData<OrgProfile>(key, { ...prev, ...body })
    try {
      await updateOrgProfile(token, orgId, body)
      toast.success(ok)
    } catch (err) {
      if (prev) qc.setQueryData(key, prev)
      toast.error(errorMessage(err, t('admin.common.error_desc')))
    } finally {
      invalidate()
    }
  }

  const addTag = () => {
    const tag = tagInput.trim().toLowerCase().replace(/\s+/g, '-').slice(0, 32)
    if (!tag || tags.includes(tag)) {
      setTagInput('')
      return
    }
    if (tags.length >= 20) {
      toast.error(t('admin.org.tags_max'))
      return
    }
    setTagInput('')
    saveProfile({ tags: [...tags, tag] }, t('admin.org.tags_saved'))
  }

  if (profileQ.isLoading) return null
  if (profileQ.error || !profile) {
    return (
      <SectionCard icon={<Tag size={18} />} title={t('admin.org.account_settings')} description={t('admin.org.account_settings_desc')}>
        <QueryError error={profileQ.error} compact />
      </SectionCard>
    )
  }

  return (
    <SectionCard icon={<Tag size={18} />} title={t('admin.org.account_settings')} description={t('admin.org.account_settings_desc')}>
      <div className="divide-y divide-neutral-100">
        <FormRow label={t('admin.org.tags')} hint={t('admin.org.tags_hint')}>
          <div className="flex flex-wrap items-center gap-1.5">
            {tags.map((tag) => (
              <span key={tag} className="inline-flex items-center gap-1 rounded-lg bg-neutral-100 ps-2 pe-1 py-1 text-xs font-medium text-neutral-700">
                {tag}
                {canWrite && (
                  <button
                    type="button"
                    onClick={() => saveProfile({ tags: tags.filter((x) => x !== tag) }, t('admin.org.tags_saved'))}
                    aria-label={t('admin.org.remove_tag', { tag })}
                    className="h-4 w-4 inline-flex items-center justify-center rounded text-neutral-400 hover:text-neutral-800 hover:bg-neutral-200"
                  >
                    <X size={10} weight="bold" />
                  </button>
                )}
              </span>
            ))}
            {!tags.length && <span className="text-xs text-neutral-400">{t('admin.org.no_tags')}</span>}
          </div>
          {canWrite && (
            <div className="mt-2.5 flex gap-2 max-w-md">
              <input
                value={tagInput}
                maxLength={32}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addTag()
                  }
                }}
                placeholder={t('admin.org.tag_placeholder')}
                className={INPUT}
              />
              <Button onClick={addTag} disabled={!tagInput.trim()}>
                {t('admin.org.add_tag')}
              </Button>
            </div>
          )}
        </FormRow>
        <FormRow label={t('admin.org.account_owner')} hint={t('admin.org.owner_hint')}>
          <div className="flex items-center gap-2 max-w-md">
            <UserCircle size={18} className="text-neutral-400 shrink-0" />
            <select
              value={profile.account_owner_user_id ?? profile.account_owner?.user_id ?? ''}
              disabled={!canWrite || team.isLoading}
              onChange={(e) =>
                saveProfile({ account_owner_user_id: e.target.value ? Number(e.target.value) : null }, t('admin.org.owner_saved'))
              }
              className={INPUT}
            >
              <option value="">{t('admin.org.no_owner')}</option>
              {members.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.username} · {t(`admin.roles.${m.role}`, { defaultValue: m.role })}
                </option>
              ))}
            </select>
          </div>
          {team.error ? <p className="mt-1 text-xs text-neutral-400">{t('admin.org.team_unavailable')}</p> : null}
        </FormRow>
        <StatusRow orgId={orgId} profile={profile} />
      </div>
    </SectionCard>
  )
}

// ─── status (safe changes) ───────────────────────────────────────────────────

function StatusRow({ orgId, profile }: { orgId: string; profile: OrgProfile }) {
  const { t } = useTranslation()
  const token = useAccessToken()
  const me = usePlatformMe()
  const invalidate = useInvalidateOrg(orgId)
  const current = profile.lifecycle
  const [pending, setPending] = React.useState<'active' | 'trial' | null>(null)
  // Only the harmless labels are switched here; suspend/close are in the Danger zone.
  if (!me.can('orgs.lifecycle') || (current !== 'active' && current !== 'trial')) return null
  const label = (l: string) => t(`admin.lifecycle.${l}`, { defaultValue: l })
  const save = async () => {
    if (!pending) return
    try {
      await updateOrgProfile(token, orgId, { lifecycle: pending })
      toast.success(t('admin.org.lifecycle_saved', { lifecycle: label(pending) }))
      invalidate()
    } catch (err) {
      toast.error(errorMessage(err, t('admin.common.error_desc')))
    }
  }
  return (
    <FormRow label={t('admin.org.lifecycle')} hint={t('admin.org.status_hint')}>
      <SegmentedControl
        value={current as 'active' | 'trial'}
        onChange={(v) => v !== current && setPending(v)}
        ariaLabel={t('admin.org.lifecycle')}
        options={[
          { key: 'active', label: label('active') },
          { key: 'trial', label: label('trial') },
        ]}
      />
      <ConfirmDialog
        open={!!pending}
        onOpenChange={(o) => !o && setPending(null)}
        tone="info"
        title={t('admin.org.status_confirm_title', { lifecycle: label(pending ?? 'active') })}
        message={t(`admin.org.lifecycle_confirm_${pending ?? 'active'}`)}
        confirmLabel={t('admin.org.lifecycle_set', { lifecycle: label(pending ?? 'active') })}
        onConfirm={save}
      />
    </FormRow>
  )
}

// ─── danger zone ─────────────────────────────────────────────────────────────

function DangerRow({ icon, title, description, action }: { icon: React.ReactNode; title: string; description: React.ReactNode; action: React.ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6 py-4 first:pt-0 last:pb-0">
      <div className="flex items-start gap-3 min-w-0 flex-1">
        <span className="mt-0.5 text-rose-600 shrink-0">{icon}</span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-neutral-900">{title}</p>
          <div className="mt-0.5 text-xs text-neutral-500">{description}</div>
        </div>
      </div>
      <div className="shrink-0">{action}</div>
    </div>
  )
}

type DangerKind = 'suspend' | 'unsuspend' | 'close' | 'reopen' | 'downgrade'

function DangerZone({ org, orgId, profileQ, isSaaS }: { org: any; orgId: string; profileQ: UseQueryResult<OrgProfile, unknown>; isSaaS: boolean }) {
  const { t } = useTranslation()
  const token = useAccessToken()
  const me = usePlatformMe()
  const invalidate = useInvalidateOrg(orgId)
  const [kind, setKind] = React.useState<DangerKind | null>(null)
  const [reason, setReason] = React.useState('')
  const profile = profileQ.data
  const lifecycle = profile?.lifecycle
  const canLifecycle = me.can('orgs.lifecycle') && !!profile
  const canDowngrade = isSaaS && me.can('orgs.plan') && org.plan && org.plan !== 'free'
  // The API refuses to close a paying org unless it is in a POC or trial.
  const closeBlocked = org.plan && org.plan !== 'free' && lifecycle !== 'poc' && lifecycle !== 'trial'
  const planName = (p: string) => t(`admin.plans.${p}`, { defaultValue: p })

  if (!canLifecycle && !canDowngrade) return null

  const run = async () => {
    try {
      if (kind === 'suspend') await updateOrgProfile(token, orgId, { lifecycle: 'suspended' })
      if (kind === 'unsuspend' || kind === 'reopen') await updateOrgProfile(token, orgId, { lifecycle: 'active' })
      if (kind === 'close')
        await saRequest(`/organizations/${orgId}/profile`, token, { method: 'PUT', body: { lifecycle: 'closed', reason: reason.trim() || undefined } })
      if (kind === 'downgrade') await updateOrgPlan(token, orgId, 'free')
      toast.success(t(`admin.org.danger.${kind}_done`))
      invalidate()
    } catch (err) {
      toast.error(errorMessage(err, t('admin.common.error_desc')))
    }
  }

  return (
    <section aria-labelledby="org-danger-zone" className="bg-white rounded-2xl ring-1 ring-inset ring-rose-500/30">
      <div className="flex items-start gap-3 px-5 pt-5">
        <span className="w-9 h-9 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center shrink-0">
          <Warning size={18} />
        </span>
        <div className="min-w-0">
          <h2 id="org-danger-zone" className="text-base font-semibold text-rose-600 leading-tight">
            {t('admin.org.danger.title')}
          </h2>
          <p className="mt-0.5 text-sm text-neutral-500">{t('admin.org.danger.desc')}</p>
        </div>
      </div>
      <div className="p-5 divide-y divide-neutral-100">
        {canLifecycle && lifecycle !== 'closed' && (
          <DangerRow
            icon={lifecycle === 'suspended' ? <Play size={16} /> : <Pause size={16} />}
            title={lifecycle === 'suspended' ? t('admin.org.danger.unsuspend') : t('admin.org.danger.suspend')}
            description={lifecycle === 'suspended' ? t('admin.org.danger.unsuspend_desc') : t('admin.org.danger.suspend_desc')}
            action={
              lifecycle === 'suspended' ? (
                <Button onClick={() => setKind('unsuspend')}>{t('admin.org.danger.unsuspend')}</Button>
              ) : (
                <Button variant="danger-ghost" onClick={() => setKind('suspend')}>
                  {t('admin.org.danger.suspend')}
                </Button>
              )
            }
          />
        )}
        {canLifecycle && (
          <DangerRow
            icon={<Prohibit size={16} />}
            title={lifecycle === 'closed' ? t('admin.org.danger.reopen') : t('admin.org.danger.close')}
            description={
              lifecycle === 'closed'
                ? t('admin.org.danger.reopen_desc')
                : closeBlocked
                  ? t('admin.org.danger.close_blocked', { plan: planName(org.plan) })
                  : t('admin.org.danger.close_desc')
            }
            action={
              lifecycle === 'closed' ? (
                <Button onClick={() => setKind('reopen')}>{t('admin.org.danger.reopen')}</Button>
              ) : (
                <Button variant="danger" disabled={!!closeBlocked} onClick={() => setKind('close')}>
                  {t('admin.org.danger.close')}
                </Button>
              )
            }
          />
        )}
        {canDowngrade && (
          <DangerRow
            icon={<CreditCard size={16} />}
            title={t('admin.org.danger.downgrade')}
            description={t('admin.org.danger.downgrade_desc', { plan: planName(org.plan) })}
            action={
              <Button variant="danger-ghost" onClick={() => setKind('downgrade')}>
                {t('admin.org.danger.downgrade')}
              </Button>
            }
          />
        )}
        <DeleteOrgRow
          org={{ id: org.id, name: org.name, slug: org.slug }}
          render={(button) => (
            <DangerRow icon={<Trash size={16} />} title={t('admin.org.deletion.cta')} description={t('admin.org.deletion.row_desc')} action={button} />
          )}
        />
      </div>

      <ConfirmDialog
        open={!!kind}
        onOpenChange={(o) => {
          if (!o) {
            setKind(null)
            setReason('')
          }
        }}
        tone={kind === 'unsuspend' || kind === 'reopen' ? 'info' : 'danger'}
        title={kind ? t(`admin.org.danger.${kind}_title`, { name: org.name }) : ''}
        confirmLabel={kind ? t(`admin.org.danger.${kind}`) : ''}
        onConfirm={run}
        message={
          <div className="space-y-3 pt-1">
            <p>{kind ? t(`admin.org.danger.${kind}_desc`, { plan: planName(org.plan || 'free') }) : ''}</p>
            {kind === 'close' && (
              <div>
                <FieldLabel hint={t('common.optional')}>{t('admin.pocs.reason')}</FieldLabel>
                <textarea rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} className={TEXTAREA} />
              </div>
            )}
          </div>
        }
      />
    </section>
  )
}

export default function SettingsSection({
  org,
  orgId,
  profileQ,
  isSaaS,
}: {
  org: any
  orgId: string
  profileQ: UseQueryResult<OrgProfile, unknown>
  isSaaS: boolean
}) {
  return (
    <div className="space-y-5">
      <IdentitySettings org={org} orgId={orgId} />
      <AccountSettings orgId={orgId} profileQ={profileQ} />
      <DangerZone org={org} orgId={orgId} profileQ={profileQ} isSaaS={isSaaS} />
    </div>
  )
}
