'use client'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowSquareOut,
  BookOpen,
  CaretDown,
  CaretLeft,
  CaretRight,
  ChartBar,
  ChatCircleText,
  Check,
  Copy,
  DotsThree,
  DownloadSimple,
  Exam,
  LinkSimple,
  MagnifyingGlass,
  Plus,
  Pulse,
  SealWarning,
  ShieldCheck,
  ShieldSlash,
  ShieldStar,
  SignOut,
  SquaresFour,
  UserPlus,
  UsersThree,
  X,
} from '@phosphor-icons/react'
import { Button, Chip, ConfirmDialog, formatRelative } from '@components/Dashboard/Shared/DashKit/DashKit'
import { AIMark, Skeleton } from '@/design'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@components/ui/dropdown-menu'
import UserAvatar from '@components/Objects/UserAvatar'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { usePlan } from '@components/Hooks/usePlan'
import useAdminStatus from '@components/Hooks/useAdminStatus'
import { useResolvedFeature } from '@components/Hooks/useResolvedFeature'
import { useMessaging, useMessagingEnabled } from '@components/Messaging/MessagingProvider'
import { openInDock } from '@components/Messaging/Dock/dockBus'
import { useAtlasMini } from '@ee/components/Atlas/AtlasMiniContext'
import { useAuditExport } from '@ee/components/Analytics/Users/UserAuditExport'
import { isOrgAnalyticsAvailable } from '@ee/components/Analytics/availability'
import SendEmailButton from '@ee/components/Newsletter/Individual/SendEmailButton'
import { planMeetsRequirement } from '@services/plans/plans'
import { getAPIUrl, getDeploymentMode, getUriWithOrg } from '@services/config/config'
import { getUserAvatarMediaDirectory } from '@services/media/media'
import { createConversation } from '@services/messaging/messaging'
import { enrollMemberInCourse, removeUserFromOrg, updateUserRole } from '@services/organizations/orgs'
import { linkUserToUserGroup, unLinkUserToUserGroup } from '@services/usergroups/usergroups'
import { getAllOrgCourses } from '@services/courses/courses'
import { apiFetch, asArray, detailMessage } from '@services/utils/ts/requests'
import { queryKeys } from '@/lib/query/keys'
import { INPUT } from '@components/Dashboard/Shared/DashKit/DashKit'
import { buttonClass } from '@components/Dashboard/Shared/DashKit/buttons'
import { RoleIcon, RolePicker, displayName, roleKind } from '../usersUi'
import ToolTip from '@components/Objects/StyledElements/Tooltip/Tooltip'
import { RiskChip } from './risk'
import { usePanelWidth } from './usePanelWidth'
import OverviewTab from './tabs/OverviewTab'
import { P } from './panelUi'
import {
  PANEL_TABS,
  closeUserPanel,
  forgetPanelPush,
  memberKey,
  openUserPanel,
  setUserPanelTab,
  useInvalidateMember,
  useMemberNeighbours,
  useMemberSummary,
  useUserPanelParams,
  type PanelTab,
} from './panelState'
import type { MemberSummary } from '@services/organizations/memberPanel'

const tabLoading = () => (
  <div className="flex flex-col gap-3" aria-hidden>
    <Skeleton className="h-14 w-full rounded-2xl" />
    <Skeleton className="h-14 w-full rounded-2xl" />
    <Skeleton className="h-14 w-full rounded-2xl" />
  </div>
)
const LearningTab = dynamic(() => import('./tabs/LearningTab'), { loading: tabLoading })
const AssignmentsTab = dynamic(() => import('./tabs/AssignmentsTab'), { loading: tabLoading })
const ActivityTab = dynamic(() => import('./tabs/ActivityTab'), { loading: tabLoading })
const AnalyticsTab = dynamic(() => import('./tabs/AnalyticsTab'), { loading: tabLoading })
const SecurityTab = dynamic(() => import('./tabs/SecurityTab'), { loading: tabLoading })

// Under --z-dropdown (100) so menus inside the panel open above it, and under
// --z-modal so the confirms and pickers it opens stack on top.
const PANEL_Z = 95

type Member = { user: any; role: any; usergroups?: any[]; joined_at?: string }

const TAB_META: Record<PanelTab, { icon: React.ReactNode; tone: string }> = {
  overview: { icon: <SquaresFour size={15} weight="duotone" />, tone: 'text-neutral-900' },
  learning: { icon: <BookOpen size={15} weight="duotone" />, tone: 'text-sky-600' },
  assignments: { icon: <Exam size={15} weight="duotone" />, tone: 'text-amber-600' },
  activity: { icon: <Pulse size={15} weight="duotone" />, tone: 'text-emerald-600' },
  analytics: { icon: <ChartBar size={15} weight="duotone" />, tone: 'text-sky-600' },
  security: { icon: <ShieldCheck size={15} weight="duotone" />, tone: 'text-rose-600' },
}

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null
  if (!el) return false
  return !!el.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]')
}

/** Another layer (menu, dialog, picker) is open on top of the panel. */
function overlayOpen() {
  return !!document.querySelector('[role="menu"], [role="alertdialog"], [role="dialog"]:not([data-user-panel])')
}

/**
 * `listQuery`: the table's filter/sort query string (no page/limit), so j/k can
 * step through the same list when the open member is not on the loaded page.
 * Null when there is no list to step through.
 */
export default function UserPanel({ members, listQuery = null }: { members: Member[]; listQuery?: string | null }) {
  const { userId, tab } = useUserPanelParams()
  const memberIds = useMemo(() => members.map((m) => m.user.id as number), [members])
  const preview = useMemo(() => members.find((m) => m.user.id === userId), [members, userId])

  // Back/forward land on whatever entry: our pushed one is no longer "ours".
  useEffect(() => {
    const onPop = () => forgetPanelPush()
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  // Mark the member's row in the table without re-rendering the table.
  useEffect(() => {
    if (userId == null) return
    const row = document.querySelector<HTMLElement>(`[data-member-row="${userId}"]`)
    row?.setAttribute('data-panel-active', 'true')
    return () => row?.removeAttribute('data-panel-active')
  }, [userId, members])

  if (userId == null || typeof document === 'undefined') return null
  return createPortal(<PanelShell key="panel" userId={userId} tab={tab} memberIds={memberIds} listQuery={listQuery} preview={preview} />, document.body)
}

function PanelShell({
  userId,
  tab,
  memberIds,
  listQuery,
  preview,
}: {
  userId: number
  tab: PanelTab
  memberIds: number[]
  listQuery: string | null
  preview?: Member
}) {
  const { t, i18n } = useTranslation()
  const params = useParams() as any
  const org = useOrg() as any
  const session = useLHSession() as any
  const token = session?.data?.tokens?.access_token as string | undefined
  const currentUserId = session?.data?.user?.id
  const queryClient = useQueryClient()
  const invalidate = useInvalidateMember()
  const { canManageOrg } = useAdminStatus()
  const plan = usePlan()
  const auditFeature = useResolvedFeature('audit_logs')
  const atlas = useAtlasMini()
  const messagingEnabled = useMessagingEnabled()
  const messaging = useMessaging()

  const { data: summary, isError, refetch } = useMemberSummary(userId)
  const { wide, width, dragging, handleProps, onHandleKey, min: panelMin, max: panelMax } = usePanelWidth()
  const user = summary?.user ?? preview?.user
  const role = summary?.role ?? preview?.role
  const groups: any[] = summary?.usergroups ?? preview?.usergroups ?? []
  const joinedAt = summary?.joined_at ?? preview?.joined_at
  const name = user ? displayName(user) : ''
  const isSelf = userId === currentUserId
  const canManage = !!canManageOrg && !isSelf

  const analyticsEdition = isOrgAnalyticsAvailable()
  const analyticsAvailable = analyticsEdition && planMeetsRequirement(plan, 'pro')
  const auditLog = getDeploymentMode() !== 'oss' && auditFeature.enabled && !!canManageOrg
  const atlasAvailable = atlas.available && planMeetsRequirement(plan, 'pro')

  const neighbours = useMemberNeighbours(userId, memberIds, listQuery)
  const found = neighbours?.status === 'found' ? neighbours : null
  const prev = found?.prev ?? null
  const next = found?.next ?? null
  // Why the arrows are off when they are (shown as their tooltip).
  const stepBlocked =
    neighbours == null
      ? t(`${P}.step.loading`)
      : neighbours.status === 'outside'
        ? t(`${P}.step.outside`)
        : neighbours.status === 'too_large'
          ? t(`${P}.step.too_large`, { count: neighbours.total })
          : null

  // ---- shared lists (the table already has them cached) ----
  const { data: roles } = useQuery({
    queryKey: queryKeys.org.roles(org?.id),
    queryFn: () => apiFetch(`${getAPIUrl()}roles/org/${org?.id}`, token),
    select: (res: any) => asArray<any>(res),
    enabled: !!org?.id && !!token,
    staleTime: 60_000,
  })
  const { data: usergroups } = useQuery({
    queryKey: queryKeys.usergroups.list(org?.id),
    queryFn: () => apiFetch(`${getAPIUrl()}usergroups/org/${org?.id}?org_id=${org?.id}`, token),
    select: (res: any) => asArray<any>(res),
    enabled: !!org?.id && !!token,
    staleTime: 60_000,
  })

  // ---- dialogs ----
  const [roleChange, setRoleChange] = useState<any | null>(null)
  const [removing, setRemoving] = useState(false)
  const [removingGroup, setRemovingGroup] = useState<any | null>(null)
  const [enrollOpen, setEnrollOpen] = useState(false)

  // ---- keyboard: j/k between members, Esc closes ----
  const panelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target) || overlayOpen()) return
      if (e.key === 'Escape') {
        e.preventDefault()
        closeUserPanel()
      } else if (e.key === 'j' && next != null) {
        e.preventDefault()
        openUserPanel(next)
      } else if (e.key === 'k' && prev != null) {
        e.preventDefault()
        openUserPanel(prev)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [next, prev])

  // Focus moves into the panel when it opens and back to the row on close.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    panelRef.current?.focus({ preventScroll: true })
    return () => {
      const row = document.querySelector<HTMLElement>(`[data-member-row="${userId}"] [data-open-member]`)
      ;(row ?? opener)?.focus?.({ preventScroll: true })
    }
    // Only on mount/unmount of the panel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
  }, [userId, tab])

  // ---- actions ----
  const summaryKey = memberKey(org?.id ?? 0, userId, 'summary')

  const applyRole = async (newRole: any) => {
    const previous = queryClient.getQueryData<MemberSummary>(summaryKey)
    if (previous) queryClient.setQueryData(summaryKey, { ...previous, role: newRole })
    const res = await updateUserRole(org?.id, userId, newRole.role_uuid, token as string)
    if (res.status === 200) {
      toast.success(t('dashboard.users.active_users.actions.role_update_success'))
    } else {
      if (previous) queryClient.setQueryData(summaryKey, previous)
      toast.error(detailMessage(res.data?.detail, t('dashboard.users.active_users.actions.role_update_error')))
    }
    await invalidate()
  }

  const toggleGroup = async (group: any, member: boolean) => {
    const res = member
      ? await unLinkUserToUserGroup(group.id, userId, org?.id, token as string)
      : await linkUserToUserGroup(group.id, userId, org?.id, token as string)
    if (res.success) {
      toast.success(t(member ? `${P}.groups.removed` : `${P}.groups.added`, { name, group: group.name }))
    } else {
      toast.error(detailMessage(res.data?.detail, t(`${P}.groups.error`)))
    }
    await invalidate()
  }

  const removeFromOrg = async () => {
    const res = await removeUserFromOrg(org?.id, userId, token as string)
    if (res.status === 200) {
      toast.success(t('dashboard.users.active_users.actions.remove_success'))
      closeUserPanel()
    } else {
      toast.error(detailMessage(res.data?.detail, t('dashboard.users.active_users.actions.remove_error')))
    }
    await invalidate()
  }

  const copy = async (value: string, ok: string) => {
    try {
      await navigator.clipboard.writeText(value)
      toast.success(ok)
    } catch {
      toast.error(t('dashboard.users.dash.members.copy_failed'))
    }
  }

  const messageHref = user?.user_uuid ? getUriWithOrg(params?.orgslug, `/messages?to=${encodeURIComponent(user.user_uuid)}`) : null
  const canMessage = messagingEnabled && !isSelf && !!user?.user_uuid
  const openMessage = async (e?: React.MouseEvent) => {
    if (!messageHref) return
    if (e && (e.metaKey || e.ctrlKey)) return
    e?.preventDefault()
    const orgId = messaging.orgId ?? org?.id
    try {
      const conv = await createConversation({ org_id: orgId, kind: 'dm', user_uuids: [user.user_uuid] }, token as string)
      if (!openInDock(conv.conversation_uuid)) window.location.href = getUriWithOrg(params?.orgslug, `/messages?c=${conv.conversation_uuid}`)
    } catch {
      window.location.href = messageHref
    }
  }

  const askAtlas = () => {
    if (!user) return
    atlas.ask(t(`${P}.atlas.prompt`, { name }), { type: 'user', uuid: user.user_uuid, name })
  }

  const profileUrl = user?.username
    ? new URL(getUriWithOrg(params?.orgslug, `/user/${user.username}`), window.location.origin).toString()
    : null

  const tabs: { key: PanelTab; label: string; badge?: React.ReactNode }[] = PANEL_TABS.map((key) => ({
    key,
    label: t(`${P}.tabs.${key}`),
    badge:
      key === 'learning' && summary && summary.stats.courses_enrolled > 0
        ? summary.stats.courses_enrolled
        : key === 'assignments' && summary && summary.stats.assignments_to_grade > 0
          ? summary.stats.assignments_to_grade
          : undefined,
  }))

  const memberGroupIds = new Set(groups.map((g) => g.id))
  const lastActive = summary?.stats.last_active_at ? formatRelative(summary.stats.last_active_at, i18n.language) : null

  const showMfaOff =
    !!summary && !summary.security.mfa_enabled && (summary.security.org_requires_mfa || roleKind(role?.name) !== 'member')
  const shownGroups = groups.slice(0, 1)
  const moreGroups = groups.length - shownGroups.length

  return (
    <>
      {/* The page behind stays visible and clickable, a touch dimmer. */}
      {wide && <div aria-hidden className="fixed inset-0 bg-neutral-950/[0.035] pointer-events-none" style={{ zIndex: PANEL_Z - 1 }} />}
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="false"
        aria-labelledby="user-panel-name"
        data-user-panel=""
        style={{ zIndex: PANEL_Z, ...(wide ? { width } : {}) }}
        className={`fixed inset-0 bg-[#f8f8f8] flex flex-col outline-none @container ${
          wide
            ? 'start-auto shadow-[0_0_0_1px_rgba(0,0,0,0.06),-24px_0_48px_-24px_rgba(0,0,0,0.18)] rtl:shadow-[0_0_0_1px_rgba(0,0,0,0.06),24px_0_48px_-24px_rgba(0,0,0,0.18)]'
            : ''
        } ${dragging ? '' : 'animate-in fade-in-0 slide-in-from-right-4 rtl:slide-in-from-left-4 duration-200'}`}
      >
        {wide && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={t(`${P}.resize`)}
            aria-valuenow={width}
            aria-valuemin={panelMin}
            aria-valuemax={panelMax}
            tabIndex={0}
            title={t(`${P}.resize_hint`)}
            {...handleProps}
            onKeyDown={onHandleKey}
            className="group/resize absolute inset-y-0 -start-1.5 w-3 cursor-col-resize z-10 flex justify-center focus-visible:outline-none"
          >
            <span
              className={`w-0.5 h-full transition-colors ${
                dragging ? 'bg-sky-500' : 'bg-transparent group-hover/resize:bg-sky-400/70 group-focus-visible/resize:bg-sky-500'
              }`}
            />
          </div>
        )}
      <header className="shrink-0 bg-white border-b border-neutral-100">
        {/* Bar: label, stepping, close */}
        <div className="flex items-center gap-1 h-11 ps-4 sm:ps-5 pe-2">
          <span className="text-xs font-semibold text-neutral-400 me-auto">{t(`${P}.title`)}</span>
          {(found ? found.total !== 1 : memberIds.length > 0 || listQuery != null) && (
            <ToolTip content={stepBlocked ?? ''} side="bottom" unstyled={!stepBlocked}>
              <div className="flex items-center gap-0.5 me-1" data-stepper={found ? 'on' : 'off'}>
                <button
                  type="button"
                  className="h-7 w-7 inline-flex items-center justify-center rounded-lg text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100 disabled:opacity-30 disabled:pointer-events-none"
                  disabled={prev == null}
                  onClick={() => prev != null && openUserPanel(prev)}
                  aria-label={t(`${P}.previous`)}
                  title={stepBlocked ? undefined : `${t(`${P}.previous`)} (K)`}
                >
                  <CaretLeft size={14} className="rtl:rotate-180" />
                </button>
                {found && found.total > 0 && (
                  <span className="text-xs text-neutral-500 tabular-nums px-1">
                    {t(`${P}.position`, { current: found.index + 1, total: found.total })}
                  </span>
                )}
                <button
                  type="button"
                  className="h-7 w-7 inline-flex items-center justify-center rounded-lg text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100 disabled:opacity-30 disabled:pointer-events-none"
                  disabled={next == null}
                  onClick={() => next != null && openUserPanel(next)}
                  aria-label={t(`${P}.next`)}
                  title={stepBlocked ? undefined : `${t(`${P}.next`)} (J)`}
                >
                  <CaretRight size={14} className="rtl:rotate-180" />
                </button>
                {stepBlocked && <span className="sr-only">{stepBlocked}</span>}
              </div>
            </ToolTip>
          )}
          <button
            type="button"
            onClick={closeUserPanel}
            className="h-7 w-7 inline-flex items-center justify-center rounded-lg text-neutral-400 hover:text-neutral-900 hover:bg-neutral-100"
            aria-label={t('common.close')}
            title={`${t('common.close')} (Esc)`}
          >
            <X size={15} weight="bold" />
          </button>
        </div>

        {/* Identity: name + role + the exceptions worth flagging, then one meta line */}
        <div className="px-4 sm:px-5 pb-3 flex items-center gap-3.5">
          <div className="shrink-0">
            {user ? (
              <UserAvatar
                width={48}
                avatar_url={user.avatar_image ? getUserAvatarMediaDirectory(user.user_uuid, user.avatar_image) : undefined}
                predefined_avatar={user.avatar_image ? undefined : 'empty'}
                userId={String(user.id)}
                rounded="rounded-full"
                showProfilePopup={false}
              />
            ) : (
              <Skeleton className="w-12 h-12 rounded-full" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            {user ? (
              <>
                <div className="flex items-center gap-2 min-w-0 flex-wrap">
                  <h2 id="user-panel-name" className="text-lg font-semibold tracking-tight text-neutral-900 truncate leading-tight" dir="auto">
                    {name}
                  </h2>
                  <RolePicker role={role} roles={roles} disabled={!canManage} onPick={setRoleChange} />
                  {!user.email_verified && (
                    <Chip tone="amber" icon={<SealWarning size={11} weight="fill" />} className="!px-2 !py-0.5 !text-[11px]">
                      {t('dashboard.users.analytics.identity.unverified')}
                    </Chip>
                  )}
                  {showMfaOff && (
                    <Chip
                      tone={summary?.security.org_requires_mfa ? 'amber' : 'neutral'}
                      icon={<ShieldSlash size={11} />}
                      className="!px-2 !py-0.5 !text-[11px]"
                      title={summary?.security.org_requires_mfa ? t(`${P}.chips.mfa_required`) : undefined}
                    >
                      {t(`${P}.chips.mfa_off`)}
                    </Chip>
                  )}
                  {summary?.at_risk && <RiskChip reasons={summary.risk_reasons} onTab={setUserPanelTab} />}
                </div>
                <div className="mt-1 flex items-center flex-wrap gap-x-3 @[560px]:gap-x-1.5 gap-y-0.5 text-[13px] text-neutral-500 min-w-0">
                  <span className="truncate" dir="ltr">
                    @{user.username}
                  </span>
                  {user.email && (
                    <>
                      <Dot />
                      <span className="group/email inline-flex items-center gap-0.5 min-w-0">
                        <span className="truncate" dir="ltr">
                          {user.email}
                        </span>
                        <button
                          type="button"
                          onClick={() => copy(user.email, t('dashboard.users.dash.members.email_copied'))}
                          className="h-5 w-0 overflow-hidden inline-flex items-center justify-center rounded text-neutral-400 hover:text-neutral-800 hover:bg-neutral-100 shrink-0 opacity-0 group-hover/email:w-5 group-hover/email:opacity-100 focus-visible:w-5 focus-visible:opacity-100 transition-opacity"
                          aria-label={t('dashboard.users.dash.members.copy_email')}
                          title={t('dashboard.users.dash.members.copy_email')}
                        >
                          <Copy size={12} />
                        </button>
                      </span>
                    </>
                  )}
                  {summary && (
                    <>
                      <Dot />
                      <span className={`inline-flex items-center gap-1 whitespace-nowrap ${lastActive ? '' : 'text-neutral-400'}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${summary.idle_days != null && summary.idle_days <= 7 ? 'bg-emerald-500' : 'bg-neutral-300'}`} />
                        {lastActive ? t(`${P}.chips.active`, { when: lastActive }) : t(`${P}.chips.never_active`)}
                      </span>
                    </>
                  )}
                  {joinedAt && (
                    <>
                      <Dot />
                      <span className="whitespace-nowrap" title={joinedAt}>
                        {t(`${P}.joined`, { date: formatRelative(joinedAt, i18n.language) })}
                      </span>
                    </>
                  )}
                  {shownGroups.map((g) => (
                    <React.Fragment key={g.id}>
                      <Dot />
                      <span className="inline-flex items-center gap-1 max-w-[160px] whitespace-nowrap" title={groups.map((x) => x.name).join(', ')}>
                        <UsersThree size={13} weight="duotone" className="text-sky-600 shrink-0" />
                        <span className="truncate" dir="auto">
                          {g.name}
                        </span>
                        {moreGroups > 0 && <span className="text-neutral-400 tabular-nums">+{moreGroups}</span>}
                      </span>
                    </React.Fragment>
                  ))}
                </div>
              </>
            ) : (
              <div className="space-y-2">
                <Skeleton className="h-5 w-48" />
                <Skeleton className="h-3.5 w-72" />
              </div>
            )}
          </div>
        </div>

        {/* Quick actions: quiet buttons; labels drop to icons in a narrow panel */}
        <div className="px-4 sm:px-5 pb-3 flex flex-wrap items-center gap-1.5">
          {canMessage && messageHref && (
            <ToolTip content={t(`${P}.actions.message_label`, { name })} side="bottom">
              <Link href={messageHref} onClick={openMessage} className={buttonClass('secondary', 'md')} aria-label={t(`${P}.actions.message_label`, { name })}>
                <ChatCircleText size={14} weight="fill" className="text-sky-600" />
                <span className="hidden @[560px]:inline">{t(`${P}.actions.message`)}</span>
              </Link>
            </ToolTip>
          )}
          {canManage && (
            <>
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                  <Button
                    icon={<ShieldStar size={14} className="text-violet-600" />}
                    disabled={!roles?.length}
                    aria-label={t(`${P}.actions.change_role_label`)}
                    title={t(`${P}.actions.change_role_label`)}
                  >
                    <span className="hidden @[560px]:inline">{t(`${P}.actions.change_role`)}</span>
                    <CaretDown size={10} className="opacity-60" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-56 rounded-xl p-1.5">
                  <DropdownMenuLabel className="text-xs font-medium text-neutral-500">{t('dashboard.users.dash.members.change_role')}</DropdownMenuLabel>
                  {(roles ?? []).map((r: any) => {
                    const current = role?.role_uuid ? r.role_uuid === role.role_uuid : r.name === role?.name
                    return (
                      <DropdownMenuItem
                        key={r.id}
                        disabled={current}
                        onSelect={() => !current && setRoleChange(r)}
                        className="flex items-center gap-2 cursor-pointer"
                      >
                        <span className="text-neutral-500">
                          <RoleIcon name={r.name} size={14} />
                        </span>
                        <span className="flex-1 truncate">{r.name}</span>
                        {current && <Check size={14} weight="bold" className="text-neutral-900" />}
                      </DropdownMenuItem>
                    )
                  })}
                </DropdownMenuContent>
              </DropdownMenu>

              <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                  <Button
                    icon={<UsersThree size={14} className="text-sky-600" />}
                    aria-label={t(`${P}.actions.add_to_group_label`)}
                    title={t(`${P}.actions.add_to_group_label`)}
                  >
                    <span className="hidden @[560px]:inline">{t(`${P}.actions.add_to_group`)}</span>
                    <CaretDown size={10} className="opacity-60" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-64 rounded-xl p-1.5 max-h-80 overflow-y-auto">
                  <DropdownMenuLabel className="text-xs font-medium text-neutral-500">{t(`${P}.groups.label`)}</DropdownMenuLabel>
                  {(usergroups ?? []).length === 0 ? (
                    <DropdownMenuItem asChild>
                      <Link href={getUriWithOrg(params?.orgslug, '/dash/users/settings/usergroups')} className="flex items-center gap-2 cursor-pointer text-neutral-500">
                        <Plus size={14} /> {t(`${P}.groups.none`)}
                      </Link>
                    </DropdownMenuItem>
                  ) : (
                    (usergroups ?? []).map((g: any) => {
                      const member = memberGroupIds.has(g.id)
                      return (
                        <DropdownMenuItem
                          key={g.id}
                          onSelect={(e) => {
                            e.preventDefault()
                            if (member) setRemovingGroup(g)
                            else toggleGroup(g, false)
                          }}
                          className="flex items-center gap-2 cursor-pointer"
                        >
                          <span
                            className={`w-4 h-4 rounded-[4px] flex items-center justify-center shrink-0 ${
                              member ? 'bg-neutral-900 text-white' : 'ring-1 ring-inset ring-neutral-300'
                            }`}
                          >
                            {member && <Check size={10} weight="bold" />}
                          </span>
                          <span className="flex-1 truncate" dir="auto">
                            {g.name}
                          </span>
                        </DropdownMenuItem>
                      )
                    })
                  )}
                </DropdownMenuContent>
              </DropdownMenu>

              <ToolTip content={t(`${P}.actions.enroll_label`, { name })} side="bottom">
                <Button
                  icon={<UserPlus size={14} className="text-emerald-600" />}
                  onClick={() => setEnrollOpen(true)}
                  aria-label={t(`${P}.actions.enroll_label`, { name })}
                >
                  <span className="hidden @[560px]:inline">{t(`${P}.actions.enroll`)}</span>
                </Button>
              </ToolTip>
              <SendEmailButton user={user} name={name} />
            </>
          )}
          {user && (
            <MoreMenu
              user={user}
              name={name}
              canManage={canManage}
              canMessage={canMessage}
              onMessage={() => openMessage()}
              analytics={analyticsAvailable}
              atlas={atlasAvailable}
              onAskAtlas={askAtlas}
              onCopyEmail={() => user.email && copy(user.email, t('dashboard.users.dash.members.email_copied'))}
              onCopyProfile={profileUrl ? () => copy(profileUrl, t(`${P}.more.profile_copied`)) : undefined}
              onRemove={() => setRemoving(true)}
            />
          )}
        </div>

        {/* Tabs */}
        <div role="tablist" aria-label={t(`${P}.tabs_label`)} className="flex items-center gap-0.5 px-3 sm:px-4 overflow-x-auto scrollbar-hide">
          {tabs.map((item) => {
            const active = item.key === tab
            return (
              <button
                key={item.key}
                type="button"
                role="tab"
                id={`user-panel-tab-${item.key}`}
                aria-selected={active}
                aria-controls="user-panel-body"
                onClick={() => setUserPanelTab(item.key)}
                className={`relative inline-flex items-center gap-1.5 h-10 px-2 text-[13px] font-medium whitespace-nowrap transition-colors ${
                  active ? 'text-neutral-900' : 'text-neutral-500 hover:text-neutral-800'
                }`}
              >
                <span className={active ? TAB_META[item.key].tone : 'text-neutral-400'}>{TAB_META[item.key].icon}</span>
                {item.label}
                {item.badge !== undefined && (
                  <span
                    className={`min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-semibold tabular-nums inline-flex items-center justify-center ${
                      item.key === 'assignments' ? 'bg-amber-100 text-amber-800' : 'bg-neutral-100 text-neutral-600'
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
                {active && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-neutral-900" />}
              </button>
            )
          })}
        </div>
      </header>

      <div
        ref={scrollRef}
        id="user-panel-body"
        role="tabpanel"
        aria-labelledby={`user-panel-tab-${tab}`}
        className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain p-4 sm:p-5"
      >
        {isError ? (
          <div className="bg-white rounded-2xl nice-shadow px-6 py-10 text-center flex flex-col items-center gap-3">
            <p className="text-sm font-semibold text-neutral-800">{t(`${P}.load_error`)}</p>
            <Button size="sm" onClick={() => refetch()}>
              {t(`${P}.retry`)}
            </Button>
          </div>
        ) : tab === 'overview' ? (
          <OverviewTab userId={userId} summary={summary} canManage={canManage} onTab={setUserPanelTab} />
        ) : tab === 'learning' ? (
          <LearningTab userId={userId} name={name} summary={summary} canManage={canManage} analytics={analyticsAvailable} onEnroll={() => setEnrollOpen(true)} />
        ) : tab === 'assignments' ? (
          <AssignmentsTab userId={userId} />
        ) : tab === 'activity' ? (
          <ActivityTab userId={userId} userUuid={user?.user_uuid} name={name} auditLog={auditLog} />
        ) : tab === 'analytics' ? (
          <AnalyticsTab userId={userId} available={analyticsAvailable} editionOnly={!analyticsEdition} />
        ) : (
          <SecurityTab
            userId={userId}
            summary={summary}
            isAdminRole={!!canManageOrg}
            canManage={canManage}
            onRemoveGroup={setRemovingGroup}
          />
        )}
      </div>

      <ConfirmDialog
        open={!!roleChange}
        onOpenChange={(o) => !o && setRoleChange(null)}
        tone="info"
        title={t('dashboard.users.dash.members.role_confirm_title')}
        message={roleChange ? t('dashboard.users.dash.members.role_confirm_message', { name, from: role?.name, to: roleChange.name }) : ''}
        confirmLabel={t('dashboard.users.dash.members.role_confirm_button')}
        onConfirm={() => {
          const r = roleChange
          setRoleChange(null)
          if (r) applyRole(r)
        }}
      />
      <ConfirmDialog
        open={!!removingGroup}
        onOpenChange={(o) => !o && setRemovingGroup(null)}
        title={t(`${P}.groups.remove_title`)}
        message={removingGroup ? t(`${P}.groups.remove_message`, { name, group: removingGroup.name }) : ''}
        confirmLabel={t(`${P}.groups.remove_button`)}
        onConfirm={async () => {
          if (removingGroup) await toggleGroup(removingGroup, true)
        }}
      />
      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title={t(`${P}.remove.title`, { name })}
        message={
          <div className="space-y-2">
            <p>{t(`${P}.remove.lose`, { name })}</p>
            <p className="text-neutral-500">{t(`${P}.remove.keep`)}</p>
          </div>
        }
        confirmLabel={t(`${P}.remove.button`)}
        onConfirm={removeFromOrg}
      />
      {canManage && (
        <EnrollDialog
          open={enrollOpen}
          onOpenChange={setEnrollOpen}
          userId={userId}
          name={name}
          enrolled={new Set((summary?.courses ?? []).map((c) => c.course_uuid))}
        />
      )}
      </div>
    </>
  )
}

/** Meta-line separator; dropped in a narrow panel, where the line wraps. */
function Dot() {
  return (
    <span aria-hidden className="hidden @[560px]:inline text-neutral-300">
      ·
    </span>
  )
}

function MoreMenu({
  user,
  name,
  canManage,
  canMessage,
  onMessage,
  analytics,
  atlas,
  onAskAtlas,
  onCopyEmail,
  onCopyProfile,
  onRemove,
}: {
  user: any
  name: string
  canManage: boolean
  canMessage: boolean
  onMessage: () => void
  analytics: boolean
  atlas: boolean
  onAskAtlas: () => void
  onCopyEmail: () => void
  onCopyProfile?: () => void
  onRemove: () => void
}) {
  const { t } = useTranslation()
  const params = useParams() as any
  const exporter = useAuditExport({ userIds: [user.id] })
  const ITEM = 'flex items-center gap-2 cursor-pointer'
  const runExport = (fmt: 'pdf' | 'csv' | 'json') =>
    exporter.run(fmt).then(
      () => toast.success(t(`${P}.more.export_done`)),
      () => toast.error(t(`${P}.more.export_error`))
    )

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button size="md" className="!px-2" aria-label={t(`${P}.more.label`)} title={t(`${P}.more.label`)}>
          <DotsThree size={16} weight="bold" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64 rounded-xl p-1.5">
        {canMessage && (
          <DropdownMenuItem onSelect={onMessage} className={ITEM}>
            <ChatCircleText size={15} className="text-sky-600" /> {t(`${P}.more.message`, { name })}
          </DropdownMenuItem>
        )}
        {atlas && (
          <DropdownMenuItem onSelect={onAskAtlas} className={ITEM}>
            <AIMark size={15} alt="" className="rounded-[4px]" /> {t(`${P}.more.ask_atlas`)}
          </DropdownMenuItem>
        )}
        {analytics && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className={ITEM} disabled={exporter.busy}>
              <DownloadSimple size={15} className="text-emerald-600" /> {t(`${P}.more.export`)}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-44 rounded-xl p-1.5">
              {(['pdf', 'csv', 'json'] as const).map((fmt) => (
                <DropdownMenuItem key={fmt} onSelect={() => runExport(fmt)} className={ITEM}>
                  <span className="w-9 text-[10px] font-bold uppercase tracking-wide text-neutral-500">{fmt}</span>
                  {t(`${P}.more.export_${fmt}`)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}
        {analytics && (
          <DropdownMenuItem asChild>
            <Link href={getUriWithOrg(params?.orgslug, '') + `/dash/users/analytics/${user.id}`} className={ITEM}>
              <ArrowSquareOut size={15} className="text-neutral-500" /> {t('dashboard.users.analytics.open_full_page')}
            </Link>
          </DropdownMenuItem>
        )}
        {(canMessage || atlas || analytics) && <DropdownMenuSeparator />}
        {user.email && (
          <DropdownMenuItem onSelect={onCopyEmail} className={ITEM}>
            <Copy size={15} className="text-neutral-500" /> {t('dashboard.users.dash.members.copy_email')}
          </DropdownMenuItem>
        )}
        {onCopyProfile && (
          <DropdownMenuItem onSelect={onCopyProfile} className={ITEM}>
            <LinkSimple size={15} className="text-neutral-500" /> {t(`${P}.more.copy_profile`)}
          </DropdownMenuItem>
        )}
        {canManage && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onRemove} className={`${ITEM} text-rose-600 focus:text-rose-700 focus:bg-rose-50`}>
              <SignOut size={15} /> {t('dashboard.users.active_users.actions.remove_from_org')}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function EnrollDialog({
  open,
  onOpenChange,
  userId,
  name,
  enrolled,
}: {
  open: boolean
  onOpenChange: (_o: boolean) => void
  userId: number
  name: string
  enrolled: Set<string>
}) {
  const { t } = useTranslation()
  const org = useOrg() as any
  const session = useLHSession() as any
  const token = session?.data?.tokens?.access_token
  const invalidate = useInvalidateMember()
  const [query, setQuery] = useState('')
  const [pending, setPending] = useState<string | null>(null)
  const [justEnrolled, setJustEnrolled] = useState<Set<string>>(new Set())

  const { data: courses, isLoading } = useQuery({
    queryKey: queryKeys.courses.dashAll(org?.slug),
    queryFn: () => getAllOrgCourses(org.slug, token),
    enabled: open && !!org?.slug && !!token,
    staleTime: 60_000,
  })

  const list = useMemo(() => {
    const q = query.trim().toLowerCase()
    return asArray<any>(courses)
      .filter((c) => !enrolled.has(c.course_uuid) || justEnrolled.has(c.course_uuid))
      .filter((c) => !q || String(c.name || '').toLowerCase().includes(q))
  }, [courses, enrolled, justEnrolled, query])

  const enroll = async (course: any) => {
      setPending(course.course_uuid)
      const res = await enrollMemberInCourse(org.id, userId, course.course_uuid, token)
      setPending(null)
      if (res.success) {
        setJustEnrolled((prev) => new Set(prev).add(course.course_uuid))
        toast.success(t(`${P}.enroll.done`, { name, course: course.name }))
        invalidate()
      } else {
        toast.error(detailMessage(res.data?.detail, t(`${P}.enroll.error`)))
      }
  }

  return (
    <Modal
      isDialogOpen={open}
      onOpenChange={(o) => {
        onOpenChange(o)
        if (!o) {
          setQuery('')
          setJustEnrolled(new Set())
        }
      }}
      size="md"
      icon={<UserPlus size={16} />}
      dialogTitle={t(`${P}.enroll.title`, { name })}
      dialogDescription={t(`${P}.enroll.description`)}
      dialogContent={
        <div className="flex flex-col gap-3">
          <div className="relative">
            <MagnifyingGlass size={14} className="absolute start-3 top-1/2 -translate-y-1/2 text-neutral-400" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t(`${P}.enroll.search`)}
              aria-label={t(`${P}.enroll.search`)}
              className={`${INPUT} ps-8 w-full`}
            />
          </div>
          <div className="max-h-[50vh] overflow-y-auto -mx-1 px-1">
            {isLoading ? (
              <div className="space-y-2">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-12 w-full rounded-xl" />
                ))}
              </div>
            ) : list.length === 0 ? (
              <p className="text-sm text-neutral-500 text-center py-8">{query ? t(`${P}.enroll.no_match`) : t(`${P}.enroll.all_enrolled`, { name })}</p>
            ) : (
              <ul className="divide-y divide-neutral-100 rounded-xl ring-1 ring-neutral-200/70 overflow-hidden">
                {list.map((c) => {
                  const done = justEnrolled.has(c.course_uuid)
                  return (
                    <li key={c.course_uuid} className="flex items-center gap-3 px-3 py-2.5 bg-white">
                      <span className="w-8 h-8 rounded-[10px] bg-sky-50 text-sky-600 flex items-center justify-center shrink-0">
                        <BookOpen size={15} weight="duotone" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-neutral-900 truncate" dir="auto">
                          {c.name}
                        </p>
                        {!c.published && <p className="text-[11px] text-neutral-400">{t(`${P}.learning.draft`)}</p>}
                      </div>
                      {done ? (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
                          <Check size={13} weight="bold" /> {t(`${P}.enroll.enrolled`)}
                        </span>
                      ) : (
                        <Button size="sm" loading={pending === c.course_uuid} disabled={!!pending} onClick={() => enroll(c)}>
                          {t(`${P}.enroll.button`)}
                        </Button>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>
      }
    />
  )
}
