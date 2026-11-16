'use client'
import React from 'react'
import Link from 'next/link'
import dayjs from 'dayjs'
import toast from 'react-hot-toast'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowSquareOut,
  Check,
  Copy,
  DoorOpen,
  DotsThree,
  Globe,
  Info,
  LinkSimple,
  Plus,
  Textbox,
  Ticket,
  Trash,
  Users,
  UsersThree,
} from '@phosphor-icons/react'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import OrgInviteCodeGenerate from '@components/Objects/Modals/Dash/OrgAccess/OrgInviteCodeGenerate'
import {
  Button,
  Chip,
  ChoiceCard,
  ConfirmDialog,
  EmptyState,
  SectionCard,
} from '@components/Dashboard/Shared/DashKit/DashKit'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@components/ui/dropdown-menu'
import { getAPIUrl, getAbsoluteUriWithOrg } from '@services/config/config'
import { apiFetch } from '@services/utils/ts/requests'
import { changeSignupMechanism, deleteInviteCode } from '@services/organizations/invites'
import { queryKeys } from '@/lib/query/keys'
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics'
import OrgSignupFields from './OrgSignupFields'
import { SubTabPanel, SubTabs, useSubTab } from '@components/Dashboard/Shared/DashKit/SubTabs'

type JoinMethod = 'open' | 'inviteOnly'
// The API caps an org at this many live invite codes.
const MAX_INVITE_CODES = 6
const SECTIONS = ['join', 'invites', 'fields'] as const
type Section = (typeof SECTIONS)[number]
const ITEM = 'flex items-center gap-2 cursor-pointer'

function readJoinMethod(org: any): JoinMethod {
  const config = org?.config?.config
  const isV2 = config?.config_version?.startsWith('2')
  const signupMode = isV2
    ? config?.admin_toggles?.members?.signup_mode || 'open'
    : config?.features?.members?.signup_mode || 'open'
  return signupMode === 'open' ? 'open' : 'inviteOnly'
}

function CopyIconButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = React.useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      // Clipboard can be blocked; nothing useful to show beyond not ticking.
    }
  }
  return (
    <button
      type="button"
      onClick={copy}
      title={label}
      aria-label={label}
      className="h-7 w-7 inline-flex items-center justify-center rounded-md text-neutral-400 hover:text-neutral-800 hover:bg-neutral-100 transition-colors shrink-0"
    >
      {copied ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
    </button>
  )
}

function InviteRowSkeleton() {
  return (
    <div className="flex items-center gap-3 px-5 py-4 animate-pulse">
      <div className="w-9 h-9 rounded-xl bg-neutral-100" />
      <div className="flex-1 space-y-2">
        <div className="h-3.5 w-28 rounded bg-neutral-100" />
        <div className="h-3 w-64 max-w-full rounded bg-neutral-100" />
      </div>
      <div className="hidden sm:block h-6 w-24 rounded-full bg-neutral-100" />
    </div>
  )
}

function OrgAccess() {
  const { t, i18n } = useTranslation()
  const org = useOrg() as any
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const queryClient = useQueryClient()
  const router = useRouter()
  const { track } = useLHAnalytics('dashboard')

  // The org config is the source of truth; a local override shows a change
  // at once (and survives the org payload being briefly stale after it).
  const [override, setOverride] = React.useState<JoinMethod | null>(null)
  const joinMethod: JoinMethod = override ?? readJoinMethod(org)

  const [pendingMethod, setPendingMethod] = React.useState<JoinMethod | null>(null)
  const [generateOpen, setGenerateOpen] = React.useState(false)
  const [deleting, setDeleting] = React.useState<any>(null)
  const [section, setSection] = useSubTab<Section>('join', SECTIONS)

  const invitesKey = queryKeys.org.inviteCodes(org?.id)
  const { data, isLoading: invitesLoading } = useQuery({
    queryKey: invitesKey,
    queryFn: () => apiFetch(`${getAPIUrl()}orgs/${org?.id}/invites`, access_token),
    enabled: !!org?.id && !!access_token,
    staleTime: 60_000,
  })
  const invites: any[] = Array.isArray(data) ? data : []
  const atLimit = invites.length >= MAX_INVITE_CODES

  async function changeJoinMethod(method: JoinMethod) {
    const previous = override
    setOverride(method)
    const res = await changeSignupMechanism(org.id, method, access_token)
    if (res.status == 200) {
      track(AnalyticsEvent.SignupMechanismChanged, { method })
      queryClient.invalidateQueries({ queryKey: queryKeys.org.detail(org?.slug) })
      router.refresh()
      toast.success(t('dashboard.users.signups.invite_codes.toasts.change_success', { method }))
    } else {
      setOverride(previous)
      toast.error(t('dashboard.users.signups.invite_codes.toasts.change_error'))
    }
  }

  async function removeInvite(invite: any) {
    const previous = queryClient.getQueryData(invitesKey)
    queryClient.setQueryData(invitesKey, (old: any) =>
      Array.isArray(old) ? old.filter((i: any) => i.invite_code_uuid !== invite.invite_code_uuid) : old
    )
    const res = await deleteInviteCode(org.id, invite.invite_code_uuid, access_token)
    if (res.status == 200) {
      queryClient.invalidateQueries({ queryKey: invitesKey })
      toast.success(t('dashboard.users.signups.invite_codes.toasts.delete_success'))
    } else {
      queryClient.setQueryData(invitesKey, previous)
      toast.error(t('dashboard.users.signups.invite_codes.toasts.delete_error'))
    }
  }

  const signupLink = (invite: any) => getAbsoluteUriWithOrg(org?.slug, `/signup?inviteCode=${invite.invite_code}`)

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(t('dashboard.users.dash.signups.copied'))
    } catch {
      toast.error(t('dashboard.users.dash.signups.copy_failed'))
    }
  }

  const isOpen = joinMethod === 'open'
  const dateFmt = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' })

  return (
    <div className="flex flex-col gap-5">
      <SubTabs
        ariaLabel={t('dashboard.users.signups.title')}
        value={section}
        onChange={setSection}
        items={[
          { key: 'join', label: t('dashboard.users.signups.title'), icon: <DoorOpen size={15} /> },
          {
            key: 'invites',
            label: t('dashboard.users.signups.invite_codes.title'),
            icon: <Ticket size={15} />,
            badge: invites.length > 0 ? <span className="text-xs tabular-nums text-neutral-400">{invites.length}</span> : undefined,
          },
          {
            key: 'fields',
            label: t('dashboard.users.signup_fields.title', { defaultValue: 'Custom signup fields' }),
            icon: <Textbox size={15} />,
          },
        ]}
      >
        <SubTabPanel tab="join">
          <SectionCard
            icon={<DoorOpen size={18} />}
            title={t('dashboard.users.signups.title')}
            description={t('dashboard.users.signups.subtitle')}
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" role="radiogroup">
              <ChoiceCard
                selected={isOpen}
                onClick={() => !isOpen && setPendingMethod('open')}
                icon={<Globe size={18} />}
                title={t('dashboard.users.signups.open.title')}
                description={t('dashboard.users.signups.open.description')}
              />
              <ChoiceCard
                selected={!isOpen}
                onClick={() => isOpen && setPendingMethod('inviteOnly')}
                icon={<Ticket size={18} />}
                title={t('dashboard.users.signups.closed.title')}
                description={t('dashboard.users.signups.closed.description')}
              />
            </div>
          </SectionCard>
        </SubTabPanel>

        <SubTabPanel tab="invites">
          <SectionCard
            icon={<Ticket size={18} />}
            title={t('dashboard.users.signups.invite_codes.title')}
            description={t('dashboard.users.signups.invite_codes.subtitle')}
            actions={
              <>
                <Chip tone={atLimit ? 'amber' : 'neutral'}>
                  {t('dashboard.users.dash.signups.codes_used', { count: invites.length, max: MAX_INVITE_CODES })}
                </Chip>
                <Button
                  variant="primary"
                  icon={<Plus size={14} weight="bold" />}
                  onClick={() => setGenerateOpen(true)}
                  disabled={isOpen || atLimit}
                  title={atLimit ? t('dashboard.users.dash.signups.limit_reached') : undefined}
                >
                  {t('dashboard.users.dash.signups.new_code')}
                </Button>
              </>
            }
            bodyClassName="pt-4"
          >
            {isOpen && (
              <div className="mx-5 mb-4 flex items-start gap-2 rounded-xl bg-neutral-50 ring-1 ring-inset ring-neutral-200 px-3.5 py-2.5 text-xs text-neutral-600">
                <Info size={14} className="shrink-0 mt-0.5 text-neutral-400" />
                <span>{t('dashboard.users.dash.signups.open_notice')}</span>
              </div>
            )}
            <div className={`border-t border-neutral-100 divide-y divide-neutral-100 transition-opacity ${isOpen ? 'opacity-50' : ''}`}>
              {invitesLoading ? (
                [0, 1, 2].map((i) => <InviteRowSkeleton key={i} />)
              ) : invites.length === 0 ? (
                <EmptyState
                  icon={<Ticket size={22} />}
                  title={t('dashboard.users.dash.signups.empty_title')}
                  description={t('dashboard.users.dash.signups.empty_description')}
                  action={
                    !isOpen ? (
                      <Button variant="primary" icon={<Plus size={14} weight="bold" />} onClick={() => setGenerateOpen(true)} className="mt-1">
                        {t('dashboard.users.dash.signups.new_code')}
                      </Button>
                    ) : undefined
                  }
                />
              ) : (
                invites.map((invite) => {
                  const link = signupLink(invite)
                  const expires = dayjs(invite.created_at).add(1, 'year')
                  const daysLeft = expires.diff(dayjs(), 'day')
                  return (
                    <div key={invite.invite_code_uuid} className="flex flex-wrap sm:flex-nowrap items-center gap-3 px-5 py-3.5">
                      <div className="w-9 h-9 rounded-xl bg-neutral-100 text-neutral-600 flex items-center justify-center shrink-0">
                        {invite.usergroup_id ? <UsersThree size={17} /> : <Users size={17} />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <code className="text-sm font-semibold font-mono text-neutral-900">{invite.invite_code}</code>
                          <CopyIconButton text={invite.invite_code} label={t('dashboard.users.dash.signups.copy_code')} />
                          {invite.usergroup_id ? (
                            <Chip tone="sky" icon={<UsersThree size={11} />}>
                              {invite.usergroup_name || t('dashboard.users.signups.invite_codes.types.linked_to_usergroup')}
                            </Chip>
                          ) : (
                            <Chip tone="neutral">{t('dashboard.users.signups.invite_codes.types.normal')}</Chip>
                          )}
                        </div>
                        <div className="flex items-center gap-1 min-w-0 mt-0.5">
                          <LinkSimple size={12} className="text-neutral-400 shrink-0" />
                          <span className="text-xs text-neutral-500 truncate" dir="ltr">
                            {link}
                          </span>
                        </div>
                      </div>
                      <Chip
                        tone={daysLeft < 0 ? 'rose' : daysLeft < 30 ? 'amber' : 'neutral'}
                        title={t('dashboard.users.signups.invite_codes.table.expiration_date')}
                      >
                        {daysLeft < 0
                          ? t('dashboard.users.dash.signups.expired')
                          : t('dashboard.users.dash.signups.expires', { date: dateFmt.format(expires.toDate()) })}
                      </Chip>
                      <Button variant="secondary" size="sm" icon={<Copy size={13} />} onClick={() => copyText(link)} className="hidden md:inline-flex">
                        {t('dashboard.users.dash.signups.copy_link')}
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            aria-label={t('dashboard.users.signups.invite_codes.table.actions')}
                            className="h-8 w-8 inline-flex items-center justify-center rounded-lg text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100 data-[state=open]:bg-neutral-100 transition-colors shrink-0"
                          >
                            <DotsThree size={18} weight="bold" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-52 rounded-xl p-1.5">
                          <DropdownMenuItem onSelect={() => copyText(link)} className={ITEM}>
                            <LinkSimple size={15} /> {t('dashboard.users.dash.signups.copy_link')}
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => copyText(invite.invite_code)} className={ITEM}>
                            <Copy size={15} /> {t('dashboard.users.dash.signups.copy_code')}
                          </DropdownMenuItem>
                          <DropdownMenuItem asChild>
                            <Link href={link} target="_blank" className={ITEM}>
                              <ArrowSquareOut size={15} /> {t('dashboard.users.dash.signups.open_link')}
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onSelect={() => setDeleting(invite)}
                            className={`${ITEM} text-rose-600 focus:text-rose-700 focus:bg-rose-50`}
                          >
                            <Trash size={15} /> {t('dashboard.users.signups.invite_codes.actions.delete_code')}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  )
                })
              )}
            </div>
          </SectionCard>
        </SubTabPanel>

        <SubTabPanel tab="fields">
          <OrgSignupFields />
        </SubTabPanel>
      </SubTabs>

      <OrgInviteCodeGenerate open={generateOpen} onOpenChange={setGenerateOpen} />

      <ConfirmDialog
        open={pendingMethod !== null}
        onOpenChange={(o) => !o && setPendingMethod(null)}
        tone="info"
        title={
          pendingMethod === 'open'
            ? t('dashboard.users.signups.open.confirmation_title')
            : t('dashboard.users.signups.closed.confirmation_title')
        }
        message={
          pendingMethod === 'open'
            ? t('dashboard.users.signups.open.confirmation_message')
            : t('dashboard.users.signups.closed.confirmation_message')
        }
        confirmLabel={
          pendingMethod === 'open' ? t('dashboard.users.signups.open.change_to') : t('dashboard.users.signups.closed.change_to')
        }
        onConfirm={() => pendingMethod && changeJoinMethod(pendingMethod)}
      />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t('dashboard.users.signups.invite_codes.actions.delete_confirmation_title')}
        message={t('dashboard.users.signups.invite_codes.actions.delete_confirmation_message')}
        confirmLabel={t('dashboard.users.signups.invite_codes.actions.delete_code')}
        onConfirm={() => deleting && removeInvite(deleting)}
      />
    </div>
  )
}

export default OrgAccess
