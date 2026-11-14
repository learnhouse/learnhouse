'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  ArrowDown,
  ArrowUp,
  BracketsCurly,
  ClockCounterClockwise,
  Copy,
  Globe,
  IdentificationCard,
  LinkSimple,
  ListDashes,
  LockSimple,
  MagnifyingGlass,
  Plus,
  ShareNetwork,
  Sparkle,
  SquaresFour,
  Trash,
  UserPlus,
} from '@phosphor-icons/react'
import { Button, Chip, ConfirmDialog, EmptyState, INPUT, SectionCard, SegmentedControl, Skeleton, TEXTAREA, formatRelative } from '@/design'
import { AVAILABLE_LANGUAGES } from '@/lib/languages'
import { OPTIONAL_FEATURES } from '@services/features/optionalFeatures'
import { errorMessage, getOrgConfigHistory, updateOrgConfig, updateOrgConfigSection } from '@services/ee/platform/api'
import { platformKeys } from '@services/ee/platform/keys'
import type { OrgConfiguration, OrgMenuItem } from '@services/ee/platform/types'
import { shouldRetry, useAccessToken, usePlatformMe } from '@components/Admin/hooks'
import { QueryError, Switch } from '@components/Admin/Shared/AdminKit'
import { changeRows, isHttpUrl, isMenuUrl, MAX_LINKS, moveItem, sameValue, SOCIAL_KEYS, sortedMenu } from '../orgConfig'
import { useInvalidateOrg } from '../orgQueries'
import { CardSaveBar, ConfigRow, useConfigWrite, useDraft, useOrgConfiguration } from './configKit'

// The rest of the org's settings, grouped like the org's own settings pages.
// Profile, language, sign-up mode, features, AI, menu and SEO are editable;
// security policy, SSO, domains and landing pages are shown read-only (they
// decide who can sign in or what is served, and stay with the org).

const ORG_LABELS = [
  'languages', 'business', 'ecommerce', 'gaming', 'music', 'sports', 'cars', 'sales_marketing', 'tech', 'photo_video', 'pets',
  'personal_development', 'real_estate', 'beauty_fashion', 'travel', 'productivity', 'health_fitness', 'finance', 'arts_crafts',
  'education', 'stem', 'humanities', 'professional_skills', 'digital_skills', 'creative_arts', 'social_sciences', 'test_prep',
  'vocational', 'early_education',
] as const

const MENU_LABELS: Record<string, string> = {
  courses: 'courses.courses',
  paths: 'paths.title',
  library: 'library.library',
  podcasts: 'podcasts.podcasts',
  live: 'live_sessions.nav',
  communities: 'communities.title',
  playgrounds: 'common.playgrounds',
  boards: 'common.boards',
  store: 'common.store',
}
const MENU_DEFAULT_ORDER = ['courses', 'paths', 'library', 'podcasts', 'live', 'communities', 'playgrounds', 'boards', 'store']
const ORG_TYPES = ['', 'EducationalOrganization', 'Organization', 'CollegeOrUniversity', 'School', 'OnlineBusiness', 'Corporation']
const AUTH_METHODS = ['password', 'magic_login', 'google', 'sso']

type Props = { cfg: OrgConfiguration; orgId: string; canEdit: boolean }

// ─── profile + general ──────────────────────────────────────────────────────

function ProfileCard({ cfg, orgId, canEdit }: Props) {
  const { t } = useTranslation()
  const token = useAccessToken()
  const write = useConfigWrite(orgId)
  const s = 'dashboard.organization.settings'
  const savedProfile = React.useMemo(() => ({ about: cfg.org.about || '', label: cfg.org.label || '', explore: !!cfg.org.explore }), [cfg])
  const savedGeneral = React.useMemo(
    () => ({
      default_language: cfg.general.default_language || 'en',
      email_sender_name: cfg.general.email_sender_name || '',
      footer_text: cfg.general.footer_text || '',
      watermark: cfg.general.watermark !== false,
    }),
    [cfg]
  )
  const [profile, setProfile, resetProfile] = useDraft(savedProfile)
  const [general, setGeneral, resetGeneral] = useDraft(savedGeneral)
  const [saving, setSaving] = React.useState(false)
  const profileDirty = !sameValue(profile, savedProfile)
  const generalDirty = !sameValue(general, savedGeneral)

  const save = async () => {
    setSaving(true)
    if (profileDirty) await write(() => updateOrgConfigSection(token, orgId, 'profile', profile))
    if (generalDirty) {
      // Only the changed fields: watermark rules (free plans keep it) apply per field.
      const body = Object.fromEntries(Object.entries(general).filter(([k, v]) => v !== (savedGeneral as Record<string, unknown>)[k]))
      await write(() => updateOrgConfigSection(token, orgId, 'general', body))
    }
    setSaving(false)
  }

  return (
    <SectionCard icon={<IdentificationCard size={18} />} title={t('admin.org_cfg.profile.title')} description={t('admin.org_cfg.profile.desc')}>
      <div className="divide-y divide-neutral-100">
        <ConfigRow label={t(`${s}.about`)}>
          <textarea rows={3} maxLength={400} className={TEXTAREA} value={profile.about} disabled={!canEdit} onChange={(e) => setProfile((p) => ({ ...p, about: e.target.value }))} />
        </ConfigRow>
        <ConfigRow label={t(`${s}.label`)}>
          <select className={`${INPUT} max-w-xs`} value={profile.label} disabled={!canEdit} onChange={(e) => setProfile((p) => ({ ...p, label: e.target.value }))}>
            <option value="">—</option>
            {ORG_LABELS.map((l) => (
              <option key={l} value={l}>
                {t(`dashboard.organization.general.org_labels.${l}`)}
              </option>
            ))}
          </select>
        </ConfigRow>
        <ConfigRow label={t('admin.org_cfg.profile.explore')} hint={t('admin.org_cfg.profile.explore_hint')}>
          <Switch checked={profile.explore} disabled={!canEdit} label={t('admin.org_cfg.profile.explore')} onChange={(v) => setProfile((p) => ({ ...p, explore: v }))} />
        </ConfigRow>
        <ConfigRow label={t(`${s}.default_language`)} hint={t(`${s}.default_language_desc`)}>
          <select
            className={`${INPUT} max-w-xs`}
            value={general.default_language}
            disabled={!canEdit}
            onChange={(e) => setGeneral((g) => ({ ...g, default_language: e.target.value }))}
          >
            {AVAILABLE_LANGUAGES.filter((l) => !cfg.languages?.length || cfg.languages.includes(l.code)).map((l) => (
              <option key={l.code} value={l.code}>
                {l.code.toUpperCase()} · {l.nativeName}
              </option>
            ))}
          </select>
        </ConfigRow>
        <ConfigRow label={t(`${s}.email_sender_name`)} hint={t(`${s}.email_sender_name_desc`)}>
          <input
            className={`${INPUT} max-w-md`}
            maxLength={100}
            value={general.email_sender_name}
            disabled={!canEdit}
            placeholder={t(`${s}.email_sender_name_placeholder`)}
            onChange={(e) => setGeneral((g) => ({ ...g, email_sender_name: e.target.value }))}
          />
        </ConfigRow>
        <ConfigRow label={t(`${s}.footer_text`)} hint={t(`${s}.footer_text_desc`)}>
          <input
            className={INPUT}
            maxLength={300}
            value={general.footer_text}
            disabled={!canEdit}
            placeholder={t(`${s}.footer_text_placeholder`)}
            onChange={(e) => setGeneral((g) => ({ ...g, footer_text: e.target.value }))}
          />
        </ConfigRow>
        <ConfigRow label={t(`${s}.watermark_label`)} hint={cfg.plan === 'free' ? t(`${s}.watermark_free_plan`) : t(`${s}.watermark_desc`)}>
          <Switch checked={general.watermark} disabled={!canEdit} label={t(`${s}.watermark_label`)} onChange={(v) => setGeneral((g) => ({ ...g, watermark: v }))} />
        </ConfigRow>
      </div>
      <CardSaveBar
        dirty={profileDirty || generalDirty}
        saving={saving}
        onSave={save}
        onDiscard={() => {
          resetProfile()
          resetGeneral()
        }}
        readOnly={!canEdit}
      />
    </SectionCard>
  )
}

// ─── socials + links ────────────────────────────────────────────────────────

function SocialsCard({ cfg, orgId, canEdit }: Props) {
  const { t } = useTranslation()
  const token = useAccessToken()
  const write = useConfigWrite(orgId)
  const saved = React.useMemo(
    () => ({
      socials: Object.fromEntries(SOCIAL_KEYS.map((k) => [k, cfg.org.socials?.[k] || ''])) as Record<string, string>,
      links: Object.entries(cfg.org.links || {}).map(([label, url]) => ({ label, url })),
    }),
    [cfg]
  )
  const [draft, setDraft, discard] = useDraft(saved)
  const [saving, setSaving] = React.useState(false)
  const bad =
    Object.values(draft.socials).some((v) => v.trim() && !isHttpUrl(v)) ||
    draft.links.some((l) => !l.label.trim() || (l.url.trim() && !isHttpUrl(l.url))) ||
    new Set(draft.links.map((l) => l.label.trim())).size !== draft.links.length

  const save = async () => {
    setSaving(true)
    await write(() =>
      updateOrgConfigSection(token, orgId, 'profile', {
        socials: Object.fromEntries(Object.entries(draft.socials).map(([k, v]) => [k, v.trim()])),
        links: Object.fromEntries(draft.links.map((l) => [l.label.trim(), l.url.trim()])),
      })
    )
    setSaving(false)
  }

  return (
    <SectionCard icon={<ShareNetwork size={18} />} title={t('dashboard.organization.socials.title')} description={t('dashboard.organization.socials.custom_links_desc')}>
      <div className="divide-y divide-neutral-100">
        {SOCIAL_KEYS.map((k) => (
          <ConfigRow key={k} label={<span className="capitalize">{k === 'twitter' ? 'X / Twitter' : k}</span>}>
            <input
              className={INPUT}
              dir="ltr"
              value={draft.socials[k]}
              disabled={!canEdit}
              placeholder="https://"
              aria-invalid={!!draft.socials[k].trim() && !isHttpUrl(draft.socials[k])}
              onChange={(e) => setDraft((d) => ({ ...d, socials: { ...d.socials, [k]: e.target.value } }))}
            />
          </ConfigRow>
        ))}
        <ConfigRow label={t('dashboard.organization.socials.labels.custom_links')}>
          <div className="space-y-2">
            {draft.links.map((l, i) => (
              <div key={i} className="flex flex-col sm:flex-row gap-2">
                <input
                  className={`${INPUT} sm:max-w-[10rem]`}
                  maxLength={40}
                  value={l.label}
                  disabled={!canEdit}
                  placeholder={t('dashboard.organization.socials.placeholders.label')}
                  onChange={(e) => setDraft((d) => ({ ...d, links: d.links.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) }))}
                />
                <div className="flex gap-2 flex-1">
                  <input
                    className={INPUT}
                    dir="ltr"
                    value={l.url}
                    disabled={!canEdit}
                    placeholder="https://"
                    onChange={(e) => setDraft((d) => ({ ...d, links: d.links.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)) }))}
                  />
                  {canEdit && (
                    <Button
                      size="icon"
                      variant="danger-ghost"
                      aria-label={t('common.remove')}
                      icon={<Trash size={13} />}
                      onClick={() => setDraft((d) => ({ ...d, links: d.links.filter((_, j) => j !== i) }))}
                    />
                  )}
                </div>
              </div>
            ))}
            {canEdit && draft.links.length < MAX_LINKS && (
              <Button size="sm" icon={<Plus size={13} />} onClick={() => setDraft((d) => ({ ...d, links: [...d.links, { label: '', url: '' }] }))}>
                {t('dashboard.organization.socials.add_link')}
              </Button>
            )}
            {!canEdit && !draft.links.length && <span className="text-sm text-neutral-400">—</span>}
          </div>
        </ConfigRow>
      </div>
      <CardSaveBar dirty={!sameValue(draft, saved)} saving={saving} onSave={save} onDiscard={discard} readOnly={!canEdit} error={bad ? t('admin.org_cfg.links_invalid') : null} />
    </SectionCard>
  )
}

// ─── sign-up + access ───────────────────────────────────────────────────────

function AccessCard({ cfg, orgId, canEdit }: Props) {
  const { t } = useTranslation()
  const token = useAccessToken()
  const write = useConfigWrite(orgId)
  const [pending, setPending] = React.useState<'open' | 'inviteOnly' | null>(null)
  const mode = (cfg.signup_mode || 'open') as 'open' | 'inviteOnly'
  const sec = cfg.security || {}
  const methods = sec.allowed_auth_methods?.length ? sec.allowed_auth_methods : AUTH_METHODS
  const d = 'dashboard.organization.security'
  const yes = t('admin.org_detail.enabled')
  const no = t('common.disabled')

  return (
    <SectionCard icon={<UserPlus size={18} />} title={t('admin.org_cfg.access.title')} description={t('admin.org_cfg.access.desc')}>
      <div className="divide-y divide-neutral-100">
        <ConfigRow label={t('admin.org_detail.signup_mode')} hint={t('admin.org_detail.signup_mode_desc')}>
          <SegmentedControl
            value={mode}
            ariaLabel={t('admin.org_detail.signup_mode')}
            onChange={(v) => canEdit && v !== mode && setPending(v)}
            options={[
              { key: 'open', label: t('admin.org_detail.signup_open') },
              { key: 'inviteOnly', label: t('admin.org_detail.signup_invite_only') },
            ]}
          />
        </ConfigRow>
        <ConfigRow label={t('admin.org_cfg.access.signup_fields')}>
          <span className="text-sm text-neutral-700">{cfg.signup_fields.length}</span>
        </ConfigRow>
      </div>

      <div className="mt-5 rounded-xl bg-neutral-50 ring-1 ring-inset ring-neutral-200/70 p-4">
        <p className="flex items-center gap-2 text-xs font-semibold text-neutral-700">
          <LockSimple size={13} />
          {t('admin.org_cfg.access.readonly_title')}
        </p>
        <p className="mt-0.5 text-xs text-neutral-500">{t('admin.org_cfg.access.readonly_desc')}</p>
        <dl className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2 text-sm">
          <div>
            <dt className="text-xs text-neutral-500">{t(`${d}.policy_title`)}</dt>
            <dd className="mt-0.5 font-medium text-neutral-800">
              {sec.require_2fa ? yes : no}
              {sec.require_2fa && (
                <span className="ms-1.5 text-xs font-normal text-neutral-500">
                  · {t(`${d}.grace_label`)}: {sec.require_2fa_grace_days ? t(`${d}.grace_days`, { count: sec.require_2fa_grace_days }) : t(`${d}.grace_immediately`)}
                </span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-neutral-500">{t(`${d}.session_sharing_label`)}</dt>
            <dd className="mt-0.5 font-medium text-neutral-800">{sec.allow_central_session_sharing === false ? no : yes}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-xs text-neutral-500">{t(`${d}.methods_title`)}</dt>
            <dd className="mt-1 flex flex-wrap gap-1.5">
              {AUTH_METHODS.map((m) => (
                <Chip key={m} tone={methods.includes(m) ? 'emerald' : 'neutral'}>
                  {t(`${d}.method_${m}`)}
                </Chip>
              ))}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-xs text-neutral-500">{t('admin.org_cfg.access.sso')}</dt>
            <dd className="mt-1 space-y-1">
              {cfg.sso.length ? (
                cfg.sso.map((c, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-2">
                    <Chip tone={c.enabled ? 'emerald' : 'neutral'}>{c.provider}</Chip>
                    <span className="text-xs text-neutral-500" dir="ltr">
                      {c.domains.join(', ') || '—'}
                    </span>
                  </div>
                ))
              ) : (
                <span className="text-sm text-neutral-500">{t('admin.org_cfg.access.no_sso')}</span>
              )}
            </dd>
          </div>
        </dl>
      </div>

      <ConfirmDialog
        open={!!pending}
        onOpenChange={(o) => !o && setPending(null)}
        tone="info"
        title={t('admin.org_cfg.access.confirm_title')}
        message={pending === 'open' ? t('admin.org_cfg.access.confirm_open', { name: cfg.org.name }) : t('admin.org_cfg.access.confirm_invite', { name: cfg.org.name })}
        confirmLabel={t('common.save')}
        onConfirm={async () => {
          if (pending) await write(() => updateOrgConfigSection(token, orgId, 'signup', { signup_mode: pending }))
        }}
      />
    </SectionCard>
  )
}

// ─── features + AI ──────────────────────────────────────────────────────────

function FeaturesCard({ cfg, orgId, canEdit, onOpenPlan }: Props & { onOpenPlan?: () => void }) {
  const { t } = useTranslation()
  const token = useAccessToken()
  const write = useConfigWrite(orgId)
  const [busy, setBusy] = React.useState<string | null>(null)
  const toggles = cfg.admin_toggles || {}
  const ai = (toggles.ai || {}) as { disabled?: boolean; copilot_enabled?: boolean }

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key)
    await fn()
    setBusy(null)
  }

  return (
    <SectionCard
      icon={<SquaresFour size={18} />}
      title={t('admin.org_cfg.features.title')}
      description={t('admin.org_cfg.features.desc')}
      actions={
        onOpenPlan ? (
          <Button size="sm" onClick={onOpenPlan}>
            {t('admin.org_cfg.features.platform_switches')}
          </Button>
        ) : undefined
      }
    >
      {!cfg.is_v2 ? (
        <p className="text-sm text-neutral-500">{t('admin.org_detail.legacy_config')}</p>
      ) : (
        <ul className="divide-y divide-neutral-100">
          {cfg.org_features.map((key) => {
            const tg = (toggles[key] || {}) as { org_disabled?: boolean; disabled?: boolean }
            const resolved = cfg.resolved_features?.[key]
            const on = !tg.org_disabled
            // Same names and descriptions as the org's own Features settings.
            const meta = OPTIONAL_FEATURES.find((f) => f.key === key)
            const name = meta ? t(meta.labelKey) : key.replace(/_/g, ' ')
            return (
              <li key={key} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-neutral-900">{name}</span>
                    {tg.disabled && <Chip tone="amber">{t('admin.org_cfg.features.platform_off')}</Chip>}
                    {resolved && resolved.available === false && <Chip>{t('admin.org_cfg.features.not_in_plan')}</Chip>}
                  </div>
                  {meta && <p className="mt-0.5 text-xs text-neutral-500">{t(meta.descriptionKey)}</p>}
                </div>
                <Switch
                  checked={on}
                  disabled={!canEdit || busy === key}
                  label={name}
                  onChange={(v) => run(key, () => write(() => updateOrgConfigSection(token, orgId, 'features', { feature: key, enabled: v })))}
                />
              </li>
            )
          })}
        </ul>
      )}

      <div className="mt-5 pt-5 border-t border-neutral-100">
        <p className="flex items-center gap-2 text-sm font-semibold text-neutral-900">
          <Sparkle size={15} className="text-violet-500" />
          {t('admin.org_cfg.ai.title')}
        </p>
        <div className="mt-3 divide-y divide-neutral-100">
          <div className="flex items-center justify-between gap-4 py-3 first:pt-0">
            <div className="min-w-0">
              <p className="text-sm font-medium text-neutral-800">{t('admin.org_detail.features.ai.label')}</p>
              <p className="text-xs text-neutral-500">{t('admin.org_detail.features.ai.description')}</p>
            </div>
            <Switch
              checked={!ai.disabled}
              disabled={!canEdit || busy === 'ai'}
              label={t('admin.org_detail.features.ai.label')}
              onChange={(v) => run('ai', () => write(() => updateOrgConfigSection(token, orgId, 'ai', { ai_enabled: v })))}
            />
          </div>
          <div className="flex items-center justify-between gap-4 py-3 last:pb-0">
            <div className="min-w-0">
              <p className="text-sm font-medium text-neutral-800">{t('admin.org_detail.ai_copilot')}</p>
              <p className="text-xs text-neutral-500">{t('admin.org_detail.copilot_desc')}</p>
            </div>
            <Switch
              checked={ai.copilot_enabled !== false}
              disabled={!canEdit || busy === 'copilot' || !!ai.disabled}
              label={t('admin.org_detail.ai_copilot')}
              onChange={(v) => run('copilot', () => write(() => updateOrgConfigSection(token, orgId, 'ai', { copilot_enabled: v })))}
            />
          </div>
        </div>
      </div>
    </SectionCard>
  )
}

// ─── menu ───────────────────────────────────────────────────────────────────

function MenuCard({ cfg, orgId, canEdit }: Props) {
  const { t } = useTranslation()
  const token = useAccessToken()
  const write = useConfigWrite(orgId)
  const saved = React.useMemo(() => sortedMenu(cfg.menu?.items || []), [cfg])
  const [items, setItems, discard] = useDraft<OrgMenuItem[]>(saved)
  const [saving, setSaving] = React.useState(false)
  const m = 'dashboard.organization.menu'
  const bad = items.some((i) => (i.type === 'custom' && (!i.label.trim() || !i.url.trim())) || !isMenuUrl(i.url))
  const patch = (index: number, p: Partial<OrgMenuItem>) => setItems((list) => list.map((x, j) => (j === index ? { ...x, ...p } : x)))

  const save = async () => {
    setSaving(true)
    await write(() => updateOrgConfigSection(token, orgId, 'menu', { items: items.map((i, order) => ({ ...i, order, label: i.label.trim(), url: i.url.trim() })) }))
    setSaving(false)
  }

  return (
    <SectionCard icon={<ListDashes size={18} />} title={t(`${m}.title`)} description={t(`${m}.subtitle`)}>
      {!items.length ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-neutral-50 px-4 py-3">
          <p className="text-sm text-neutral-600">{t('admin.org_cfg.menu.defaults')}</p>
          {canEdit && (
            <Button size="sm" onClick={() => setItems(MENU_DEFAULT_ORDER.map((type, order) => ({ type, enabled: true, order, label: '', url: '', icon: '' })))}>
              {t('admin.org_cfg.menu.customize')}
            </Button>
          )}
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((item, i) => {
            const custom = item.type === 'custom'
            return (
              <li key={`${item.type}-${i}`} className="flex flex-col sm:flex-row sm:items-center gap-2 rounded-xl ring-1 ring-inset ring-neutral-200/80 p-2.5">
                <div className="flex items-center gap-2 min-w-0 sm:w-44 shrink-0">
                  <Switch checked={item.enabled} disabled={!canEdit} label={custom ? item.label : t(MENU_LABELS[item.type] || 'common.open')} onChange={(v) => patch(i, { enabled: v })} />
                  <span className={`text-sm font-medium truncate ${item.enabled ? 'text-neutral-900' : 'text-neutral-400'}`}>
                    {custom ? t('admin.org_cfg.menu.custom') : MENU_LABELS[item.type] ? t(MENU_LABELS[item.type]) : item.type}
                  </span>
                </div>
                <input
                  className={`${INPUT} sm:max-w-[12rem]`}
                  maxLength={60}
                  value={item.label}
                  disabled={!canEdit}
                  placeholder={custom ? t(`${m}.label_placeholder`) : MENU_LABELS[item.type] ? t(MENU_LABELS[item.type]) : ''}
                  aria-label={t(`${m}.label_placeholder`)}
                  onChange={(e) => patch(i, { label: e.target.value })}
                />
                {custom ? (
                  <input
                    className={INPUT}
                    dir="ltr"
                    value={item.url}
                    disabled={!canEdit}
                    placeholder="https:// or /path"
                    aria-invalid={!isMenuUrl(item.url)}
                    onChange={(e) => patch(i, { url: e.target.value })}
                  />
                ) : (
                  <span className="flex-1" />
                )}
                {canEdit && (
                  <div className="flex items-center gap-1 sm:ms-auto">
                    <Button size="icon" variant="ghost" icon={<ArrowUp size={13} />} aria-label={t('admin.org_cfg.menu.up')} disabled={i === 0} onClick={() => setItems((l) => moveItem(l, i, -1))} />
                    <Button size="icon" variant="ghost" icon={<ArrowDown size={13} />} aria-label={t('admin.org_cfg.menu.down')} disabled={i === items.length - 1} onClick={() => setItems((l) => moveItem(l, i, 1))} />
                    {custom && (
                      <Button size="icon" variant="danger-ghost" icon={<Trash size={13} />} aria-label={t(`${m}.remove`)} onClick={() => setItems((l) => l.filter((_, j) => j !== i).map((x, order) => ({ ...x, order })))} />
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {canEdit && items.length > 0 && items.length < 30 && (
        <div className="mt-3">
          <Button size="sm" icon={<LinkSimple size={13} />} onClick={() => setItems((l) => [...l, { type: 'custom', enabled: true, order: l.length, label: '', url: '', icon: '' }])}>
            {t(`${m}.add_custom`)}
          </Button>
        </div>
      )}
      <CardSaveBar dirty={!sameValue(items, saved)} saving={saving} onSave={save} onDiscard={discard} readOnly={!canEdit} error={bad ? t(`${m}.custom_required`) : null} />
    </SectionCard>
  )
}

// ─── SEO ────────────────────────────────────────────────────────────────────

const SEO_TEXT = ['default_meta_title_suffix', 'default_title_template', 'default_meta_description', 'twitter_handle', 'google_site_verification', 'bing_site_verification'] as const

function SeoCard({ cfg, orgId, canEdit }: Props) {
  const { t } = useTranslation()
  const token = useAccessToken()
  const write = useConfigWrite(orgId)
  const saved = React.useMemo(() => {
    const seo = cfg.seo || {}
    return {
      ...Object.fromEntries(SEO_TEXT.map((k) => [k, String(seo[k] ?? '')])),
      organization_type: String(seo.organization_type ?? ''),
      robots_extra_rules: String(seo.robots_extra_rules ?? ''),
      noindex_communities: !!seo.noindex_communities,
      indexing_disabled: !!seo.indexing_disabled,
    } as Record<string, string | boolean>
  }, [cfg])
  const [draft, setDraft, discard] = useDraft(saved)
  const [saving, setSaving] = React.useState(false)
  const template = String(draft.default_title_template || '')
  const bad = !!template.trim() && !template.includes('%s')

  const save = async () => {
    setSaving(true)
    await write(() => updateOrgConfigSection(token, orgId, 'seo', draft))
    setSaving(false)
  }
  const label = (k: string) => t(`admin.org_cfg.seo.${k}`)

  return (
    <SectionCard icon={<MagnifyingGlass size={18} />} title={t('admin.org_cfg.seo.title')} description={t('admin.org_cfg.seo.desc')}>
      <div className="divide-y divide-neutral-100">
        {SEO_TEXT.map((k) => (
          <ConfigRow key={k} label={label(k)} hint={k === 'default_title_template' ? t('admin.org_cfg.seo.template_hint') : undefined}>
            {k === 'default_meta_description' ? (
              <textarea rows={2} maxLength={300} className={TEXTAREA} value={String(draft[k])} disabled={!canEdit} onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))} />
            ) : (
              <input
                className={INPUT}
                dir={k.endsWith('verification') || k === 'twitter_handle' ? 'ltr' : undefined}
                value={String(draft[k])}
                disabled={!canEdit}
                maxLength={k === 'default_title_template' ? 120 : 200}
                onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))}
              />
            )}
          </ConfigRow>
        ))}
        <ConfigRow label={label('organization_type')}>
          <select className={`${INPUT} max-w-xs`} value={String(draft.organization_type)} disabled={!canEdit} onChange={(e) => setDraft((d) => ({ ...d, organization_type: e.target.value }))}>
            {ORG_TYPES.map((o) => (
              <option key={o || 'default'} value={o}>
                {o || 'EducationalOrganization'}
              </option>
            ))}
          </select>
        </ConfigRow>
        <ConfigRow label={t('dashboard.organization.seo.org_seo.hide_communities')} hint={t('dashboard.organization.seo.org_seo.hide_communities_hint')}>
          <Switch checked={!!draft.noindex_communities} disabled={!canEdit} label={t('dashboard.organization.seo.org_seo.hide_communities')} onChange={(v) => setDraft((d) => ({ ...d, noindex_communities: v }))} />
        </ConfigRow>
        <ConfigRow label={label('indexing_disabled')} hint={t('admin.org_cfg.seo.indexing_disabled_hint')}>
          <Switch checked={!!draft.indexing_disabled} disabled={!canEdit} label={label('indexing_disabled')} onChange={(v) => setDraft((d) => ({ ...d, indexing_disabled: v }))} />
        </ConfigRow>
        <ConfigRow label={label('robots_extra_rules')}>
          <textarea
            rows={3}
            dir="ltr"
            maxLength={2000}
            className={`${TEXTAREA} font-mono text-xs`}
            value={String(draft.robots_extra_rules)}
            disabled={!canEdit}
            onChange={(e) => setDraft((d) => ({ ...d, robots_extra_rules: e.target.value }))}
          />
        </ConfigRow>
      </div>
      <CardSaveBar dirty={!sameValue(draft, saved)} saving={saving} onSave={save} onDiscard={discard} readOnly={!canEdit} error={bad ? t('admin.org_cfg.seo.template_invalid') : null} />
    </SectionCard>
  )
}

// ─── domains + landing pages (read-only) ────────────────────────────────────

function SiteCard({ cfg }: { cfg: OrgConfiguration }) {
  const { t, i18n } = useTranslation()
  const tone = (s: string) => (s === 'verified' ? 'emerald' : s === 'failed' ? 'rose' : 'amber') as 'emerald' | 'rose' | 'amber'
  return (
    <SectionCard icon={<Globe size={18} />} title={t('admin.org_cfg.site.title')} description={t('admin.org_cfg.site.desc')}>
      <div className="grid gap-5 md:grid-cols-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">{t('admin.org_detail.custom_domains')}</p>
          <ul className="mt-2 space-y-1.5">
            {cfg.custom_domains.length ? (
              cfg.custom_domains.map((d) => (
                <li key={d.domain} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium text-neutral-800 truncate" dir="ltr">
                    {d.domain}
                  </span>
                  <Chip tone={tone(d.status)}>{t(`admin.org_cfg.site.status.${['verified', 'pending', 'failed'].includes(d.status) ? d.status : 'pending'}`)}</Chip>
                  {d.primary && <Chip tone="sky">{t('admin.org_cfg.site.primary')}</Chip>}
                </li>
              ))
            ) : (
              <li className="text-sm text-neutral-500">{t('admin.org_detail.no_custom_domains')}</li>
            )}
          </ul>
        </div>
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">{t('admin.org_cfg.site.landing')}</p>
          <ul className="mt-2 space-y-1.5">
            {cfg.landing_pages.length ? (
              cfg.landing_pages.map((p) => (
                <li key={p.slug || 'home'} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium text-neutral-800">{p.title || (p.slug ? `/${p.slug}` : t('admin.org_cfg.site.home'))}</span>
                  <span className="text-xs text-neutral-400" dir="ltr">
                    /{p.slug}
                  </span>
                  <Chip tone={p.published ? 'emerald' : 'neutral'}>{p.published ? t('admin.org_detail.published') : t('admin.org_detail.draft')}</Chip>
                  {p.published_at && <span className="text-xs text-neutral-400">{formatRelative(p.published_at, i18n.language)}</span>}
                </li>
              ))
            ) : (
              <li className="text-sm text-neutral-500">{t('admin.org_cfg.site.no_landing')}</li>
            )}
          </ul>
        </div>
      </div>
    </SectionCard>
  )
}

// ─── advanced: raw config ───────────────────────────────────────────────────

function AdvancedCard({ cfg, orgId }: { cfg: OrgConfiguration; orgId: string }) {
  const { t } = useTranslation()
  const token = useAccessToken()
  const me = usePlatformMe()
  const invalidate = useInvalidateOrg(orgId)
  const configQ = useOrgConfiguration(orgId)
  const original = React.useMemo(() => JSON.stringify(cfg.config ?? {}, null, 2), [cfg.config])
  const [open, setOpen] = React.useState(false)
  const [editing, setEditing] = React.useState(false)
  const [text, setText] = React.useState(original)
  const [confirm, setConfirm] = React.useState(false)
  const [serverError, setServerError] = React.useState('')
  const [seen, setSeen] = React.useState(original)
  if (seen !== original) {
    setSeen(original)
    setText(original)
  }
  const canConfig = me.can('orgs.config')

  let parsed: unknown = null
  let parseError = ''
  try {
    parsed = JSON.parse(text)
  } catch (e) {
    parseError = e instanceof Error ? e.message : t('admin.developers.endpoint.invalid_json')
  }
  const dirty = text !== original

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(original)
      toast.success(t('admin.org_cfg.advanced.copied'))
    } catch {
      toast.error(t('admin.common.error_desc'))
    }
  }

  const save = async () => {
    setServerError('')
    try {
      await updateOrgConfig(token, orgId, parsed)
      toast.success(t('admin.org.config_saved'))
      setEditing(false)
      invalidate()
      configQ.refetch()
    } catch (err) {
      const msg = errorMessage(err, t('admin.org_detail.failed_save'))
      setServerError(msg)
      toast.error(msg)
    }
  }

  return (
    <SectionCard
      icon={<BracketsCurly size={18} />}
      title={t('admin.org_cfg.advanced.title')}
      description={t('admin.org_cfg.advanced.desc', { version: cfg.config_version })}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" icon={<Copy size={13} />} onClick={copy}>
            {t('admin.org_cfg.advanced.copy')}
          </Button>
          <Button size="sm" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            {open ? t('admin.org.config_hide') : t('admin.org.config_show')}
          </Button>
        </div>
      }
    >
      {open && (
        <div className="space-y-3">
          {editing ? (
            <textarea
              dir="ltr"
              spellCheck={false}
              rows={Math.min(30, Math.max(12, text.split('\n').length + 1))}
              value={text}
              onChange={(e) => {
                setText(e.target.value)
                setServerError('')
              }}
              className={`${TEXTAREA} font-mono text-xs leading-relaxed resize-y`}
              aria-label={t('admin.org_cfg.advanced.title')}
            />
          ) : (
            <pre dir="ltr" className="max-h-[480px] overflow-auto rounded-xl bg-neutral-50 ring-1 ring-inset ring-neutral-200/70 p-4 text-xs leading-relaxed text-neutral-800 font-mono" data-testid="sa-raw-config">
              {original}
            </pre>
          )}
          {editing && parseError && <p className="text-xs font-medium text-rose-600">{t('admin.developers.endpoint.json_parse_error', { message: parseError })}</p>}
          {editing && serverError && <p className="text-xs font-medium text-rose-600">{serverError}</p>}
          <div className="flex flex-wrap items-center justify-end gap-2">
            {!canConfig && <p className="me-auto text-xs text-neutral-500">{t('admin.org_cfg.advanced.readonly')}</p>}
            {canConfig && !editing && (
              <Button size="sm" onClick={() => setEditing(true)}>
                {t('admin.org_cfg.advanced.edit')}
              </Button>
            )}
            {editing && (
              <>
                <p className="me-auto text-xs text-amber-700">{t('admin.org_cfg.advanced.edit_warning')}</p>
                <Button
                  size="sm"
                  onClick={() => {
                    setText(original)
                    setEditing(false)
                    setServerError('')
                  }}
                >
                  {t('common.cancel')}
                </Button>
                <Button size="sm" variant="danger" disabled={!dirty || !!parseError} onClick={() => setConfirm(true)}>
                  {t('admin.org.config_save')}
                </Button>
              </>
            )}
          </div>
        </div>
      )}
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t('admin.org.config_confirm_title')}
        message={t('admin.org.config_confirm_desc', { name: cfg.org.name })}
        confirmLabel={t('admin.org.config_save')}
        onConfirm={save}
      />
    </SectionCard>
  )
}

// ─── recent changes ─────────────────────────────────────────────────────────

function HistoryCard({ orgId }: { orgId: string }) {
  const { t, i18n } = useTranslation()
  const token = useAccessToken()
  const q = useQuery({
    queryKey: platformKeys.orgConfigHistory(orgId),
    queryFn: () => getOrgConfigHistory(token, orgId, 15),
    enabled: !!token,
    retry: shouldRetry,
  })
  const items = Array.isArray(q.data) ? q.data : []
  return (
    <SectionCard icon={<ClockCounterClockwise size={18} />} title={t('admin.org_cfg.history.title')} description={t('admin.org_cfg.history.desc')}>
      {q.isLoading ? (
        <Skeleton className="h-24 rounded-xl" />
      ) : q.error ? (
        <QueryError error={q.error} compact onRetry={() => q.refetch()} />
      ) : !items.length ? (
        <EmptyState icon={<ClockCounterClockwise size={20} />} title={t('admin.org_cfg.history.empty')} description={t('admin.org_cfg.history.empty_desc')} />
      ) : (
        <ol className="space-y-3" data-testid="sa-config-history">
          {items.map((e) => {
            const rows = changeRows((e.details as { changes?: unknown } | null)?.changes)
            return (
              <li key={e.id} className="rounded-xl ring-1 ring-inset ring-neutral-200/70 p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                  <p className="text-sm font-medium text-neutral-900">{e.summary}</p>
                  <p className="text-xs text-neutral-400">
                    {e.actor_label} · {formatRelative(e.created_at, i18n.language)}
                  </p>
                </div>
                {rows.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {rows.map((r) => (
                      <li key={r.path} className="grid grid-cols-1 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)] gap-x-3 text-xs">
                        <span className="text-neutral-500 truncate">{r.path}</span>
                        <span className="min-w-0 truncate" dir="auto">
                          <span className="text-neutral-400 line-through decoration-neutral-300">{r.from}</span>
                          <span className="mx-1.5 text-neutral-300">→</span>
                          <span className="font-medium text-neutral-800">{r.to}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            )
          })}
        </ol>
      )}
    </SectionCard>
  )
}

export default function ConfigurationSection({ orgId, onOpenPlan }: { orgId: string; onOpenPlan?: () => void }) {
  const { t } = useTranslation()
  const me = usePlatformMe()
  const q = useOrgConfiguration(orgId)
  const canEdit = me.can('orgs.update')

  if (q.isLoading) {
    return (
      <div className="space-y-5">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-[260px] rounded-2xl" />
        ))}
      </div>
    )
  }
  if (q.error || !q.data) return <QueryError error={q.error} onRetry={() => q.refetch()} />
  const cfg = q.data
  return (
    <div className="space-y-5" data-testid="sa-configuration">
      {!canEdit && <p className="text-sm text-neutral-500">{t('admin.org.settings_readonly')}</p>}
      <ProfileCard cfg={cfg} orgId={orgId} canEdit={canEdit} />
      <SocialsCard cfg={cfg} orgId={orgId} canEdit={canEdit} />
      <AccessCard cfg={cfg} orgId={orgId} canEdit={canEdit} />
      <FeaturesCard cfg={cfg} orgId={orgId} canEdit={canEdit} onOpenPlan={onOpenPlan} />
      <MenuCard cfg={cfg} orgId={orgId} canEdit={canEdit} />
      <SeoCard cfg={cfg} orgId={orgId} canEdit={canEdit} />
      <SiteCard cfg={cfg} />
      <AdvancedCard cfg={cfg} orgId={orgId} />
      {me.can('audit.read') && <HistoryCard orgId={orgId} />}
    </div>
  )
}
