'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowSquareOut,
  ArrowsClockwise,
  CaretDown,
  CaretUp,
  ChartPieSlice,
  CheckCircle,
  Clock,
  Hourglass,
  IdentificationCard,
  Lock,
  Info,
  ShieldCheck,
  ShieldSlash,
  Users,
  Warning,
} from '@phosphor-icons/react'
import useAdminStatus from '@components/Hooks/useAdminStatus'
import { SubTabPanel, SubTabs, useSubTab } from '@components/Dashboard/Shared/DashKit/SubTabs'
import { getUriWithOrg } from '@services/config/config'
import { getErrorMessage } from '@services/utils/ts/errorMessage'
import { Switch } from '@components/ui/switch'
import {
  Button,
  Chip,
  EmptyState,
  INPUT,
  SectionCard,
  SettingRow,
  StickySaveBar,
} from '@components/Dashboard/Shared/DashKit/DashKit'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import {
  AdminMfaCallout,
  Badge,
  ComplianceResponse,
  GRACE_OPTIONS,
  NotAdminNotice,
  Notice,
  ReadOnlyNotice,
  SecuritySkeleton,
  SelfComplianceState,
  StatTile,
  addDays,
  formatDate,
  isExternalAuth,
  memberName,
  useOrgSecurityPolicy,
} from './shared'

/**
 * Users → Two-factor. Owns the "require two-factor" half of the org security
 * policy: the requirement itself, its grace period, the external-auth exemption,
 * and the member coverage it implies.
 *
 * The coverage panel and member list only appear once the requirement is
 * actually on; with the policy off they are a wall of red badges about a rule
 * that isn't in force. Before switching it on, the confirmation dialog still
 * spells out exactly who loses access.
 */
// The coverage and member list only exist while two-factor is required.
const SECTIONS = ['policy', 'members'] as const
const POLICY_ONLY = ['policy'] as const
type Section = (typeof SECTIONS)[number]

const OrgTwoFactorPolicy: React.FC = () => {
  const { t } = useTranslation()
  const { canManageOrg } = useAdminStatus()
  const {
    orgId,
    orgslug,
    access_token,
    currentUserId,
    policy,
    policyLoading,
    seedVersion,
    mfaFetch,
    savePolicy,
    saving,
    saveError,
    setSaveError,
    needsOwnMfa,
    setNeedsOwnMfa,
  } = useOrgSecurityPolicy()

  const [draftRequire, setDraftRequire] = React.useState(policy.require_2fa)
  const [draftGrace, setDraftGrace] = React.useState(policy.require_2fa_grace_days)
  const [draftExempt, setDraftExempt] = React.useState(policy.exempt_external_auth)

  React.useEffect(() => {
    setDraftRequire(policy.require_2fa)
    setDraftGrace(policy.require_2fa_grace_days)
    setDraftExempt(policy.exempt_external_auth)
  }, [seedVersion, policy])

  const [compliance, setCompliance] = React.useState<ComplianceResponse | null>(null)
  const [selfState, setSelfState] = React.useState<SelfComplianceState | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [forbidden, setForbidden] = React.useState(false)
  const [confirmOpen, setConfirmOpen] = React.useState(false)
  const [showAllMembers, setShowAllMembers] = React.useState(false)
  const [section, setSection] = useSubTab<Section>('policy', policy.require_2fa ? SECTIONS : POLICY_ONLY)

  // Admin recovery state: clear a member's factor so they can re-enroll (lost
  // device, no backup codes). Handler defined after loadData (below).
  const [confirmResetId, setConfirmResetId] = React.useState<number | null>(null)
  const [resettingId, setResettingId] = React.useState<number | null>(null)
  const [resetError, setResetError] = React.useState<string | null>(null)

  const loadData = React.useCallback(async () => {
    if (!access_token || !orgId) return
    setLoading(true)
    setLoadError(null)
    try {
      const [complianceRes, selfRes] = await Promise.all([
        mfaFetch(`/org-compliance/${orgId}`, 'GET'),
        mfaFetch(`/org-policy/${orgId}`, 'GET'),
      ])

      if (complianceRes.success) {
        setCompliance(complianceRes.data as ComplianceResponse)
        setForbidden(false)
      } else {
        if (complianceRes.status === 403) setForbidden(true)
        setLoadError(
          getErrorMessage(
            complianceRes.data?.detail,
            t('dashboard.organization.security.load_error', {
              defaultValue: 'Could not load your organization’s two-factor status.',
            })
          )
        )
      }

      // The caller's own state is context, not the policy, so a failure here must
      // not blank the page.
      if (selfRes.success) setSelfState(selfRes.data as SelfComplianceState)
    } catch {
      setLoadError(
        t('dashboard.organization.security.load_error', {
          defaultValue: 'Could not load your organization’s two-factor status.',
        })
      )
    } finally {
      setLoading(false)
    }
  }, [access_token, orgId, mfaFetch, t])

  React.useEffect(() => {
    loadData()
  }, [loadData])

  // Two-click confirm on the row; never resets your own factor here (the backend
  // rejects self-reset; use the code-gated disable flow instead).
  const handleResetMember = React.useCallback(
    async (userId: number) => {
      if (confirmResetId !== userId) {
        setConfirmResetId(userId)
        setResetError(null)
        return
      }
      setResettingId(userId)
      setResetError(null)
      try {
        const res = await mfaFetch(`/org-reset/${orgId}/${userId}`, 'POST')
        if (!res.success) {
          setResetError(
            getErrorMessage(res.data?.detail, t('dashboard.organization.security.reset_error', {
              defaultValue: 'Could not reset this member’s two-factor.',
            }))
          )
        } else {
          await loadData()
        }
      } catch {
        setResetError(
          t('dashboard.organization.security.reset_error', {
            defaultValue: 'Could not reset this member’s two-factor.',
          })
        )
      } finally {
        setResettingId(null)
        setConfirmResetId(null)
      }
    },
    [confirmResetId, mfaFetch, orgId, loadData, t]
  )

  // --- derived numbers -----------------------------------------------------

  const members = React.useMemo(() => compliance?.members ?? [], [compliance])
  const total = compliance?.total ?? 0
  const enabled = compliance?.enabled ?? 0
  const percent = total > 0 ? Math.round((enabled / total) * 100) : 0

  const notEnrolled = React.useMemo(
    () => members.filter((m) => !m.mfa_enabled),
    [members]
  )
  const exemptMembers = React.useMemo(
    () => (draftExempt ? notEnrolled.filter((m) => isExternalAuth(m.signup_method)) : []),
    [notEnrolled, draftExempt]
  )
  // The number the admin actually cares about.
  const blockedMembers = React.useMemo(
    () => notEnrolled.filter((m) => !(draftExempt && isExternalAuth(m.signup_method))),
    [notEnrolled, draftExempt]
  )

  // Does the calling admin have two-factor on their own account? The backend
  // refuses to switch the policy on otherwise, so we warn before they try.
  const adminHasOwnMfa = React.useMemo(() => {
    if (!currentUserId || members.length === 0) return null
    const me = members.find((m) => String(m.user_id) === String(currentUserId))
    return me ? me.mfa_enabled : null
  }, [members, currentUserId])

  const isDirty =
    draftRequire !== policy.require_2fa ||
    draftGrace !== policy.require_2fa_grace_days ||
    draftExempt !== policy.exempt_external_auth

  const isTurningOn = draftRequire && !policy.require_2fa

  const accountSecurityHref = getUriWithOrg(orgslug || '', '/account/security')

  const persist = React.useCallback(async () => {
    const ok = await savePolicy({
      require_2fa: draftRequire,
      require_2fa_grace_days: draftGrace,
      exempt_external_auth: draftExempt,
    })
    if (ok) {
      setConfirmOpen(false)
      loadData()
    }
  }, [savePolicy, draftRequire, draftGrace, draftExempt, loadData])

  const handleSaveClick = () => {
    // Turning the requirement ON is never one click; it can lock staff out.
    if (isTurningOn) {
      setConfirmOpen(true)
      return
    }
    persist()
  }

  // --- states --------------------------------------------------------------

  if (!orgId) return null
  if (loading || policyLoading) return <SecuritySkeleton />
  if (forbidden) return <NotAdminNotice />

  if (loadError && !compliance) {
    return (
      <div className="bg-white rounded-2xl nice-shadow">
        <EmptyState
          icon={<Warning size={22} />}
          title={t('dashboard.organization.security.load_error_title', {
            defaultValue: 'Something went wrong',
          })}
          description={loadError}
          action={
            <Button variant="primary" icon={<ArrowsClockwise size={14} />} onClick={loadData} className="mt-1">
              {t('dashboard.organization.security.retry', { defaultValue: 'Retry' })}
            </Button>
          }
        />
      </div>
    )
  }

  const readOnly = canManageOrg !== true
  const controlsDisabled = saving || readOnly
  // Coverage is only meaningful once the requirement is actually in force.
  const showCoverage = policy.require_2fa

  const discard = () => {
    setDraftRequire(policy.require_2fa)
    setDraftGrace(policy.require_2fa_grace_days)
    setDraftExempt(policy.exempt_external_auth)
    setSaveError(null)
    setNeedsOwnMfa(false)
  }

  return (
    <div className="flex flex-col gap-5">
      {readOnly && <ReadOnlyNotice />}

      <SubTabs
        ariaLabel={t('dashboard.users.security.two_factor_title', { defaultValue: 'Two-factor' })}
        value={section}
        onChange={setSection}
        items={[
          {
            key: 'policy',
            label: t('dashboard.subtabs.policy', 'Policy'),
            icon: <ShieldCheck size={15} />,
            dirty: isDirty && !readOnly,
          },
          {
            key: 'members',
            label: t('dashboard.organization.security.members_title', { defaultValue: 'Members' }),
            icon: <Users size={15} />,
            hidden: !showCoverage,
          },
        ]}
      >
        <SubTabPanel tab="policy">
          {/* ------------------------------------------------------------------ */}
          {/* 1. The policy itself                                                */}
          {/* ------------------------------------------------------------------ */}
          <SectionCard
            icon={<ShieldCheck size={18} />}
            title={t('dashboard.users.security.two_factor_title', { defaultValue: 'Two-factor' })}
            description={t('dashboard.organization.security.subtitle', {
              defaultValue: 'Require two-factor authentication for everyone in this organization.',
            })}
            actions={
              policy.require_2fa ? (
                <Chip tone="emerald" icon={<CheckCircle size={12} />}>
                  {t('dashboard.organization.security.active_no_date', { defaultValue: 'Policy is active' })}
                </Chip>
              ) : undefined
            }
          >
            <div className="space-y-5">
              {/* Active-policy context */}
              {policy.require_2fa && (
                <Notice tone="neutral" icon={<Clock size={16} className="shrink-0 mt-0.5 text-neutral-400" />}>
                  <p className="text-neutral-700">
                    {policy.require_2fa_enabled_at
                      ? t('dashboard.organization.security.active_since', {
                          defaultValue: 'Policy active since {{date}}',
                          date: formatDate(policy.require_2fa_enabled_at),
                        })
                      : t('dashboard.organization.security.active_no_date', {
                          defaultValue: 'Policy is active',
                        })}
                  </p>
                  <p className="text-xs text-neutral-500 leading-relaxed mt-0.5">
                    {t('dashboard.organization.security.no_restart_note', {
                      defaultValue:
                        'Saving changes to an already-active policy does not restart anyone’s countdown; existing deadlines stay anchored to the date above. The countdown only resets if you turn the requirement off and back on.',
                    })}
                  </p>
                </Notice>
              )}

              <div className="divide-y divide-neutral-100">
                <SettingRow
                  icon={<Lock size={18} />}
                  title={
                    <label htmlFor="require-2fa" className="cursor-pointer">
                      {t('dashboard.organization.security.policy_title', {
                        defaultValue: 'Require two-factor authentication',
                      })}
                    </label>
                  }
                  description={t('dashboard.organization.security.policy_description', {
                    defaultValue:
                      'Members without a second factor are blocked from this organization once their grace period ends. They keep their account and any other organization they belong to, and regain access the moment they enroll.',
                  })}
                  control={
                    <Switch
                      id="require-2fa"
                      checked={draftRequire}
                      onCheckedChange={(checked) => {
                        setDraftRequire(checked)
                        setSaveError(null)
                        setNeedsOwnMfa(false)
                      }}
                      disabled={controlsDisabled}
                    />
                  }
                />

                {/* Grace period */}
                <SettingRow
                  icon={<Hourglass size={18} />}
                  title={
                    <label htmlFor="grace-period">
                      {t('dashboard.organization.security.grace_label', { defaultValue: 'Grace period' })}
                    </label>
                  }
                  description={
                    draftGrace === 0
                      ? t('dashboard.organization.security.grace_hint_immediate', {
                          defaultValue: 'Members without two-factor are blocked as soon as the policy is saved.',
                        })
                      : t('dashboard.organization.security.grace_hint_days', {
                          defaultValue:
                            'Members get {{count}} days to enroll before they are blocked. New members get the same window from the day they join.',
                          count: draftGrace,
                        })
                  }
                  control={
                    <select
                      id="grace-period"
                      value={String(draftGrace)}
                      onChange={(e) => setDraftGrace(Number(e.target.value))}
                      disabled={controlsDisabled || !draftRequire}
                      className={`${INPUT} !w-40 disabled:opacity-50`}
                    >
                      {GRACE_OPTIONS.map((days) => (
                        <option key={days} value={String(days)}>
                          {days === 0
                            ? t('dashboard.organization.security.grace_immediately', { defaultValue: 'Immediately' })
                            : t('dashboard.organization.security.grace_days', { defaultValue: '{{count}} days', count: days })}
                        </option>
                      ))}
                    </select>
                  }
                />

                {/* External-auth exemption */}
                <SettingRow
                  icon={<IdentificationCard size={18} />}
                  title={
                    <label htmlFor="exempt-external-auth" className="cursor-pointer">
                      {t('dashboard.organization.security.exempt_label', {
                        defaultValue: 'Exempt users who sign in via Google or SSO',
                      })}
                    </label>
                  }
                  description={t('dashboard.organization.security.exempt_hint', {
                    defaultValue:
                      'Their identity provider already handles multi-factor, so asking them for a second factor here adds nothing.',
                  })}
                  control={
                    <Switch
                      id="exempt-external-auth"
                      checked={draftExempt}
                      onCheckedChange={(checked) => setDraftExempt(checked === true)}
                      disabled={controlsDisabled}
                    />
                  }
                />
              </div>

              {/* Self-lockout warning: the backend refuses the change anyway. */}
              {draftRequire && adminHasOwnMfa === false && !needsOwnMfa && (
                <AdminMfaCallout href={accountSecurityHref} />
              )}

              {/* The backend's ADMIN_MFA_REQUIRED_FIRST refusal. */}
              {needsOwnMfa && <AdminMfaCallout href={accountSecurityHref} message={saveError} />}

              {saveError && !needsOwnMfa && <Notice tone="rose">{saveError}</Notice>}

              {/* Your own compliance state, context for the admin. */}
              {selfState?.required && !selfState.satisfied && (
                <Notice tone="amber" icon={<Info size={16} className="shrink-0 mt-0.5" />}>
                  {selfState.blocking
                    ? t('dashboard.organization.security.self_blocking', {
                        defaultValue: 'Your own deadline has passed. Enroll now to keep access to this organization.',
                      })
                    : t('dashboard.organization.security.self_days_left', {
                        defaultValue: 'You have {{count}} days left to enroll in two-factor yourself.',
                        count: selfState.days_remaining ?? 0,
                      })}
                </Notice>
              )}
            </div>
          </SectionCard>
        </SubTabPanel>

        <SubTabPanel tab="members">
          {/* ------------------------------------------------------------------ */}
          {/* 2. Compliance summary; only while the requirement is on.           */}
          {/* ------------------------------------------------------------------ */}
          {showCoverage && (
            <SectionCard
              icon={<ChartPieSlice size={18} />}
              title={t('dashboard.organization.security.compliance_title', { defaultValue: 'Two-factor coverage' })}
              description={t('dashboard.organization.security.compliance_count', {
                defaultValue: '{{enabled}} of {{total}} members have two-factor enabled',
                enabled,
                total,
              })}
              actions={
                <>
                  <span className="text-2xl font-bold tracking-tight text-neutral-900 tabular-nums">{percent}%</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={loadData}
                    disabled={loading}
                    aria-label={t('dashboard.organization.security.refresh', { defaultValue: 'Refresh' })}
                    title={t('dashboard.organization.security.refresh', { defaultValue: 'Refresh' })}
                  >
                    <ArrowsClockwise size={14} />
                  </Button>
                </>
              }
            >
              <div className="space-y-4">
                <div
                  className="h-2 w-full bg-neutral-100 rounded-full overflow-hidden"
                  role="progressbar"
                  aria-valuenow={percent}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div
                    className={`h-full rounded-full transition-all ${
                      percent === 100 ? 'bg-emerald-500' : percent >= 50 ? 'bg-amber-500' : 'bg-rose-500'
                    }`}
                    style={{ width: `${percent}%` }}
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <StatTile
                    tone="green"
                    icon={<CheckCircle size={16} />}
                    value={enabled}
                    label={t('dashboard.organization.security.stat_enrolled', { defaultValue: 'Enrolled' })}
                  />
                  <StatTile
                    tone="blue"
                    icon={<ArrowSquareOut size={16} />}
                    value={exemptMembers.length}
                    label={t('dashboard.organization.security.stat_exempt', { defaultValue: 'Exempt (external sign-in)' })}
                  />
                  <StatTile
                    tone={blockedMembers.length > 0 ? 'red' : 'gray'}
                    icon={<ShieldSlash size={16} />}
                    value={blockedMembers.length}
                    label={t('dashboard.organization.security.stat_blocked', { defaultValue: 'Would be blocked' })}
                  />
                </div>

                {blockedMembers.length > 0 && (
                  <p className="text-xs text-neutral-500 leading-relaxed">
                    {t('dashboard.organization.security.blocked_hint_active', {
                      defaultValue:
                        'These members lose access to this organization when their grace period ends, unless they enroll.',
                    })}
                  </p>
                )}

                {loadError && compliance && <Notice tone="amber">{loadError}</Notice>}
              </div>
            </SectionCard>
          )}

          {/* ------------------------------------------------------------------ */}
          {/* 3. Member list; same condition as the coverage panel above.        */}
          {/* ------------------------------------------------------------------ */}
          {showCoverage && (
            <SectionCard
              icon={<Users size={18} />}
              title={t('dashboard.organization.security.members_title', { defaultValue: 'Members' })}
              description={t('dashboard.organization.security.members_sorted', { defaultValue: 'not enrolled first' })}
              bodyClassName="pt-4"
            >
              {resetError && <div className="mx-5 mb-3"><Notice tone="rose">{resetError}</Notice></div>}

              {members.length === 0 ? (
                <div className="border-t border-neutral-100">
                  <EmptyState
                    icon={<Users size={22} />}
                    title={t('dashboard.organization.security.members_empty', {
                      defaultValue: 'No members in this organization yet.',
                    })}
                  />
                </div>
              ) : (
                <>
                  <ul className="border-t border-neutral-100 divide-y divide-neutral-100">
                    {(showAllMembers ? members : members.slice(0, 8)).map((m) => {
                      const exempt = !m.mfa_enabled && draftExempt && isExternalAuth(m.signup_method)
                      const isMe = String(m.user_id) === String(currentUserId)
                      return (
                        <li key={m.user_id} className="flex items-center justify-between gap-4 px-5 py-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <span className="w-8 h-8 rounded-full bg-neutral-100 text-neutral-500 text-xs font-bold flex items-center justify-center uppercase shrink-0">
                              {memberName(m).slice(0, 1)}
                            </span>
                            <div className="min-w-0">
                              <div className="text-sm font-semibold text-neutral-900 truncate">
                                {memberName(m)}
                                {isMe && (
                                  <span className="ms-2 text-[11px] font-medium text-neutral-400">
                                    {t('dashboard.organization.security.you', { defaultValue: 'you' })}
                                  </span>
                                )}
                              </div>
                              <div className="text-xs text-neutral-500 truncate">{m.email}</div>
                            </div>
                          </div>
                          <div className="shrink-0 flex items-center gap-2">
                            {m.mfa_enabled ? (
                              <Badge tone="green" icon={<CheckCircle size={12} />}>
                                {t('dashboard.organization.security.badge_enrolled', { defaultValue: 'Enrolled' })}
                              </Badge>
                            ) : exempt ? (
                              <Badge tone="blue" icon={<ArrowSquareOut size={12} />}>
                                {t('dashboard.organization.security.badge_exempt', {
                                  defaultValue: 'Exempt: {{method}}',
                                  method: m.signup_method || 'external',
                                })}
                              </Badge>
                            ) : (
                              <Badge tone="red" icon={<ShieldSlash size={12} />}>
                                {t('dashboard.organization.security.badge_not_enrolled', { defaultValue: 'Not enrolled' })}
                              </Badge>
                            )}
                            {m.mfa_enabled && !isMe && !readOnly && (
                              <Button
                                size="sm"
                                variant={confirmResetId === m.user_id ? 'danger' : 'danger-ghost'}
                                loading={resettingId === m.user_id}
                                onClick={() => handleResetMember(m.user_id)}
                                onBlur={() => confirmResetId === m.user_id && setConfirmResetId(null)}
                                title={t('dashboard.organization.security.reset_hint', {
                                  defaultValue: 'Clear this member’s two-factor so they can set it up again',
                                })}
                              >
                                {resettingId === m.user_id
                                  ? t('dashboard.organization.security.resetting', { defaultValue: 'Resetting…' })
                                  : confirmResetId === m.user_id
                                    ? t('dashboard.organization.security.reset_confirm', { defaultValue: 'Confirm reset?' })
                                    : t('dashboard.organization.security.reset_2fa', { defaultValue: 'Reset 2FA' })}
                              </Button>
                            )}
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                  {members.length > 8 && (
                    <button
                      type="button"
                      onClick={() => setShowAllMembers((v) => !v)}
                      className="w-full px-5 py-2.5 text-xs font-semibold text-neutral-500 hover:text-neutral-800 hover:bg-neutral-50 inline-flex items-center justify-center gap-1 border-t border-neutral-100 rounded-b-2xl"
                    >
                      {showAllMembers ? <CaretUp size={13} /> : <CaretDown size={13} />}
                      {showAllMembers
                        ? t('dashboard.organization.security.show_less', { defaultValue: 'Show less' })
                        : t('dashboard.organization.security.show_all', {
                            defaultValue: 'Show all {{count}} members',
                            count: members.length,
                          })}
                    </button>
                  )}
                </>
              )}
            </SectionCard>
          )}
        </SubTabPanel>
      </SubTabs>

      <StickySaveBar visible={isDirty && !readOnly} saving={saving} onSave={handleSaveClick} onDiscard={discard} />

      {/* ------------------------------------------------------------------ */}
      {/* Confirmation step for off -> on. Never a one-click accident.        */}
      {/* ------------------------------------------------------------------ */}
      <Modal
        isDialogOpen={confirmOpen}
        onOpenChange={(open) => setConfirmOpen(open)}
        preventClose={saving}
        size="md"
        icon={<Warning size={16} />}
        dialogTitle={t('dashboard.organization.security.confirm_title', {
          defaultValue: 'Require two-factor for everyone?',
        })}
        footer={
          <>
            <Button variant="secondary" disabled={saving} onClick={() => setConfirmOpen(false)}>
              {t('dashboard.organization.security.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button variant="danger" onClick={persist} loading={saving}>
              {t('dashboard.organization.security.confirm_button', { defaultValue: 'Yes, require two-factor' })}
            </Button>
          </>
        }
        dialogContent={
          <div className="space-y-4">
            <Notice tone={blockedMembers.length === 0 ? 'neutral' : 'rose'}>
              {blockedMembers.length === 0
                ? t('dashboard.organization.security.confirm_none', {
                    defaultValue:
                      'Everyone in this organization either has two-factor enabled or is exempt. No one loses access.',
                  })
                : draftGrace === 0
                  ? t('dashboard.organization.security.confirm_immediate', {
                      defaultValue:
                        '{{count}} of {{total}} members will lose access to this organization immediately, as soon as you save.',
                      count: blockedMembers.length,
                      total,
                    })
                  : t('dashboard.organization.security.confirm_deadline', {
                      defaultValue:
                        '{{count}} of {{total}} members will lose access to this organization on {{date}} unless they enable two-factor before then.',
                      count: blockedMembers.length,
                      total,
                      date: formatDate(addDays(draftGrace).toISOString()),
                    })}
            </Notice>

            {blockedMembers.length > 0 && (
              <div className="rounded-xl ring-1 ring-inset ring-neutral-200 overflow-hidden">
                <div className="px-4 py-2 bg-neutral-50 text-xs font-semibold text-neutral-500">
                  {t('dashboard.organization.security.confirm_list_title', { defaultValue: 'Who is affected' })}
                </div>
                <ul className="max-h-48 overflow-y-auto divide-y divide-neutral-100">
                  {blockedMembers.map((m) => (
                    <li key={m.user_id} className="px-4 py-2">
                      <div className="text-sm text-neutral-800 truncate">{memberName(m)}</div>
                      <div className="text-xs text-neutral-400 truncate">{m.email}</div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {exemptMembers.length > 0 && (
              <p className="text-xs text-neutral-500 leading-relaxed">
                {t('dashboard.organization.security.confirm_exempt_note', {
                  defaultValue:
                    '{{count}} members are exempt because they sign in through an external identity provider.',
                  count: exemptMembers.length,
                })}
              </p>
            )}

            <p className="text-xs text-neutral-500 leading-relaxed">
              {t('dashboard.organization.security.confirm_reversible', {
                defaultValue: 'This is reversible: turning the requirement off restores access immediately.',
              })}
            </p>
          </div>
        }
      />
    </div>
  )
}

export default OrgTwoFactorPolicy
