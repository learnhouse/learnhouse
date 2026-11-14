'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { ArrowClockwise, Check, CreditCard, ListChecks, SlidersHorizontal, WarningCircle } from '@phosphor-icons/react'
import { AIMark, Button, ConfirmDialog, FieldLabel, INPUT, SectionCard, Skeleton, StickySaveBar, StatusDot } from '@/design'
import { errorMessage, getAiCredits, resetAiCredits, setAiCredits, updateOrgAdminToggles, updateOrgPlan } from '@services/ee/platform/api'
import { platformKeys } from '@services/ee/platform/keys'
import { useAccessToken, usePlatformMe, shouldRetry } from '@components/Admin/hooks'
import { PlanChip, QueryError, Switch } from '@components/Admin/Shared/AdminKit'
import { useInvalidateOrg } from '../orgQueries'

const PLAN_KEYS = ['free', 'standard', 'pro', 'enterprise'] as const

// ─── plan picker ─────────────────────────────────────────────────────────────

function PlanPicker({ orgId, org }: { orgId: string; org: any }) {
  const { t } = useTranslation()
  const token = useAccessToken()
  const me = usePlatformMe()
  const invalidate = useInvalidateOrg(orgId)
  const current: string = org.plan || 'free'
  const [selected, setSelected] = React.useState(current)
  const [confirm, setConfirm] = React.useState(false)
  const canEdit = me.can('orgs.plan')

  React.useEffect(() => setSelected(current), [current])

  const plans = PLAN_KEYS.map((id) => ({ id, name: t(`admin.plans.${id}`), description: t(`admin.org_detail.plan_${id}_desc`) }))
  const planName = (p: string) => t(`admin.plans.${p}`, { defaultValue: p })

  const save = async () => {
    try {
      await updateOrgPlan(token, orgId, selected)
      toast.success(t('admin.org_detail.plan_updated'))
      invalidate()
    } catch (err) {
      toast.error(errorMessage(err, t('admin.org_detail.failed_update_plan', { status: (err as any)?.status ?? '' })))
    }
  }

  return (
    <SectionCard
      icon={<CreditCard size={18} />}
      title={t('admin.org_detail.tabs.plan')}
      description={canEdit ? t('admin.org.plan_desc') : t('admin.org.plan_readonly')}
      actions={
        selected !== current && canEdit ? (
          <>
            <Button size="sm" onClick={() => setSelected(current)}>
              {t('common.cancel')}
            </Button>
            <Button size="sm" variant="primary" onClick={() => setConfirm(true)}>
              {t('admin.org_detail.save_plan')}
            </Button>
          </>
        ) : undefined
      }
    >
      <div role="radiogroup" aria-label={t('admin.org_detail.tabs.plan')} className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        {plans.map((p) => {
          const active = selected === p.id
          return (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={!canEdit}
              onClick={() => setSelected(p.id)}
              className={`text-start rounded-xl px-3.5 py-3 transition-all disabled:cursor-default ${
                active ? 'bg-white ring-2 ring-neutral-900' : 'bg-white ring-1 ring-inset ring-neutral-200 hover:ring-neutral-300'
              }`}
            >
              <span className="flex items-center justify-between gap-2">
                <PlanChip plan={p.id} />
                {p.id === current ? (
                  <span className="text-[11px] font-medium text-neutral-400">{t('admin.org.current')}</span>
                ) : (
                  active && <Check size={15} weight="bold" className="text-neutral-900" />
                )}
              </span>
              <span className="mt-2 block text-xs text-neutral-500">{p.description}</span>
            </button>
          )
        })}
      </div>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        tone={selected === 'free' ? 'danger' : 'info'}
        title={t('admin.org.plan_confirm_title', { plan: planName(selected) })}
        message={t(selected === 'free' ? 'admin.org.plan_confirm_free' : 'admin.org.plan_confirm_desc', {
          name: org.name,
          from: planName(current),
          to: planName(selected),
        })}
        confirmLabel={t('admin.org.plan_confirm', { plan: planName(selected) })}
        onConfirm={save}
      />
    </SectionCard>
  )
}

// ─── AI credits ──────────────────────────────────────────────────────────────

function AICreditsCard({ orgId }: { orgId: string }) {
  const { t } = useTranslation()
  const token = useAccessToken()
  const qc = useQueryClient()
  const me = usePlatformMe()
  const canEdit = me.can('orgs.plan')
  const key = platformKeys.aiCredits(orgId)
  const q = useQuery({ queryKey: key, queryFn: () => getAiCredits(token, orgId), enabled: !!token, retry: shouldRetry })
  const summary = q.data
  const [amount, setAmount] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const [confirmReset, setConfirmReset] = React.useState(false)

  React.useEffect(() => {
    if (typeof summary?.purchased_credits === 'number') setAmount(String(summary.purchased_credits))
  }, [summary?.purchased_credits])

  const parsed = amount === '' ? NaN : Number(amount)
  const valid = Number.isInteger(parsed) && parsed >= 0
  const dirty = valid && parsed !== summary?.purchased_credits
  const fmt = (v: unknown) => (v === undefined || v === null ? t('admin.org_detail.na') : typeof v === 'number' ? v.toLocaleString() : String(v))

  const setPurchased = async () => {
    if (!valid) {
      toast.error(t('admin.org_detail.enter_non_negative'))
      return
    }
    setSaving(true)
    try {
      await setAiCredits(token, orgId, parsed)
      toast.success(t('admin.org_detail.purchased_set', { amount: parsed.toLocaleString() }))
      qc.invalidateQueries({ queryKey: key })
    } catch (err) {
      toast.error(errorMessage(err, t('admin.org_detail.failed_set_credits', { status: (err as any)?.status ?? '' })))
    } finally {
      setSaving(false)
    }
  }

  const reset = async () => {
    try {
      await resetAiCredits(token, orgId)
      toast.success(t('admin.org_detail.used_reset'))
      qc.invalidateQueries({ queryKey: key })
    } catch (err) {
      toast.error(errorMessage(err, t('admin.org_detail.failed_reset_usage', { status: (err as any)?.status ?? '' })))
    }
  }

  return (
    <SectionCard icon={<AIMark size={18} alt="" />} title={t('admin.org_detail.ai_credits')} description={t('admin.org_detail.credits_hint')}>
      {q.isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-14 rounded-xl" />
          ))}
        </div>
      ) : !summary ? (
        <QueryError error={q.error ?? new Error(t('admin.org_detail.failed_load_credits'))} compact onRetry={() => q.refetch()} />
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-x-6 gap-y-4">
            {[
              { label: t('admin.org_detail.plan_base'), value: summary.base_credits, tone: 'text-neutral-900' },
              { label: t('admin.org_detail.purchased'), value: summary.purchased_credits, tone: 'text-neutral-900' },
              { label: t('admin.org_detail.total'), value: summary.total_credits, tone: 'text-neutral-900' },
              { label: t('admin.org_detail.used'), value: summary.used_credits, tone: 'text-amber-600' },
              { label: t('admin.org_detail.remaining'), value: summary.remaining_credits, tone: 'text-emerald-600' },
            ].map((s) => (
              <div key={s.label} className="min-w-0">
                <p className="text-[11px] text-neutral-500">{s.label}</p>
                <p className={`mt-0.5 text-xl font-bold tabular-nums ${s.tone}`}>{fmt(s.value)}</p>
              </div>
            ))}
          </div>
          {canEdit && (
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex-1 min-w-[180px]">
                <FieldLabel>{t('admin.org_detail.purchased_credits')}</FieldLabel>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className={INPUT}
                  placeholder={t('admin.org_detail.credits_placeholder')}
                />
              </div>
              <Button variant="primary" onClick={setPurchased} disabled={!dirty} loading={saving}>
                {t('admin.org_detail.set_purchased')}
              </Button>
              <Button variant="danger-ghost" icon={<ArrowClockwise size={14} />} onClick={() => setConfirmReset(true)} title={t('admin.org_detail.reset_credits_title')}>
                {t('admin.org_detail.reset_usage')}
              </Button>
            </div>
          )}
        </div>
      )}
      <ConfirmDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title={t('admin.org.reset_credits_title')}
        message={t('admin.org.reset_credits_desc')}
        confirmLabel={t('admin.org_detail.reset_usage')}
        onConfirm={reset}
      />
    </SectionCard>
  )
}

// ─── feature limits ──────────────────────────────────────────────────────────

function FeatureLimits({ config }: { config: any }) {
  const { t } = useTranslation()
  const features: Record<string, any> = config?.resolved_features || config?.features || {}
  const entries = Object.entries(features)
  if (!entries.length) return null
  return (
    <SectionCard icon={<ListChecks size={18} />} title={t('admin.org_detail.feature_limits')} description={t('admin.org.limits_desc')} bodyClassName="pt-3">
      <ul className="divide-y divide-neutral-100">
        {entries.map(([key, val]) => {
          const on = val?.enabled !== false
          return (
            <li key={key} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 py-2.5">
              <span className="flex items-center gap-2.5 text-sm text-neutral-800 capitalize">
                <StatusDot status={on ? 'success' : 'neutral'} />
                {key.replace(/_/g, ' ')}
              </span>
              <span className="flex flex-wrap items-center gap-3 text-xs text-neutral-500">
                {val?.limit !== undefined && <span>{t('admin.org_detail.limit_value', { value: val.limit === 0 ? '∞' : val.limit })}</span>}
                {val?.signup_mode && <span>{t('admin.org_detail.signup_value', { value: val.signup_mode })}</span>}
                {val?.admin_limit !== undefined && <span>{t('admin.org_detail.admin_limit_value', { value: val.admin_limit })}</span>}
                <span className={on ? 'text-emerald-700' : 'text-neutral-400'}>{on ? t('admin.org_detail.enabled') : t('common.disabled')}</span>
              </span>
            </li>
          )
        })}
      </ul>
    </SectionCard>
  )
}

// ─── admin toggles ───────────────────────────────────────────────────────────

type FeatureToggle = { disabled: boolean }
type AIToggle = { disabled: boolean; copilot_enabled: boolean }
type MembersToggle = { disabled: boolean; signup_mode: 'open' | 'inviteOnly' }
type AdminToggles = {
  ai: AIToggle
  analytics: FeatureToggle
  api: FeatureToggle
  boards: FeatureToggle
  collaboration: FeatureToggle
  folders: FeatureToggle
  communities: FeatureToggle
  members: MembersToggle
  paths: FeatureToggle
  payments: FeatureToggle
  playgrounds: FeatureToggle
  podcasts: FeatureToggle
  live_sessions: FeatureToggle
}

const DEFAULT_TOGGLES: AdminToggles = {
  ai: { disabled: false, copilot_enabled: true },
  analytics: { disabled: false },
  api: { disabled: false },
  boards: { disabled: false },
  collaboration: { disabled: false },
  folders: { disabled: false },
  communities: { disabled: false },
  members: { disabled: false, signup_mode: 'open' },
  paths: { disabled: false },
  payments: { disabled: false },
  playgrounds: { disabled: false },
  podcasts: { disabled: false },
  live_sessions: { disabled: false },
}

const FEATURE_ORDER = Object.keys(DEFAULT_TOGGLES) as (keyof AdminToggles)[]

function AdminTogglesCard({ orgId, config, isSaaS }: { orgId: string; config: any; isSaaS: boolean }) {
  const { t } = useTranslation()
  const token = useAccessToken()
  const me = usePlatformMe()
  const invalidate = useInvalidateOrg(orgId)
  const canEdit = me.can('orgs.update')
  const isV2 = String(config?.config_version || '1.0').startsWith('2')
  const resolved: Record<string, any> = config?.resolved_features || config?.features || {}

  const initial: AdminToggles = React.useMemo(() => {
    if (!isV2) return DEFAULT_TOGGLES
    const incoming = config?.admin_toggles || {}
    return {
      ...DEFAULT_TOGGLES,
      ...incoming,
      ai: { ...DEFAULT_TOGGLES.ai, ...(incoming.ai || {}) },
      members: { ...DEFAULT_TOGGLES.members, ...(incoming.members || {}) },
    }
  }, [config, isV2])
  const [draft, setDraft] = React.useState<AdminToggles>(initial)
  const [saving, setSaving] = React.useState(false)
  React.useEffect(() => setDraft(initial), [initial])
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial)

  const save = async () => {
    setSaving(true)
    try {
      await updateOrgAdminToggles(token, orgId, draft)
      toast.success(t('admin.org_detail.saved'))
      invalidate()
    } catch (err) {
      toast.error(errorMessage(err, t('admin.org_detail.failed_save_status', { status: (err as any)?.status ?? '' })))
    } finally {
      setSaving(false)
    }
  }

  if (!isV2) {
    return (
      <SectionCard icon={<WarningCircle size={18} />} title={t('admin.org_detail.toggles_unavailable')} description={t('admin.org_detail.legacy_config')} />
    )
  }

  return (
    <>
      <SectionCard
        icon={<SlidersHorizontal size={18} />}
        title={t('admin.org_detail.feature_toggles')}
        description={isSaaS ? t('admin.org_detail.toggles_hint_saas') : t('admin.org_detail.toggles_hint')}
        bodyClassName="pt-3"
      >
        <ul className="divide-y divide-neutral-100">
          {FEATURE_ORDER.map((key) => {
            const toggle = draft[key]
            const enabled = !toggle.disabled
            const limit = resolved[key]?.limit
            return (
              <li key={key} className="px-5 py-3.5">
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-neutral-900">{t(`admin.org_detail.features.${key}.label`)}</span>
                      {/* "In the plan" is separate from the on/off switch. */}
                      {isSaaS && resolved[key]?.available && (
                        <span className="rounded-md bg-neutral-100 px-1.5 py-0.5 text-[10px] font-semibold text-neutral-600">{t('admin.org_detail.in_plan')}</span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-neutral-500">{t(`admin.org_detail.features.${key}.description`)}</p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {isSaaS && limit !== undefined && limit !== null && (
                      <span className="hidden sm:inline text-[11px] text-neutral-400">{t('admin.org_detail.limit_value', { value: limit === 0 ? '∞' : limit })}</span>
                    )}
                    <Switch
                      checked={enabled}
                      disabled={!canEdit}
                      label={t(`admin.org_detail.features.${key}.label`)}
                      onChange={(v) => setDraft((d) => ({ ...d, [key]: { ...d[key], disabled: !v } }))}
                    />
                  </div>
                </div>
                {key === 'ai' && enabled && (
                  <div className="mt-3 ps-3 border-s-2 border-neutral-100 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-neutral-800">{t('admin.org_detail.ai_copilot')}</p>
                      <p className="text-[11px] text-neutral-500">{t('admin.org_detail.copilot_desc')}</p>
                    </div>
                    <Switch
                      checked={draft.ai.copilot_enabled}
                      disabled={!canEdit}
                      label={t('admin.org_detail.ai_copilot')}
                      onChange={(v) => setDraft((d) => ({ ...d, ai: { ...d.ai, copilot_enabled: v } }))}
                    />
                  </div>
                )}
                {key === 'members' && enabled && (
                  <div className="mt-3 ps-3 border-s-2 border-neutral-100 flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-neutral-800">{t('admin.org_detail.signup_mode')}</p>
                      <p className="text-[11px] text-neutral-500">{t('admin.org_detail.signup_mode_desc')}</p>
                    </div>
                    <select
                      value={draft.members.signup_mode}
                      disabled={!canEdit}
                      onChange={(e) => setDraft((d) => ({ ...d, members: { ...d.members, signup_mode: e.target.value as 'open' | 'inviteOnly' } }))}
                      className="h-8 rounded-lg bg-white px-2.5 text-xs font-medium ring-1 ring-inset ring-neutral-200 focus:outline-none focus:ring-2 focus:ring-neutral-900/15"
                    >
                      <option value="open">{t('admin.org_detail.signup_open')}</option>
                      <option value="inviteOnly">{t('admin.org_detail.signup_invite_only')}</option>
                    </select>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      </SectionCard>
      <StickySaveBar visible={dirty} saving={saving} onSave={save} onDiscard={() => setDraft(initial)} />
    </>
  )
}

export default function PlanSection({ orgId, org, isSaaS }: { orgId: string; org: any; isSaaS: boolean }) {
  return (
    <div className="space-y-5">
      {isSaaS && <PlanPicker orgId={orgId} org={org} />}
      <AdminTogglesCard orgId={orgId} config={org.config} isSaaS={isSaaS} />
      <AICreditsCard orgId={orgId} />
      {isSaaS && <FeatureLimits config={org.config} />}
    </div>
  )
}
