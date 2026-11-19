'use client'
import React from 'react'
import Link from 'next/link'
import dayjs from 'dayjs'
import toast from 'react-hot-toast'
import { useRouter, useSearchParams } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowSquareOut,
  CheckCircle,
  ClockCountdown,
  Copy,
  DoorOpen,
  DotsThree,
  EnvelopeSimple,
  Globe,
  Info,
  LinkSimple,
  Plus,
  Textbox,
  Ticket,
  Trash,
  UserPlus,
} from '@phosphor-icons/react'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import OrgInviteCodeGenerate from '@components/Objects/Modals/Dash/OrgAccess/OrgInviteCodeGenerate'
import { Button, ChoiceCard, ConfirmDialog, EmptyState, SearchInput, SectionCard } from '@components/Dashboard/Shared/DashKit/DashKit'
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
import type { InvitationStatus } from '@services/organizations/invitations'
import { queryKeys } from '@/lib/query/keys'
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics'
import OrgSignupFields from '../OrgAccess/OrgSignupFields'
import { RoleChip } from '../usersUi'
import InviteDialog from '../OrgUsersAdd/InviteDialog'
import InvitationsPanel, { useInvitationList } from '../OrgUsersAdd/InvitationsPanel'
import { CapacityMeter, useInvitationOptions } from '../OrgUsersAdd/invitationsKit'
import { useRoleText } from '../OrgUsersAdd/roleText'

type JoinMethod = 'open' | 'inviteOnly'
// The API caps an org at this many live invite codes.
const MAX_INVITE_CODES = 6
const ITEM = 'flex items-center gap-2 cursor-pointer'

function readJoinMethod(org: any): JoinMethod {
  const config = org?.config?.config
  const isV2 = config?.config_version?.startsWith('2')
  const signupMode = isV2
    ? config?.admin_toggles?.members?.signup_mode || 'open'
    : config?.features?.members?.signup_mode || 'open'
  return signupMode === 'open' ? 'open' : 'inviteOnly'
}

/**
 * Signups and Invite: one page, top to bottom. Invite people and follow the
 * invitations, then decide how people can join, the shareable invite codes
 * and the extra signup questions. (Replaces the separate "Invite Members"
 * and "Signups & Invite Codes" tabs.)
 */
export default function SignupsAndInvite() {
  const { t } = useTranslation()
  const searchParams = useSearchParams()
  const [inviteOpen, setInviteOpen] = React.useState(false)
  const [search, setSearch] = React.useState('')
  const [status, setStatus] = React.useState<'' | InvitationStatus>('')
  const [fieldsOpen, setFieldsOpen] = React.useState(searchParams?.get('section') === 'fields')
  const { data } = useInvitationList({ status: '', q: '', page: 1 })
  const { data: options } = useInvitationOptions()
  const counts = data?.counts
  const seats = options?.capacity.admin_seats

  // Old links into the former tabs (?section=invites|fields) land on their part.
  React.useEffect(() => {
    const section = searchParams?.get('section')
    const id = section === 'invites' ? 'invite-codes' : section === 'fields' ? 'signup-fields' : section === 'join' ? 'join-method' : null
    if (id) setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300)
  }, [searchParams])

  const stat = (key: InvitationStatus, label: string, value: number | undefined, dot: string, icon: React.ReactNode) => (
    <button
      type="button"
      onClick={() => setStatus(status === key ? '' : key)}
      aria-pressed={status === key}
      className={`flex items-center gap-2 rounded-xl px-3 py-2 text-start transition-colors ${
        status === key ? 'bg-neutral-100 ring-1 ring-inset ring-neutral-200' : 'hover:bg-neutral-50'
      }`}
    >
      <span className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${dot}`}>{icon}</span>
      <span className="min-w-0">
        <span className="block text-[11px] text-neutral-500 leading-tight">{label}</span>
        <span className="block text-base font-bold tabular-nums text-neutral-900 leading-tight">{value ?? '–'}</span>
      </span>
    </button>
  )

  return (
    <div className="flex flex-col gap-5">
      {/* 1. Invite, at a glance */}
      <section className="bg-white nice-shadow rounded-2xl p-3 sm:p-4 flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap items-center gap-1 min-w-0">
          {stat('pending', t('dashboard.users.invitations.status.pending'), counts ? counts.pending + (data?.legacy.length ?? 0) : undefined, 'bg-amber-50 text-amber-600', <ClockCountdown size={15} />)}
          {stat('accepted', t('dashboard.users.invitations.status.accepted'), counts?.accepted, 'bg-emerald-50 text-emerald-600', <CheckCircle size={15} />)}
          {stat('expired', t('dashboard.users.invitations.status.expired'), counts?.expired, 'bg-neutral-100 text-neutral-500', <EnvelopeSimple size={15} />)}
        </div>
        {seats && seats.limit !== null && (
          <div className="w-full sm:w-56 px-1">
            <CapacityMeter label={t('dashboard.users.invitations.capacity.admin_seats')} {...seats} />
          </div>
        )}
        <Button variant="primary" icon={<UserPlus size={14} />} onClick={() => setInviteOpen(true)} className="ms-auto">
          {t('dashboard.users.invitations.invite_people')}
        </Button>
      </section>

      {/* 2. Invitations */}
      <SectionCard
        icon={<EnvelopeSimple size={18} />}
        title={t('dashboard.users.invitations.list.title')}
        description={t('dashboard.users.invitations.list.subtitle')}
        actions={
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder={t('dashboard.users.invite_members.invited_users.search_placeholder')}
            className="w-full sm:w-60"
          />
        }
        bodyClassName="pt-4"
      >
        <InvitationsPanel search={search} status={status} onStatusChange={setStatus} onInvite={() => setInviteOpen(true)} />
      </SectionCard>

      {/* 3 + 4. How people can join, invite codes */}
      <JoinAndCodes />

      {/* 5. Extra signup questions, folded away until needed */}
      <div id="signup-fields">
        {fieldsOpen ? (
          <OrgSignupFields />
        ) : (
          <SectionCard
            icon={<Textbox size={18} />}
            title={t('dashboard.users.signup_fields.title')}
            description={t('dashboard.users.signup_fields.subtitle')}
            actions={
              <Button size="sm" onClick={() => setFieldsOpen(true)}>
                {t('dashboard.users.invitations.page.edit_fields')}
              </Button>
            }
          />
        )}
      </div>

      <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} />
    </div>
  )
}

function JoinAndCodes() {
  const { t, i18n } = useTranslation()
  const org = useOrg() as any
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const queryClient = useQueryClient()
  const router = useRouter()
  const { track } = useLHAnalytics('dashboard')
  const roleText = useRoleText()

  // The org config is the source of truth; a local override shows a change
  // at once (and survives the org payload being briefly stale after it).
  const [override, setOverride] = React.useState<JoinMethod | null>(null)
  const joinMethod: JoinMethod = override ?? readJoinMethod(org)
  const [pendingMethod, setPendingMethod] = React.useState<JoinMethod | null>(null)
  const [generateOpen, setGenerateOpen] = React.useState(false)
  const [deleting, setDeleting] = React.useState<any>(null)

  const codesKey = queryKeys.org.inviteCodes(org?.id)
  const { data, isLoading } = useQuery({
    queryKey: codesKey,
    queryFn: () => apiFetch(`${getAPIUrl()}orgs/${org?.id}/invites`, access_token),
    enabled: !!org?.id && !!access_token,
    staleTime: 60_000,
  })
  const codes: any[] = Array.isArray(data) ? data : []
  // Expired and used-up codes stay listed (with their usage) but don't count.
  const activeCount = codes.filter((c) => !c.status || c.status === 'active').length
  const atLimit = activeCount >= MAX_INVITE_CODES
  const isOpen = joinMethod === 'open'
  const dateFmt = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' })

  async function changeJoinMethod(method: JoinMethod) {
    const previous = override
    setOverride(method)
    const res = await changeSignupMechanism(org.id, method, access_token)
    if (res.status == 200) {
      track(AnalyticsEvent.SignupMechanismChanged, { method })
      queryClient.invalidateQueries({ queryKey: queryKeys.org.detail(org?.slug) })
      router.refresh()
      toast.success(
        t('dashboard.users.signups.invite_codes.toasts.change_success', {
          method: t(method === 'open' ? 'dashboard.users.invitations.page.mode_open' : 'dashboard.users.invitations.page.mode_invite_only'),
        })
      )
    } else {
      setOverride(previous)
      toast.error(t('dashboard.users.signups.invite_codes.toasts.change_error'))
    }
  }

  async function removeCode(code: any) {
    const previous = queryClient.getQueryData(codesKey)
    queryClient.setQueryData(codesKey, (old: any) =>
      Array.isArray(old) ? old.filter((c: any) => c.invite_code_uuid !== code.invite_code_uuid) : old
    )
    const res = await deleteInviteCode(org.id, code.invite_code_uuid, access_token)
    if (res.status == 200) {
      queryClient.invalidateQueries({ queryKey: codesKey })
      toast.success(t('dashboard.users.signups.invite_codes.toasts.delete_success'))
    } else {
      queryClient.setQueryData(codesKey, previous)
      toast.error(t('dashboard.users.signups.invite_codes.toasts.delete_error'))
    }
  }

  const signupLink = (code: any) => getAbsoluteUriWithOrg(org?.slug, `/signup?inviteCode=${code.invite_code}`)
  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(t('dashboard.users.dash.signups.copied'))
    } catch {
      toast.error(t('dashboard.users.dash.signups.copy_failed'))
    }
  }

  return (
    <>
      <SectionCard
        icon={<DoorOpen size={18} />}
        title={t('dashboard.users.invitations.page.join_title')}
        description={t('dashboard.users.invitations.page.join_description')}
      >
        <div id="join-method" className="grid grid-cols-1 sm:grid-cols-2 gap-3" role="radiogroup">
          <ChoiceCard
            selected={isOpen}
            onClick={() => !isOpen && setPendingMethod('open')}
            icon={<Globe size={18} />}
            title={t('dashboard.users.invitations.page.mode_open')}
            description={t('dashboard.users.invitations.page.mode_open_description')}
          />
          <ChoiceCard
            selected={!isOpen}
            onClick={() => isOpen && setPendingMethod('inviteOnly')}
            icon={<Ticket size={18} />}
            title={t('dashboard.users.invitations.page.mode_invite_only')}
            description={t('dashboard.users.invitations.page.mode_invite_only_description')}
          />
        </div>
      </SectionCard>

      <SectionCard
        icon={<Ticket size={18} />}
        title={t('dashboard.users.signups.invite_codes.title')}
        description={t('dashboard.users.invitations.page.codes_description')}
        actions={
          !isOpen && !atLimit ? (
            <Button icon={<Plus size={14} weight="bold" />} onClick={() => setGenerateOpen(true)}>
              {t('dashboard.users.dash.signups.new_code')}
            </Button>
          ) : undefined
        }
        bodyClassName="pt-4"
      >
        <div id="invite-codes" />
        {(isOpen || atLimit) && (
          <p className="mx-5 mb-3 flex items-start gap-2 text-xs text-neutral-500">
            <Info size={14} className="shrink-0 mt-0.5 text-neutral-400" />
            {isOpen ? t('dashboard.users.invitations.page.codes_need_invite_only') : t('dashboard.users.dash.signups.limit_reached')}
          </p>
        )}
        <div className={`border-t border-neutral-100 divide-y divide-neutral-100 ${isOpen ? 'opacity-60' : ''}`}>
          {isLoading ? (
            <div className="h-14 animate-pulse bg-neutral-50" />
          ) : codes.length === 0 ? (
            <EmptyState icon={<Ticket size={22} />} title={t('dashboard.users.dash.signups.empty_title')} description={t('dashboard.users.dash.signups.empty_description')} />
          ) : (
            codes.map((code) => {
              const link = signupLink(code)
              const expires = code.expires_at ? dayjs(code.expires_at) : code.legacy ? dayjs(code.created_at).add(1, 'year') : null
              const groups: any[] = code.usergroups ?? (code.usergroup_id ? [{ id: code.usergroup_id, name: code.usergroup_name }] : [])
              const courses: any[] = code.courses ?? []
              const parts = [
                ...groups.map((g) => g.name).filter(Boolean),
                ...(courses.length ? [t('dashboard.users.invitations.list.courses', { count: courses.length })] : []),
                typeof code.uses === 'number'
                  ? code.max_uses
                    ? t('dashboard.users.invitations.codes.uses_of', { count: code.uses, max: code.max_uses })
                    : t('dashboard.users.invitations.codes.uses', { count: code.uses })
                  : null,
                expires
                  ? expires.isBefore(dayjs())
                    ? t('dashboard.users.dash.signups.expired')
                    : t('dashboard.users.dash.signups.expires', { date: dateFmt.format(expires.toDate()) })
                  : t('dashboard.users.invitations.codes.no_expiry'),
              ].filter(Boolean)
              return (
                <div key={code.invite_code_uuid} className="flex items-center gap-3 px-4 sm:px-5 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <code className="text-sm font-semibold font-mono text-neutral-900">{code.invite_code}</code>
                      {code.role && <RoleChip name={roleText(code.role).name} />}
                      {code.status && code.status !== 'active' && (
                        <span className="text-[11px] font-semibold text-rose-600">{t(`dashboard.users.invitations.page.code_${code.status}`)}</span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-neutral-500 break-words">{parts.join(' · ')}</p>
                  </div>
                  <Button size="sm" icon={<Copy size={13} />} onClick={() => copyText(link)} className="hidden sm:inline-flex">
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
                      <DropdownMenuItem onSelect={() => copyText(code.invite_code)} className={ITEM}>
                        <Copy size={15} /> {t('dashboard.users.dash.signups.copy_code')}
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link href={link} target="_blank" className={ITEM}>
                          <ArrowSquareOut size={15} /> {t('dashboard.users.dash.signups.open_link')}
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onSelect={() => setDeleting(code)} className={`${ITEM} text-rose-600 focus:text-rose-700 focus:bg-rose-50`}>
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

      <OrgInviteCodeGenerate open={generateOpen} onOpenChange={setGenerateOpen} />
      <ConfirmDialog
        open={pendingMethod !== null}
        onOpenChange={(o) => !o && setPendingMethod(null)}
        tone="info"
        title={
          pendingMethod === 'open'
            ? t('dashboard.users.invitations.page.confirm_open_title')
            : t('dashboard.users.invitations.page.confirm_invite_only_title')
        }
        message={
          pendingMethod === 'open'
            ? t('dashboard.users.invitations.page.mode_open_description')
            : t('dashboard.users.invitations.page.mode_invite_only_description')
        }
        confirmLabel={
          pendingMethod === 'open'
            ? t('dashboard.users.invitations.page.confirm_open')
            : t('dashboard.users.invitations.page.confirm_invite_only')
        }
        onConfirm={() => pendingMethod && changeJoinMethod(pendingMethod)}
      />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t('dashboard.users.signups.invite_codes.actions.delete_confirmation_title')}
        message={t('dashboard.users.signups.invite_codes.actions.delete_confirmation_message')}
        confirmLabel={t('dashboard.users.signups.invite_codes.actions.delete_code')}
        onConfirm={() => deleting && removeCode(deleting)}
      />
    </>
  )
}
