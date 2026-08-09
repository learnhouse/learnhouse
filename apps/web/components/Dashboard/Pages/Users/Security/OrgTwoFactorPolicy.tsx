'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  ExternalLink,
  Info,
  Loader2,
  RefreshCw,
  ShieldCheck,
  ShieldOff,
  Users,
} from 'lucide-react'
import useAdminStatus from '@components/Hooks/useAdminStatus'
import { getUriWithOrg } from '@services/config/config'
import { getErrorMessage } from '@services/utils/ts/errorMessage'
import { Switch } from '@components/ui/switch'
import { Checkbox } from '@components/ui/checkbox'
import { Button } from '@components/ui/button'
import { Label } from '@components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@components/ui/select'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import {
  AdminMfaCallout,
  Badge,
  ComplianceResponse,
  GRACE_OPTIONS,
  NotAdminNotice,
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
 * actually on — with the policy off they are a wall of red badges about a rule
 * that isn't in force. Before switching it on, the confirmation dialog still
 * spells out exactly who loses access.
 */
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

      // The caller's own state is context, not the policy — a failure here must
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
  // rejects self-reset — use the code-gated disable flow instead).
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
    // Turning the requirement ON is never one click — it can lock staff out.
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
      <div className="sm:mx-10 mx-0">
        <div className="bg-white rounded-xl nice-shadow p-6 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
          <div className="grow">
            <h2 className="font-semibold text-gray-800">
              {t('dashboard.organization.security.load_error_title', {
                defaultValue: 'Something went wrong',
              })}
            </h2>
            <p className="text-sm text-gray-500 mt-1">{loadError}</p>
            <Button
              type="button"
              onClick={loadData}
              className="mt-4 bg-black text-white hover:bg-black/90"
            >
              <RefreshCw className="w-4 h-4 me-2" />
              {t('dashboard.organization.security.retry', { defaultValue: 'Retry' })}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  const readOnly = canManageOrg !== true
  const controlsDisabled = saving || readOnly
  // Coverage is only meaningful once the requirement is actually in force.
  const showCoverage = policy.require_2fa

  return (
    <div className="sm:mx-10 mx-0 space-y-4 pb-10">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-gray-100 text-gray-700">
          <ShieldCheck className="w-5 h-5" />
        </div>
        <div>
          <h1 className="font-bold text-lg text-gray-800">
            {t('dashboard.users.security.two_factor_title', { defaultValue: 'Two-factor' })}
          </h1>
          <p className="text-sm text-gray-500">
            {t('dashboard.organization.security.subtitle', {
              defaultValue:
                'Require two-factor authentication for everyone in this organization.',
            })}
          </p>
        </div>
      </div>

      {readOnly && <ReadOnlyNotice />}

      {/* ------------------------------------------------------------------ */}
      {/* 1. Compliance summary — only while the requirement is on.          */}
      {/* ------------------------------------------------------------------ */}
      {showCoverage && (
      <div className="bg-white rounded-xl nice-shadow p-5 space-y-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="font-bold text-gray-800">
              {t('dashboard.organization.security.compliance_title', {
                defaultValue: 'Two-factor coverage',
              })}
            </h2>
            <p className="text-sm text-gray-500 mt-0.5">
              {t('dashboard.organization.security.compliance_count', {
                defaultValue: '{{enabled}} of {{total}} members have two-factor enabled',
                enabled,
                total,
              })}
            </p>
          </div>
          <div className="text-end">
            <div className="text-2xl font-bold tracking-tight text-gray-800">{percent}%</div>
            <button
              type="button"
              onClick={loadData}
              disabled={loading}
              className="text-xs text-gray-400 hover:text-gray-600 inline-flex items-center gap-1 disabled:opacity-40"
            >
              <RefreshCw className="w-3 h-3" />
              {t('dashboard.organization.security.refresh', { defaultValue: 'Refresh' })}
            </button>
          </div>
        </div>

        {/* Progress indicator */}
        <div
          className="h-2 w-full bg-gray-100 rounded-full overflow-hidden"
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className={`h-full rounded-full transition-all ${
              percent === 100 ? 'bg-green-500' : percent >= 50 ? 'bg-amber-500' : 'bg-red-500'
            }`}
            style={{ width: `${percent}%` }}
          />
        </div>

        {/* The three numbers that matter */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <StatTile
            tone="green"
            icon={<CheckCircle2 className="w-4 h-4" />}
            value={enabled}
            label={t('dashboard.organization.security.stat_enrolled', {
              defaultValue: 'Enrolled',
            })}
          />
          <StatTile
            tone="blue"
            icon={<ExternalLink className="w-4 h-4" />}
            value={exemptMembers.length}
            label={t('dashboard.organization.security.stat_exempt', {
              defaultValue: 'Exempt (external sign-in)',
            })}
          />
          <StatTile
            tone={blockedMembers.length > 0 ? 'red' : 'gray'}
            icon={<ShieldOff className="w-4 h-4" />}
            value={blockedMembers.length}
            label={t('dashboard.organization.security.stat_blocked', {
              defaultValue: 'Would be blocked',
            })}
          />
        </div>

        {blockedMembers.length > 0 && (
          <p className="text-xs text-gray-500 leading-relaxed">
            {t('dashboard.organization.security.blocked_hint_active', {
              defaultValue:
                'These members lose access to this organization when their grace period ends, unless they enroll.',
            })}
          </p>
        )}

        {loadError && compliance && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200/80 rounded-lg px-3 py-2">
            {loadError}
          </p>
        )}
      </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* 2. Member list — same condition as the coverage panel above.       */}
      {/* ------------------------------------------------------------------ */}
      {showCoverage && (
      <div className="bg-white rounded-xl nice-shadow overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-3 border-b border-gray-100">
          <Users className="w-4 h-4 text-gray-400" />
          <h2 className="font-bold text-gray-800">
            {t('dashboard.organization.security.members_title', { defaultValue: 'Members' })}
          </h2>
          <span className="text-xs text-gray-400">
            {t('dashboard.organization.security.members_sorted', {
              defaultValue: 'not enrolled first',
            })}
          </span>
        </div>

        {resetError && (
          <div className="px-5 py-2.5 text-xs text-red-600 bg-red-50 border-b border-red-100">
            {resetError}
          </div>
        )}

        {members.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <Users className="w-6 h-6 text-gray-300 mx-auto" />
            <p className="text-sm text-gray-500 mt-2">
              {t('dashboard.organization.security.members_empty', {
                defaultValue: 'No members in this organization yet.',
              })}
            </p>
          </div>
        ) : (
          <>
            <ul className="divide-y divide-gray-50">
              {(showAllMembers ? members : members.slice(0, 8)).map((m) => {
                const exempt = !m.mfa_enabled && draftExempt && isExternalAuth(m.signup_method)
                return (
                  <li
                    key={m.user_id}
                    className="flex items-center justify-between gap-4 px-5 py-3"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-gray-800 truncate">
                        {memberName(m)}
                        {String(m.user_id) === String(currentUserId) && (
                          <span className="ms-2 text-[11px] font-medium text-gray-400">
                            {t('dashboard.organization.security.you', { defaultValue: 'you' })}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-gray-400 truncate">{m.email}</div>
                    </div>
                    <div className="shrink-0 flex items-center gap-2">
                      {m.mfa_enabled ? (
                        <Badge tone="green" icon={<CheckCircle2 className="w-3 h-3" />}>
                          {t('dashboard.organization.security.badge_enrolled', {
                            defaultValue: 'Enrolled',
                          })}
                        </Badge>
                      ) : exempt ? (
                        <Badge tone="blue" icon={<ExternalLink className="w-3 h-3" />}>
                          {t('dashboard.organization.security.badge_exempt', {
                            defaultValue: 'Exempt — {{method}}',
                            method: m.signup_method || 'external',
                          })}
                        </Badge>
                      ) : (
                        <Badge tone="red" icon={<ShieldOff className="w-3 h-3" />}>
                          {t('dashboard.organization.security.badge_not_enrolled', {
                            defaultValue: 'Not enrolled',
                          })}
                        </Badge>
                      )}
                      {m.mfa_enabled && String(m.user_id) !== String(currentUserId) && (
                        <button
                          type="button"
                          disabled={resettingId === m.user_id}
                          onClick={() => handleResetMember(m.user_id)}
                          onBlur={() => confirmResetId === m.user_id && setConfirmResetId(null)}
                          className={`text-[11px] font-medium px-2 py-1 rounded-md transition-colors disabled:opacity-50 ${
                            confirmResetId === m.user_id
                              ? 'bg-red-100 text-red-700 hover:bg-red-200'
                              : 'text-gray-400 hover:text-red-600 hover:bg-red-50'
                          }`}
                          title={t('dashboard.organization.security.reset_hint', {
                            defaultValue: 'Clear this member’s two-factor so they can set it up again',
                          })}
                        >
                          {resettingId === m.user_id
                            ? t('dashboard.organization.security.resetting', { defaultValue: 'Resetting…' })
                            : confirmResetId === m.user_id
                              ? t('dashboard.organization.security.reset_confirm', { defaultValue: 'Confirm reset?' })
                              : t('dashboard.organization.security.reset_2fa', { defaultValue: 'Reset 2FA' })}
                        </button>
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
                className="w-full px-5 py-2.5 text-xs font-medium text-gray-500 hover:text-gray-700 hover:bg-gray-50 inline-flex items-center justify-center gap-1 border-t border-gray-50"
              >
                {showAllMembers ? (
                  <>
                    <ChevronUp className="w-3.5 h-3.5" />
                    {t('dashboard.organization.security.show_less', {
                      defaultValue: 'Show less',
                    })}
                  </>
                ) : (
                  <>
                    <ChevronDown className="w-3.5 h-3.5" />
                    {t('dashboard.organization.security.show_all', {
                      defaultValue: 'Show all {{count}} members',
                      count: members.length,
                    })}
                  </>
                )}
              </button>
            )}
          </>
        )}
      </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* 3. The policy itself                                                */}
      {/* ------------------------------------------------------------------ */}
      <div className="bg-white rounded-xl nice-shadow p-5 space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="font-bold text-gray-800">
              {t('dashboard.organization.security.policy_title', {
                defaultValue: 'Require two-factor authentication',
              })}
            </h2>
            <p className="text-sm text-gray-500 mt-0.5 max-w-2xl leading-relaxed">
              {t('dashboard.organization.security.policy_description', {
                defaultValue:
                  'Members without a second factor are blocked from this organization once their grace period ends. They keep their account and any other organization they belong to, and regain access the moment they enroll.',
              })}
            </p>
          </div>
          <Switch
            checked={draftRequire}
            onCheckedChange={(checked) => {
              setDraftRequire(checked)
              setSaveError(null)
              setNeedsOwnMfa(false)
            }}
            disabled={controlsDisabled}
            className="shrink-0 mt-1"
            aria-label={t('dashboard.organization.security.policy_title', {
              defaultValue: 'Require two-factor authentication',
            })}
          />
        </div>

        {/* Active-policy context */}
        {policy.require_2fa && (
          <div className="rounded-lg bg-gray-50 border border-gray-100 px-4 py-3 space-y-1">
            <div className="flex items-center gap-2 text-sm text-gray-700">
              <Clock className="w-4 h-4 text-gray-400 shrink-0" />
              <span>
                {policy.require_2fa_enabled_at
                  ? t('dashboard.organization.security.active_since', {
                      defaultValue: 'Policy active since {{date}}',
                      date: formatDate(policy.require_2fa_enabled_at),
                    })
                  : t('dashboard.organization.security.active_no_date', {
                      defaultValue: 'Policy is active',
                    })}
              </span>
            </div>
            <p className="text-xs text-gray-500 leading-relaxed ps-6">
              {t('dashboard.organization.security.no_restart_note', {
                defaultValue:
                  'Saving changes to an already-active policy does not restart anyone’s countdown — existing deadlines stay anchored to the date above. The countdown only resets if you turn the requirement off and back on.',
              })}
            </p>
          </div>
        )}

        {/* Grace period */}
        <div className="max-w-sm">
          <Label htmlFor="grace-period">
            {t('dashboard.organization.security.grace_label', {
              defaultValue: 'Grace period',
            })}
          </Label>
          <Select
            value={String(draftGrace)}
            onValueChange={(value) => setDraftGrace(Number(value))}
            disabled={controlsDisabled || !draftRequire}
          >
            <SelectTrigger id="grace-period">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {GRACE_OPTIONS.map((days) => (
                <SelectItem key={days} value={String(days)}>
                  {days === 0
                    ? t('dashboard.organization.security.grace_immediately', {
                        defaultValue: 'Immediately',
                      })
                    : t('dashboard.organization.security.grace_days', {
                        defaultValue: '{{count}} days',
                        count: days,
                      })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-gray-500 mt-1.5 leading-relaxed">
            {draftGrace === 0
              ? t('dashboard.organization.security.grace_hint_immediate', {
                  defaultValue:
                    'Members without two-factor are blocked as soon as the policy is saved.',
                })
              : t('dashboard.organization.security.grace_hint_days', {
                  defaultValue:
                    'Members get {{count}} days to enroll before they are blocked. New members get the same window from the day they join.',
                  count: draftGrace,
                })}
          </p>
        </div>

        {/* External-auth exemption */}
        <div className="flex items-start gap-3">
          <Checkbox
            id="exempt-external-auth"
            checked={draftExempt}
            onCheckedChange={(checked) => setDraftExempt(checked === true)}
            disabled={controlsDisabled}
            className="mt-0.5"
          />
          <div className="space-y-0.5">
            <Label htmlFor="exempt-external-auth" className="cursor-pointer">
              {t('dashboard.organization.security.exempt_label', {
                defaultValue: 'Exempt users who sign in via Google or SSO',
              })}
            </Label>
            <p className="text-xs text-gray-500 leading-relaxed max-w-xl">
              {t('dashboard.organization.security.exempt_hint', {
                defaultValue:
                  'Their identity provider already handles multi-factor, so asking them for a second factor here adds nothing.',
              })}
            </p>
          </div>
        </div>

        {/* Self-lockout warning: the backend refuses the change anyway. */}
        {draftRequire && adminHasOwnMfa === false && !needsOwnMfa && (
          <AdminMfaCallout href={accountSecurityHref} />
        )}

        {/* The backend's ADMIN_MFA_REQUIRED_FIRST refusal. */}
        {needsOwnMfa && <AdminMfaCallout href={accountSecurityHref} message={saveError} />}

        {saveError && !needsOwnMfa && (
          <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200/80 px-4 py-3">
            <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
            <p className="text-sm text-red-700">{saveError}</p>
          </div>
        )}

        {/* Your own compliance state — context for the admin. */}
        {selfState?.required && !selfState.satisfied && (
          <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200/80 px-4 py-3">
            <Info className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <p className="text-sm text-amber-800">
              {selfState.blocking
                ? t('dashboard.organization.security.self_blocking', {
                    defaultValue:
                      'Your own deadline has passed. Enroll now to keep access to this organization.',
                  })
                : t('dashboard.organization.security.self_days_left', {
                    defaultValue:
                      'You have {{count}} days left to enroll in two-factor yourself.',
                    count: selfState.days_remaining ?? 0,
                  })}
            </p>
          </div>
        )}

        <div className="flex flex-row-reverse items-center gap-3 pt-1">
          <Button
            type="button"
            onClick={handleSaveClick}
            disabled={controlsDisabled || !isDirty}
            className="bg-black text-white hover:bg-black/90"
          >
            {saving && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
            {saving
              ? t('dashboard.organization.security.saving_short', { defaultValue: 'Saving…' })
              : t('dashboard.organization.security.save', { defaultValue: 'Save changes' })}
          </Button>
          {isDirty && !saving && (
            <button
              type="button"
              onClick={() => {
                setDraftRequire(policy.require_2fa)
                setDraftGrace(policy.require_2fa_grace_days)
                setDraftExempt(policy.exempt_external_auth)
                setSaveError(null)
                setNeedsOwnMfa(false)
              }}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              {t('dashboard.organization.security.cancel', { defaultValue: 'Cancel' })}
            </button>
          )}
        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Confirmation step for off -> on. Never a one-click accident.        */}
      {/* ------------------------------------------------------------------ */}
      <Modal
        isDialogOpen={confirmOpen}
        onOpenChange={(open) => {
          if (!saving) setConfirmOpen(open)
        }}
        minWidth="sm"
        customWidth="sm:max-w-[640px]"
        dialogTitle={t('dashboard.organization.security.confirm_title', {
          defaultValue: 'Require two-factor for everyone?',
        })}
        dialogContent={
          <div className="space-y-4 tracking-tight">
            <div className="flex items-start gap-3 rounded-xl bg-red-50 border border-red-200/80 px-4 py-3">
              <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
              <div className="text-sm text-red-800 leading-relaxed">
                {blockedMembers.length === 0 ? (
                  t('dashboard.organization.security.confirm_none', {
                    defaultValue:
                      'Everyone in this organization either has two-factor enabled or is exempt. No one loses access.',
                  })
                ) : draftGrace === 0 ? (
                  <span>
                    {t('dashboard.organization.security.confirm_immediate', {
                      defaultValue:
                        '{{count}} of {{total}} members will lose access to this organization immediately, as soon as you save.',
                      count: blockedMembers.length,
                      total,
                    })}
                  </span>
                ) : (
                  <span>
                    {t('dashboard.organization.security.confirm_deadline', {
                      defaultValue:
                        '{{count}} of {{total}} members will lose access to this organization on {{date}} unless they enable two-factor before then.',
                      count: blockedMembers.length,
                      total,
                      date: formatDate(addDays(draftGrace).toISOString()),
                    })}
                  </span>
                )}
              </div>
            </div>

            {blockedMembers.length > 0 && (
              <div className="rounded-xl border border-gray-100 overflow-hidden">
                <div className="px-4 py-2 bg-gray-50 text-xs font-medium text-gray-500">
                  {t('dashboard.organization.security.confirm_list_title', {
                    defaultValue: 'Who is affected',
                  })}
                </div>
                <ul className="max-h-48 overflow-y-auto divide-y divide-gray-50">
                  {blockedMembers.map((m) => (
                    <li key={m.user_id} className="px-4 py-2">
                      <div className="text-sm text-gray-800 truncate">{memberName(m)}</div>
                      <div className="text-xs text-gray-400 truncate">{m.email}</div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {exemptMembers.length > 0 && (
              <p className="text-xs text-gray-500 leading-relaxed">
                {t('dashboard.organization.security.confirm_exempt_note', {
                  defaultValue:
                    '{{count}} members are exempt because they sign in through an external identity provider.',
                  count: exemptMembers.length,
                })}
              </p>
            )}

            <p className="text-xs text-gray-500 leading-relaxed">
              {t('dashboard.organization.security.confirm_reversible', {
                defaultValue:
                  'This is reversible: turning the requirement off restores access immediately.',
              })}
            </p>

            <div className="flex flex-row-reverse gap-3 pt-1">
              <Button
                type="button"
                onClick={persist}
                disabled={saving}
                className="bg-red-600 text-white hover:bg-red-700"
              >
                {saving && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
                {t('dashboard.organization.security.confirm_button', {
                  defaultValue: 'Yes, require two-factor',
                })}
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={saving}
                onClick={() => setConfirmOpen(false)}
              >
                {t('dashboard.organization.security.cancel', { defaultValue: 'Cancel' })}
              </Button>
            </div>
          </div>
        }
      />
    </div>
  )
}

export default OrgTwoFactorPolicy
