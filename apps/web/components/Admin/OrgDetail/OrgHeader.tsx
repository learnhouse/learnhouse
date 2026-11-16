'use client'
import React from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import toast from 'react-hot-toast'
import {
  ArrowClockwise,
  ArrowCounterClockwise,
  ArrowSquareOut,
  CalendarPlus,
  Check,
  ClockCounterClockwise,
  CheckSquareOffset,
  Copy,
  CreditCard,
  EnvelopeSimple,
  FlowArrow,
  DotsThreeVertical,
  Handshake,
  NotePencil,
  PencilSimple,
  UserCircle,
  UserSwitch,
  Users,
} from '@phosphor-icons/react'
import { Breadcrumbs, Button } from '@/design'
import { safeHref } from '@services/security/url'
import { errorMessage, recomputeHealth, updateOrgProfile } from '@services/ee/platform/api'
import type { OrgProfile } from '@services/ee/platform/types'
import { useAccessToken, useFrontendDomain, usePlatformMe } from '@components/Admin/hooks'
import { Avatar, CopyLinkButton, HealthBadge, LifecycleChip, OrgLogo, PlanChip, TagList, adminPath, orgDisplayName } from '@components/Admin/Shared/AdminKit'
import { useInvalidateOrg, useTeamMembers } from './orgQueries'
// One Follow control across the console (levels, custom events, delivery).
import FollowButton from '@components/Admin/Following/FollowButton'
import EmailAdminsDialog from './EmailAdminsDialog'
import { useImpersonate } from '@components/Admin/Impersonation/useImpersonate'

// The org page header: who this is, how it's doing, who looks after it, and
// the few things people come here to do. Everything else is in the kebab.

const MENU_SURFACE =
  'min-w-[14rem] rounded-xl bg-[var(--adm-raised)] shadow-[var(--adm-shadow)] p-1.5 text-[var(--adm-fg)] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95'
const MENU_ITEM =
  'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] text-[var(--adm-fg-2)] outline-none cursor-pointer data-[highlighted]:bg-[var(--adm-hover)] data-[highlighted]:text-[var(--adm-fg)] data-[disabled]:opacity-40 data-[disabled]:cursor-default'

export type HeaderAction = 'plan' | 'start_poc' | 'extend_poc' | 'reopen' | 'note' | 'members' | 'activity'

function OwnerControl({ orgId, profile }: { orgId: string; profile?: OrgProfile }) {
  const { t } = useTranslation()
  const token = useAccessToken()
  const me = usePlatformMe()
  const invalidate = useInvalidateOrg(orgId)
  const canEdit = me.can('notes.write') && !!profile
  const team = useTeamMembers(canEdit)
  const members = Array.isArray(team.data?.members) ? team.data!.members : []
  const owner = profile?.account_owner
  const ownerId = profile?.account_owner_user_id ?? owner?.user_id ?? null

  const setOwner = async (userId: number | null) => {
    try {
      await updateOrgProfile(token, orgId, { account_owner_user_id: userId })
      toast.success(t('admin.org.owner_saved'))
      invalidate()
    } catch (err) {
      toast.error(errorMessage(err, t('admin.common.error_desc')))
    }
  }

  const label = owner ? (
    <span className="inline-flex items-center gap-1.5 min-w-0">
      <Avatar user={owner} size={20} />
      <span className="truncate">{owner.username}</span>
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 text-neutral-400">
      <UserCircle size={18} />
      {t('admin.org.no_owner')}
    </span>
  )

  return (
    <span className="inline-flex items-center gap-1.5 min-w-0 text-[13px] text-neutral-600">
      <span className="text-neutral-400">{t('admin.org.owner_label')}</span>
      {owner && ownerId ? (
        <Link href={adminPath.user(ownerId)} className="min-w-0 hover:text-neutral-900 hover:underline underline-offset-2">
          {label}
        </Link>
      ) : (
        label
      )}
      {canEdit && (
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              aria-label={t('admin.org.change_owner')}
              title={t('admin.org.change_owner')}
              className="h-6 w-6 inline-flex items-center justify-center rounded-md text-neutral-400 hover:text-neutral-900 hover:bg-neutral-100"
            >
              <PencilSimple size={13} />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content align="start" sideOffset={6} collisionPadding={12} className={MENU_SURFACE} style={{ zIndex: 'var(--z-dropdown)' as any }}>
              <DropdownMenu.Label className="px-2.5 pt-1.5 pb-1 text-[11px] font-semibold text-[var(--adm-fg-3)]">{t('admin.org.account_owner')}</DropdownMenu.Label>
              {members.length === 0 && (
                <p className="px-2.5 py-2 text-xs text-[var(--adm-fg-3)]">{team.isLoading ? t('common.loading') : t('admin.org.team_unavailable')}</p>
              )}
              {members.map((m) => (
                <DropdownMenu.Item key={m.user_id} className={MENU_ITEM} onSelect={() => setOwner(m.user_id)}>
                  <Avatar user={m} size={20} />
                  <span className="flex-1 truncate">{m.username}</span>
                  {m.user_id === ownerId && <Check size={13} weight="bold" />}
                </DropdownMenu.Item>
              ))}
              {ownerId && (
                <>
                  <DropdownMenu.Separator className="my-1 h-px bg-[var(--adm-line)]" />
                  <DropdownMenu.Item className={MENU_ITEM} onSelect={() => setOwner(null)}>
                    {t('admin.org.clear_owner')}
                  </DropdownMenu.Item>
                </>
              )}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      )}
    </span>
  )
}

export default function OrgHeader({
  org,
  orgId,
  profile,
  isSaaS,
  onAction,
}: {
  org: any
  orgId: string
  profile?: OrgProfile
  isSaaS: boolean
  onAction: (_action: HeaderAction) => void
}) {
  const { t } = useTranslation()
  const token = useAccessToken()
  const me = usePlatformMe()
  const domain = useFrontendDomain()
  const invalidate = useInvalidateOrg(orgId)

  const protocol = typeof window !== 'undefined' ? window.location.protocol : 'http:'
  const siteUrl = `${protocol}//${org.slug}.${domain}`
  const lifecycle = profile?.lifecycle ?? org.lifecycle
  const tags = profile?.tags ?? org.tags
  const health = profile?.health_score ?? org.health_score
  const inPoc = lifecycle === 'poc'
  const closed = lifecycle === 'closed'
  const canPlan = isSaaS && me.can('orgs.plan')
  const canPoc = me.can('pocs.manage')
  const canNote = me.can('notes.write')
  const [emailOpen, setEmailOpen] = React.useState(false)
  const { impersonate } = useImpersonate()

  // One primary action, picked by what this org most likely needs.
  const primary: HeaderAction | null = inPoc && canPoc ? 'extend_poc' : canPlan ? 'plan' : canNote ? 'note' : null

  const recompute = async () => {
    try {
      await recomputeHealth(token, orgId)
      toast.success(t('admin.org.health_updated'))
      invalidate()
    } catch (err) {
      toast.error(errorMessage(err, t('admin.common.error_desc')))
    }
  }

  const btn = (action: HeaderAction, icon: React.ReactNode, label: string) => (
    <Button key={action} variant={primary === action ? 'primary' : 'secondary'} icon={icon} onClick={() => onAction(action)}>
      {label}
    </Button>
  )

  return (
    <div className="flex flex-col gap-4 pt-4 sm:pt-6">
      <Breadcrumbs
        items={[
          { label: t('admin.shell.platform'), href: '/admin' },
          { label: t('admin.nav.organizations'), href: '/admin/organizations' },
          { label: org.name },
        ]}
      />
      <div className="flex flex-col lg:flex-row lg:items-start gap-4 lg:gap-6">
        <div className="flex items-start gap-4 min-w-0 flex-1">
          <OrgLogo org={org} size={56} />
          <div className="min-w-0 flex-1 space-y-2">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-neutral-900 break-words">{orgDisplayName(org, t)}</h1>
              <a
                href={safeHref(siteUrl)}
                target="_blank"
                rel="noopener noreferrer"
                dir="ltr"
                className="mt-0.5 inline-flex items-center gap-1 font-mono text-xs text-neutral-500 hover:text-neutral-900"
                title={t('admin.org.open_site')}
              >
                {org.slug}.{domain}
                <ArrowSquareOut size={12} />
              </a>
              <span className="ms-2 font-mono text-xs text-neutral-400">#{org.id}</span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {isSaaS && <PlanChip plan={org.plan} />}
              <LifecycleChip lifecycle={lifecycle} />
              {health !== undefined && health !== null && <HealthBadge score={health} />}
              <TagList tags={tags} max={4} />
            </div>
            <OwnerControl orgId={orgId} profile={profile} />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 lg:justify-end lg:max-w-[46%]">
          {canPlan && btn('plan', <CreditCard size={14} />, t('admin.org.change_plan'))}
          {canPoc && inPoc && btn('extend_poc', <CalendarPlus size={14} />, t('admin.pocs.extend'))}
          {canPoc && !inPoc && !closed && btn('start_poc', <Handshake size={14} />, t('admin.pocs.start'))}
          {canNote && btn('note', <NotePencil size={14} />, t('admin.org.add_note'))}
          <FollowButton orgId={org.id} orgName={org.name} />
          <CopyLinkButton label="" />
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <Button size="icon" aria-label={t('admin.org.more_actions')} title={t('admin.org.more_actions')} icon={<DotsThreeVertical size={16} weight="bold" />} />
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content align="end" sideOffset={6} collisionPadding={12} className={MENU_SURFACE} style={{ zIndex: 'var(--z-dropdown)' as any }}>
                {/* Opens the org as its owner, impersonating (switch member or role from the badge). */}
                {me.can('impersonation.readonly') && (
                  <DropdownMenu.Item className={MENU_ITEM} onSelect={() => void impersonate({ orgId: org.id, slug: org.slug })} data-testid="org-impersonate">
                    <UserSwitch size={15} />
                    {t('admin.impersonation.impersonate')}
                  </DropdownMenu.Item>
                )}
                <DropdownMenu.Item className={MENU_ITEM} onSelect={() => window.open(safeHref(siteUrl), '_blank', 'noopener,noreferrer')}>
                  <ArrowSquareOut size={15} />
                  {t('admin.org.open_site')}
                </DropdownMenu.Item>
                <DropdownMenu.Separator className="my-1 h-px bg-[var(--adm-line)]" />
                <DropdownMenu.Item className={MENU_ITEM} onSelect={() => onAction('members')}>
                  <Users size={15} />
                  {t('admin.org.view_members')}
                </DropdownMenu.Item>
                {me.can('audit.read') && (
                  <DropdownMenu.Item className={MENU_ITEM} onSelect={() => onAction('activity')}>
                    <ClockCounterClockwise size={15} />
                    {t('admin.org.view_activity')}
                  </DropdownMenu.Item>
                )}
                {me.can('audit.read') && (
                  <DropdownMenu.Item asChild className={MENU_ITEM}>
                    <Link href={`/admin/activity?org_id=${org.id}&via=automation`}>
                      <FlowArrow size={15} />
                      {t('admin.org.runs_touched')}
                    </Link>
                  </DropdownMenu.Item>
                )}
                <DropdownMenu.Item asChild className={MENU_ITEM}>
                  <Link href={`/admin/tasks?org_id=${org.id}`}>
                    <CheckSquareOffset size={15} />
                    {t('admin.org.tasks.open_list')}
                  </Link>
                </DropdownMenu.Item>
                {me.can('emails.send') && (
                  <DropdownMenu.Item className={MENU_ITEM} onSelect={() => setEmailOpen(true)}>
                    <EnvelopeSimple size={15} />
                    {t('admin.org.email.cta')}
                  </DropdownMenu.Item>
                )}
                {profile && (
                  <DropdownMenu.Item className={MENU_ITEM} onSelect={recompute}>
                    <ArrowClockwise size={15} />
                    {t('admin.org.recompute_health')}
                  </DropdownMenu.Item>
                )}
                <DropdownMenu.Item
                  className={MENU_ITEM}
                  onSelect={() => {
                    navigator.clipboard?.writeText(String(org.id)).then(() => toast.success(t('admin.org.id_copied')), () => {})
                  }}
                >
                  <Copy size={15} />
                  {t('admin.org.copy_id')}
                </DropdownMenu.Item>
                {closed && me.can('orgs.lifecycle') && (
                  <>
                    <DropdownMenu.Separator className="my-1 h-px bg-[var(--adm-line)]" />
                    <DropdownMenu.Item className={MENU_ITEM} onSelect={() => onAction('reopen')}>
                      <ArrowCounterClockwise size={15} />
                      {t('admin.pocs.reopen')}
                    </DropdownMenu.Item>
                  </>
                )}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      </div>
      <EmailAdminsDialog open={emailOpen} onOpenChange={setEmailOpen} org={{ id: org.id, name: org.name }} />
    </div>
  )
}
