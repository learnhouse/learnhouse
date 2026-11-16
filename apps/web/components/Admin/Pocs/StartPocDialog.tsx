'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import toast from 'react-hot-toast'
import { Buildings, Handshake, Plus } from '@phosphor-icons/react'
import { Button, FieldLabel, INPUT, Modal, SearchInput, SegmentedControl, TEXTAREA } from '@/design'
import { errorMessage, listOrgs, startPoc, type StartPocBody } from '@services/ee/platform/api'
import { platformKeys } from '@services/ee/platform/keys'
import { useAccessToken, useDebounced, usePlatformMe, shouldRetry } from '@components/Admin/hooks'
import { OrgLogo, PlanChip } from '@components/Admin/Shared/AdminKit'
import { useTeamMembers } from '@components/Admin/OrgDetail/orgQueries'
import { slugify, slugifyTyping } from '@components/Admin/Organizations/CreateOrganizationModal'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/

// Start a POC on an existing organization, or create the organization and
// start its POC in one go (needs orgs.create as well as pocs.manage).

const POC_PLANS = ['standard', 'pro', 'enterprise'] as const


export default function StartPocDialog({
  open,
  onOpenChange,
  presetOrg,
}: {
  open: boolean
  onOpenChange: (_open: boolean) => void
  /** Locks the dialog to one existing organization (org detail page). */
  presetOrg?: { id: number; name: string; slug?: string; org_uuid?: string; logo_image?: string | null; plan?: string } | null
}) {
  const { t } = useTranslation()
  const token = useAccessToken()
  const qc = useQueryClient()
  const router = useRouter()
  const me = usePlatformMe()
  const canCreate = me.can('orgs.create')

  const [mode, setMode] = React.useState<'existing' | 'new'>('existing')
  const [search, setSearch] = React.useState('')
  const [picked, setPicked] = React.useState<any | null>(null)
  const [name, setName] = React.useState('')
  const [slug, setSlug] = React.useState('')
  const [slugTouched, setSlugTouched] = React.useState(false)
  const [email, setEmail] = React.useState('')
  const [plan, setPlan] = React.useState<string>('pro')
  const [days, setDays] = React.useState('30')
  const [goal, setGoal] = React.useState('')
  const [contactName, setContactName] = React.useState('')
  const [contactEmail, setContactEmail] = React.useState('')
  const [owner, setOwner] = React.useState('')
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState('')

  React.useEffect(() => {
    if (!open) return
    setMode('existing')
    setSearch('')
    setPicked(presetOrg ?? null)
    setName('')
    setSlug('')
    setSlugTouched(false)
    setEmail('')
    setPlan('pro')
    setDays('30')
    setGoal('')
    setContactName('')
    setContactEmail('')
    setOwner(me.userId ? String(me.userId) : '')
    setError('')
    setSubmitting(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, presetOrg])

  React.useEffect(() => {
    if (!slugTouched) setSlug(slugify(name))
  }, [name, slugTouched])

  const q = useDebounced(search.trim(), 250)
  const orgSearch = useQuery({
    queryKey: platformKeys.orgs({ q, limit: 6, picker: true }),
    queryFn: () => listOrgs(token, { q, limit: 6, page: 1 }),
    enabled: open && !presetOrg && mode === 'existing' && !!token,
    retry: shouldRetry,
    staleTime: 30_000,
  })
  const team = useTeamMembers(open)
  const members = Array.isArray(team.data?.members) ? team.data!.members : []

  const daysNum = Number(days)
  const daysValid = Number.isInteger(daysNum) && daysNum >= 1 && daysNum <= 120
  // Same rules as "New organization" (CreateOrganizationModal).
  const slugOk = SLUG_RE.test(slugify(slug))
  const emailOk = EMAIL_RE.test(email.trim())
  const contactEmailOk = !contactEmail.trim() || EMAIL_RE.test(contactEmail.trim())
  const canSubmit =
    !submitting &&
    daysValid &&
    contactEmailOk &&
    (mode === 'existing' ? !!picked : name.trim().length > 0 && slugOk && emailOk)

  const submit = async () => {
    setSubmitting(true)
    setError('')
    const body: StartPocBody = { plan, days: daysNum }
    if (mode === 'existing') body.org_id = picked.id
    else body.create_org = { name: name.trim(), slug: slugify(slug), email: email.trim() }
    if (goal.trim()) body.goal = goal.trim()
    if (contactName.trim()) body.contact_name = contactName.trim()
    if (contactEmail.trim()) body.contact_email = contactEmail.trim()
    if (owner) body.owner_user_id = Number(owner)
    try {
      const profile = await startPoc(token, body)
      toast.success(t('admin.pocs.started'))
      qc.invalidateQueries({ queryKey: platformKeys.pocsAll() })
      qc.invalidateQueries({ queryKey: platformKeys.orgs() })
      const orgId = mode === 'existing' ? picked.id : profile?.org_id
      if (orgId) qc.invalidateQueries({ queryKey: platformKeys.org(orgId) })
      onOpenChange(false)
      if (mode === 'new' && orgId) router.push(`/admin/organizations/${orgId}?section=poc`)
    } catch (err) {
      setError(errorMessage(err, t('admin.common.error_desc')))
    } finally {
      setSubmitting(false)
    }
  }

  const results = Array.isArray(orgSearch.data?.items) ? orgSearch.data!.items : []

  return (
    <Modal
      isDialogOpen={open}
      onOpenChange={onOpenChange}
      size="md"
      preventClose={submitting}
      icon={<Handshake size={16} />}
      dialogTitle={t('admin.pocs.start_title')}
      dialogDescription={t('admin.pocs.start_desc')}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button onClick={() => onOpenChange(false)} disabled={submitting}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" onClick={submit} disabled={!canSubmit} loading={submitting}>
            {t('admin.pocs.start_confirm', { count: daysValid ? daysNum : 0 })}
          </Button>
        </div>
      }
      dialogContent={
        <div className="space-y-5">
          {!presetOrg && canCreate && (
            <SegmentedControl
              value={mode}
              onChange={setMode}
              ariaLabel={t('admin.pocs.org_source')}
              options={[
                { key: 'existing', label: t('admin.pocs.existing_org') },
                { key: 'new', label: t('admin.pocs.new_org') },
              ]}
            />
          )}

          {mode === 'existing' ? (
            <div>
              <FieldLabel>{t('admin.pocs.organization')}</FieldLabel>
              {picked ? (
                <div className="flex items-center gap-3 rounded-xl px-3 py-2.5 ring-1 ring-inset ring-neutral-200">
                  <OrgLogo org={picked} size={28} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-neutral-900 truncate">{picked.name}</p>
                    {picked.slug && (
                      <p className="text-xs text-neutral-400 truncate" dir="ltr">
                        {picked.slug}
                      </p>
                    )}
                  </div>
                  <PlanChip plan={picked.plan} />
                  {!presetOrg && (
                    <Button size="sm" variant="ghost" onClick={() => setPicked(null)}>
                      {t('admin.pocs.change')}
                    </Button>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  <SearchInput value={search} onChange={setSearch} placeholder={t('admin.pocs.search_org')} />
                  <div className="rounded-xl ring-1 ring-inset ring-neutral-200 divide-y divide-neutral-100 max-h-56 overflow-y-auto">
                    {results.length === 0 ? (
                      <p className="px-3 py-6 text-center text-xs text-neutral-400">
                        {orgSearch.isLoading ? t('common.loading') : t('admin.pocs.no_org_match')}
                      </p>
                    ) : (
                      results.map((o) => (
                        <button
                          key={o.id}
                          type="button"
                          onClick={() => setPicked(o)}
                          className="w-full flex items-center gap-3 px-3 py-2 text-start hover:bg-neutral-50"
                        >
                          <OrgLogo org={o} size={24} />
                          <span className="min-w-0 flex-1 text-sm text-neutral-800 truncate">{o.name}</span>
                          <PlanChip plan={o.plan} />
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <FieldLabel>{t('admin.create_org.name')}</FieldLabel>
                <input value={name} onChange={(e) => setName(e.target.value)} className={INPUT} placeholder={t('admin.create_org.name_placeholder')} />
              </div>
              <div>
                <FieldLabel hint={t('admin.create_org.slug_hint')} error={slug && !slugOk ? t('admin.create_org.slug_invalid') : undefined}>
                  {t('admin.create_org.slug')}
                </FieldLabel>
                <input
                  value={slug}
                  dir="ltr"
                  onChange={(e) => {
                    setSlugTouched(true)
                    setSlug(slugifyTyping(e.target.value))
                  }}
                  onBlur={() => setSlug((v) => slugify(v))}
                  className={`${INPUT} font-mono`}
                  placeholder="acme-learning"
                />
              </div>
              <div>
                <FieldLabel error={email.trim() && !emailOk ? t('admin.create_org.email_invalid') : undefined}>{t('admin.create_org.email')}</FieldLabel>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={INPUT} placeholder="admin@acme.com" />
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <FieldLabel hint={t('admin.pocs.plan_hint')}>{t('admin.pocs.plan')}</FieldLabel>
              <select value={plan} onChange={(e) => setPlan(e.target.value)} className={INPUT}>
                {POC_PLANS.map((p) => (
                  <option key={p} value={p}>
                    {t(`admin.plans.${p}`)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <FieldLabel error={!daysValid ? t('admin.pocs.days_invalid_start') : undefined} hint={t('admin.pocs.days_hint_start')}>
                {t('admin.pocs.days')}
              </FieldLabel>
              <input type="number" min={1} max={120} value={days} onChange={(e) => setDays(e.target.value)} className={INPUT} />
            </div>
          </div>

          <div>
            <FieldLabel hint={t('common.optional')}>{t('admin.pocs.goal')}</FieldLabel>
            <textarea rows={2} maxLength={500} value={goal} onChange={(e) => setGoal(e.target.value)} className={TEXTAREA} placeholder={t('admin.pocs.goal_placeholder')} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <FieldLabel hint={t('common.optional')}>{t('admin.pocs.contact_name')}</FieldLabel>
              <input value={contactName} onChange={(e) => setContactName(e.target.value)} className={INPUT} />
            </div>
            <div>
              <FieldLabel hint={t('common.optional')} error={!contactEmailOk ? t('admin.create_org.email_invalid') : undefined}>
                {t('admin.pocs.contact_email')}
              </FieldLabel>
              <input type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} className={INPUT} />
            </div>
          </div>

          {members.length > 0 && (
            <div>
              <FieldLabel hint={t('admin.pocs.owner_hint')}>{t('admin.pocs.owner')}</FieldLabel>
              <select value={owner} onChange={(e) => setOwner(e.target.value)} className={INPUT}>
                <option value="">{t('admin.pocs.no_owner')}</option>
                {members.map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.username} ({t(`admin.roles.${m.role}`, { defaultValue: m.role })})
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="flex items-start gap-2 rounded-xl bg-neutral-50 px-3 py-2.5 text-xs text-neutral-600">
            {mode === 'new' ? <Plus size={14} className="mt-0.5 shrink-0" /> : <Buildings size={14} className="mt-0.5 shrink-0" />}
            <span>{t('admin.pocs.start_explainer', { plan: t(`admin.plans.${plan}`) })}</span>
          </div>

          {error && (
            <p className="text-sm text-rose-600">{error}</p>
          )}
        </div>
      }
    />
  )
}
