'use client'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import {
  EnvelopeSimple,
  GoogleLogo,
  Key,
  LockKey,
  SealCheck,
  SealWarning,
  ShieldCheck,
  ShieldSlash,
} from '@phosphor-icons/react'
import { Button, Chip, ConfirmDialog } from '@components/Dashboard/Shared/DashKit/DashKit'
import { Skeleton } from '@/design'
import { detailMessage } from '@services/utils/ts/requests'
import {
  resendVerificationEmail,
  resetMemberMfa,
  sendPasswordResetEmail,
  type MemberSummary,
} from '@services/organizations/memberPanel'
import { RoleIcon, roleTone } from '../../usersUi'
import { P, PanelSection, dateOnly } from '../panelUi'
import { useInvalidateMember, usePanelAuth } from '../panelState'
import { PanelBlocks } from '../slots'
import MemberGroupsList from '@components/Dashboard/Pages/Users/OrgUserGroups/MemberGroupsList'

type Level = 'manage' | 'edit' | 'own' | 'view' | 'none'
const AREAS = ['courses', 'assignments', 'users', 'usergroups', 'communities', 'boards', 'podcasts', 'roles', 'organizations'] as const

function levelOf(perms: Record<string, boolean> | undefined): Level {
  if (!perms) return 'none'
  if (perms.action_create && perms.action_update && perms.action_delete) return 'manage'
  if (perms.action_update || perms.action_create) return 'edit'
  if (perms.action_update_own || perms.action_delete_own) return 'own'
  if (perms.action_read || perms.action_read_own) return 'view'
  return 'none'
}

const LEVEL_TONE: Record<Level, string> = {
  manage: 'bg-emerald-50 text-emerald-700 ring-emerald-600/15',
  edit: 'bg-sky-50 text-sky-700 ring-sky-600/15',
  own: 'bg-amber-50 text-amber-700 ring-amber-600/15',
  view: 'bg-neutral-100 text-neutral-600 ring-neutral-900/5',
  none: 'bg-white text-neutral-300 ring-neutral-900/5',
}

export default function SecurityTab({
  userId,
  summary,
  isAdminRole,
  canManage,
  onRemoveGroup,
}: {
  userId: number
  summary?: MemberSummary
  /** The viewer holds the Admin role (two-factor resets are Admin-only). */
  isAdminRole: boolean
  canManage: boolean
  onRemoveGroup: (_group: any) => void
}) {
  const { t, i18n } = useTranslation()
  const { orgId, token } = usePanelAuth()
  const invalidate = useInvalidateMember()
  const [confirmReset, setConfirmReset] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  if (!summary) {
    return (
      <div className="flex flex-col gap-5" aria-hidden>
        <Skeleton className="h-40 w-full rounded-2xl" />
        <Skeleton className="h-32 w-full rounded-2xl" />
      </div>
    )
  }

  const sec = summary.security
  const email = summary.user?.email
  const rights = summary.role?.rights || {}
  const method = sec.signup_method || 'email'
  const passwordAccount = method === 'email'

  const run = async (key: string, fn: () => Promise<any>, ok: string, fail: string) => {
    setBusy(key)
    try {
      const res = await fn()
      if (res.success) toast.success(ok)
      else toast.error(res.status === 429 ? t(`${P}.security.rate_limited`) : detailMessage(res.data?.detail, fail))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <PanelSection title={t(`${P}.security.role_title`)} flush>
        <div className="flex items-center gap-3 px-4 py-3 border-b border-neutral-100">
          <span
            className={`w-8 h-8 rounded-[10px] flex items-center justify-center shrink-0 ${
              roleTone(summary.role?.name) === 'violet'
                ? 'bg-violet-50 text-violet-600'
                : roleTone(summary.role?.name) === 'sky'
                  ? 'bg-sky-50 text-sky-600'
                  : 'bg-neutral-100 text-neutral-600'
            }`}
          >
            <RoleIcon name={summary.role?.name} size={16} />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-neutral-900">{summary.role?.name}</p>
            {summary.role?.description && <p className="text-xs text-neutral-500 truncate">{summary.role.description}</p>}
          </div>
          {rights.dashboard?.action_access && (
            <Chip tone="sky" className="ms-auto">
              {t(`${P}.security.dashboard_access`)}
            </Chip>
          )}
        </div>
        <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2.5 px-4 py-3.5">
          {AREAS.filter((a) => rights[a]).map((area) => {
            const level = levelOf(rights[area])
            return (
              <div key={area} className="flex items-center justify-between gap-2 min-w-0">
                <dt className="text-xs text-neutral-600 truncate">{t(`${P}.security.areas.${area}`)}</dt>
                <dd className={`text-[10px] font-semibold rounded-full px-2 py-0.5 ring-1 ring-inset whitespace-nowrap ${LEVEL_TONE[level]}`}>
                  {t(`${P}.security.levels.${level}`)}
                </dd>
              </div>
            )
          })}
        </dl>
      </PanelSection>

      <PanelSection title={t(`${P}.security.groups_title`)} flush>
        {summary.usergroups.length === 0 ? (
          <p className="px-4 py-3.5 text-sm text-neutral-400">{t(`${P}.security.no_groups`)}</p>
        ) : (
          <MemberGroupsList
            userId={userId}
            groups={summary.usergroups}
            canManage={canManage}
            onRemove={onRemoveGroup}
            removeLabel={(g) => t(`${P}.groups.remove`, { group: g.name })}
          />
        )}
      </PanelSection>

      <PanelBlocks area="security" userId={userId} orgId={orgId ?? 0} summary={summary} canManage={canManage} />

      <PanelSection title={t(`${P}.security.sign_in_title`)} flush>
        <ul className="divide-y divide-neutral-100">
          <Row
            icon={method === 'google' ? <GoogleLogo size={15} weight="bold" /> : method === 'sso' ? <Key size={15} /> : <EnvelopeSimple size={15} />}
            tone="bg-neutral-100 text-neutral-600"
            title={t(`${P}.security.method`)}
            detail={t(`${P}.security.methods.${['email', 'google', 'sso', 'magic_link', 'lti', 'demo'].includes(method) ? method : 'other'}`, {
              method,
            })}
          />
          <Row
            icon={sec.email_verified ? <SealCheck size={15} weight="fill" /> : <SealWarning size={15} weight="fill" />}
            tone={sec.email_verified ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}
            title={sec.email_verified ? t(`${P}.security.email_verified`) : t(`${P}.security.email_unverified`)}
            detail={email}
            action={
              !sec.email_verified && canManage && email ? (
                <Button
                  size="sm"
                  loading={busy === 'verify'}
                  onClick={() =>
                    run(
                      'verify',
                      () => resendVerificationEmail(orgId!, email, token!),
                      t(`${P}.security.verification_sent`, { email }),
                      t(`${P}.security.action_error`)
                    )
                  }
                >
                  {t(`${P}.security.resend_verification`)}
                </Button>
              ) : undefined
            }
          />
          <Row
            icon={sec.mfa_enabled ? <ShieldCheck size={15} weight="fill" /> : <ShieldSlash size={15} />}
            tone={sec.mfa_enabled ? 'bg-emerald-50 text-emerald-600' : 'bg-neutral-100 text-neutral-500'}
            title={sec.mfa_enabled ? t(`${P}.security.mfa_on`) : t(`${P}.security.mfa_off`)}
            detail={
              sec.mfa_enabled
                ? t(`${P}.security.mfa_since`, { date: dateOnly(sec.mfa_enabled_at, i18n.language) })
                : t(`${P}.security.mfa_off_hint`)
            }
            action={
              sec.can_reset_mfa && isAdminRole ? (
                <Button size="sm" variant="danger-ghost" onClick={() => setConfirmReset(true)}>
                  {t(`${P}.security.reset_mfa`)}
                </Button>
              ) : undefined
            }
          />
          {passwordAccount && canManage && email && !sec.is_self && (
            <Row
              icon={<LockKey size={15} />}
              tone="bg-neutral-100 text-neutral-600"
              title={t(`${P}.security.password`)}
              detail={t(`${P}.security.password_hint`)}
              action={
                <Button
                  size="sm"
                  loading={busy === 'reset'}
                  onClick={() =>
                    run(
                      'reset',
                      () => sendPasswordResetEmail(orgId!, email, token!),
                      t(`${P}.security.reset_sent`, { email }),
                      t(`${P}.security.action_error`)
                    )
                  }
                >
                  {t(`${P}.security.send_reset`)}
                </Button>
              }
            />
          )}
        </ul>
      </PanelSection>

      <ConfirmDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title={t(`${P}.security.reset_mfa_title`)}
        message={t(`${P}.security.reset_mfa_message`, { name: summary.user?.first_name || summary.user?.username })}
        confirmLabel={t(`${P}.security.reset_mfa`)}
        onConfirm={async () => {
          const res = await resetMemberMfa(orgId!, userId, token!)
          if (res.success) toast.success(t(`${P}.security.mfa_reset_done`))
          else toast.error(detailMessage(res.data?.detail, t(`${P}.security.action_error`)))
          await invalidate()
        }}
      />
    </div>
  )
}

function Row({
  icon,
  tone,
  title,
  detail,
  action,
}: {
  icon: React.ReactNode
  tone: string
  title: string
  detail?: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <span className={`w-8 h-8 rounded-[10px] flex items-center justify-center shrink-0 ${tone}`}>{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-neutral-900">{title}</p>
        {detail && <p className="text-xs text-neutral-500 truncate">{detail}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </li>
  )
}
