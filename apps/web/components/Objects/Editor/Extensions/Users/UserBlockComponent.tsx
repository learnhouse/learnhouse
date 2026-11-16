'use client'
import { NodeViewWrapper } from '@tiptap/react'
import React from 'react'
import Link from 'next/link'
import { ArrowSquareOut, ArrowsClockwise, IdentificationCard, Rows, SquaresFour, User, UserSwitch, WarningCircle } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useEditorProvider } from '@components/Contexts/Editor/EditorContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { getUser } from '@services/users/users'
import { getUriWithOrg } from '@services/config/config'
import UserAvatar from '@components/Objects/UserAvatar'
import { DetailIcon } from '@components/Objects/Profile/profileIcons'
import { normalizeDetails, normalizeProfile, visibleDetails } from '@/lib/profile/profile'
import { buttonClass } from '@components/Dashboard/Shared/DashKit/buttons'
import { cn } from '@/lib/utils'
import EditorBlockFrame from '../../Blocks/ui/EditorBlockFrame'
import { BlockPopover, BlockToolbarButton, BlockToolbarDivider } from '../../Blocks/ui/BlockChrome'
import MemberPicker, { avatarSrc } from './MemberPicker'
import { displayName, userCardLayoutOf, userIdOf, type UserCardLayout } from './userCard'

type UserData = {
  id: number
  user_uuid: string
  first_name: string
  last_name: string
  username: string
  bio?: string
  avatar_image?: string
  details?: unknown
  profile?: unknown
}

type LoadState = { status: 'idle' } | { status: 'loading' } | { status: 'ok'; user: UserData } | { status: 'missing' } | { status: 'error' }

// One fetch per member per page: node views remount on undo, drag and
// collab updates, and a lesson can show the same person twice.
const userCache = new Map<string, Promise<UserData>>()

function useMember(userId: string | null, token: string | undefined, nonce = 0): LoadState {
  const [state, setState] = React.useState<LoadState>({ status: userId ? 'loading' : 'idle' })
  React.useEffect(() => {
    if (!userId) {
      setState({ status: 'idle' })
      return
    }
    if (!token) {
      // Anonymous visitors can't read member profiles (the API refuses to,
      // against enumeration); the learner view simply leaves the card out.
      setState({ status: 'error' })
      return
    }
    let cancelled = false
    setState({ status: 'loading' })
    let request = userCache.get(userId)
    if (!request) {
      request = getUser(userId, token) as Promise<UserData>
      userCache.set(userId, request)
    }
    request
      .then((user) => {
        if (cancelled) return
        if (!user || typeof user !== 'object' || !(user as any).id) setState({ status: 'missing' })
        else setState({ status: 'ok', user })
      })
      .catch((err: any) => {
        userCache.delete(userId)
        if (!cancelled) setState({ status: err?.status === 404 || err?.status === 400 ? 'missing' : 'error' })
      })
    return () => {
      cancelled = true
    }
  }, [userId, token, nonce])
  return state
}

/**
 The card, in the block's original look: a soft grey panel for learners, a
 white card inside the editor's grey "User profile" panel. Same markup
 either way; `surface` picks the fill.
*/
function MemberCard({ user, layout, orgslug, editing, surface = 'grey' }: { user: UserData; layout: UserCardLayout; orgslug?: string; editing?: boolean; surface?: 'grey' | 'white' }) {
  const { t } = useTranslation()
  const name = displayName(user)
  const { doc, details } = React.useMemo(() => {
    const doc = normalizeProfile(user.profile, user.details)
    const shown = doc.sections.some((s) => s.type === 'details' && !s.hidden) || !user.profile
    return { doc, details: shown ? visibleDetails(normalizeDetails(user.details)).slice(0, 6) : [] }
  }, [user])
  const href = user.username ? getUriWithOrg(orgslug || '', `/user/${user.username}`) : null
  const avatar = (size: number) => (
    <UserAvatar
      width={size}
      avatar_url={avatarSrc(user.user_uuid, user.avatar_image || '')}
      predefined_avatar={user.avatar_image ? undefined : 'empty'}
      userId={String(user.id)}
      showProfilePopup={!editing}
      rounded="rounded-full"
    />
  )
  // In the editor a click must select the block, not leave the page.
  const linkProps = editing ? { tabIndex: -1, onClick: (e: React.MouseEvent) => e.preventDefault() } : {}
  const fill = surface === 'white' ? 'bg-white rounded-lg' : 'bg-neutral-50 rounded-xl'
  const handle = user.username ? (
    <span className="max-w-full truncate rounded-md border border-neutral-200 px-2 py-0.5 text-xs font-normal text-neutral-500"><bdi dir="ltr">@{user.username}</bdi></span>
  ) : null
  const openLink = href ? (
    <Link
      href={href}
      {...linkProps}
      aria-label={t('user.profile.view_profile', { defaultValue: 'View profile' })}
      title={t('user.profile.view_profile', { defaultValue: 'View profile' })}
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md !text-neutral-500 !no-underline transition-colors hover:bg-neutral-100 hover:!text-neutral-700"
    >
      <ArrowSquareOut weight="duotone" size={16} />
    </Link>
  ) : null

  if (layout === 'compact') {
    return (
      <div className={cn('inline-flex max-w-full items-center gap-3 py-2.5 ps-2.5 pe-2 nice-shadow', fill)}>
        <span className="shrink-0">{avatar(40)}</span>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate font-semibold leading-tight text-neutral-900" dir="auto">{name}</span>
          <span className="truncate text-xs text-neutral-500">
            {doc.headline.trim() ? <span dir="auto">{doc.headline.trim()}</span> : <bdi dir="ltr">@{user.username}</bdi>}
          </span>
        </span>
        {openLink}
      </div>
    )
  }

  return (
    <div className={cn('overflow-hidden nice-shadow', fill)}>
      <div className="p-5">
        <div className="flex items-start gap-4">
          <span className="shrink-0">{avatar(72)}</span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="truncate text-base font-semibold text-neutral-900" dir="auto">
                  {name}
                  {doc.pronouns.trim() && <span className="ms-1.5 text-xs font-normal text-neutral-400">({doc.pronouns.trim()})</span>}
                </span>
                {handle}
              </div>
              {openLink}
            </div>
            {doc.headline.trim() && <p className="mt-1 text-sm font-medium text-neutral-700" dir="auto">{doc.headline.trim()}</p>}
            {user.bio && <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-neutral-600" dir="auto">{user.bio}</p>}
          </div>
        </div>
      </div>
      {details.length > 0 && (
        <ul className="!m-0 list-none space-y-2.5 border-t border-neutral-100 !px-5 pb-4 pt-3">
          {details.map((d) => (
            <li key={d.id} className="!m-0 flex min-w-0 items-center gap-2.5">
              <DetailIcon name={d.icon} size={16} className="shrink-0 text-neutral-500" />
              <span className="flex min-w-0 flex-col">
                {d.label && <span className="text-xs text-neutral-500" dir="auto">{d.label}</span>}
                <span className="truncate text-sm text-neutral-700" dir="auto">{d.text}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function CardSkeleton({ layout, surface = 'grey' }: { layout: UserCardLayout; surface?: 'grey' | 'white' }) {
  return (
    <div aria-busy="true" className={cn('flex items-center gap-4 nice-shadow', surface === 'white' ? 'rounded-lg bg-white' : 'rounded-xl bg-neutral-50', layout === 'compact' ? 'inline-flex w-64 p-2.5' : 'p-5')}>
      <span className={cn('shrink-0 animate-pulse rounded-full bg-neutral-200/70', layout === 'compact' ? 'h-10 w-10' : 'h-[72px] w-[72px]')} />
      <span className="flex flex-1 flex-col gap-2">
        <span className="h-3.5 w-32 animate-pulse rounded bg-neutral-200/70" />
        <span className="h-3 w-20 animate-pulse rounded bg-neutral-200/70" />
      </span>
    </div>
  )
}

function UserBlockComponent(props: any) {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const token: string | undefined = session?.data?.tokens?.access_token
  const editorState = useEditorProvider() as any
  const isEditable = !!editorState?.isEditable
  const org = useOrg() as any

  const userId = userIdOf(props.node.attrs.user_id)
  const layout = userCardLayoutOf(props.node.attrs.layout)
  const [nonce, setNonce] = React.useState(0)
  const state = useMember(userId, token, nonce)
  const [changeOpen, setChangeOpen] = React.useState(false)
  // The error panel swaps its message for an inline picker.
  const [picking, setPicking] = React.useState(false)

  // ─── Learner ───
  if (!isEditable) {
    // Nothing chosen, a member who left, or a visitor who can't see profiles:
    // leave the lesson as it reads without the card (never an error box).
    if (state.status === 'idle' || state.status === 'missing' || state.status === 'error') return <NodeViewWrapper className="block-user" />
    return (
      <NodeViewWrapper className="block-user">
        {state.status === 'loading' ? <CardSkeleton layout={layout} /> : <MemberCard user={state.user} layout={layout} orgslug={org?.slug} />}
      </NodeViewWrapper>
    )
  }

  // ─── Editor ───
  // One write: the id (number, as the picker always stored it) and nothing else.
  const pick = (id: number) => {
    props.updateAttributes({ user_id: id })
    setChangeOpen(false)
    setPicking(false)
  }

  const label = <><IdentificationCard size={11} weight="bold" />{t('editor.blocks.user', 'User')}</>

  const picker = (autoFocus?: boolean) => (
    <MemberPicker orgId={org?.id} accessToken={token} autoFocus={autoFocus} currentId={userId} onPick={(m) => pick(m.id)} />
  )

  const tools = userId ? (
    <>
      <BlockPopover
        open={changeOpen}
        onOpenChange={setChangeOpen}
        width={320}
        title={t('editor.blocks_v2.user.change', 'Change member')}
        trigger={<BlockToolbarButton label={t('editor.blocks_v2.user.change', 'Change member')}><UserSwitch size={14} /></BlockToolbarButton>}
      >
        {picker(true)}
      </BlockPopover>
      <BlockToolbarDivider />
      <BlockToolbarButton label={t('editor.blocks_v2.user.layout_card', 'Card')} active={layout === 'card'} onClick={() => layout !== 'card' && props.updateAttributes({ layout: 'card' })}>
        <SquaresFour size={14} />
      </BlockToolbarButton>
      <BlockToolbarButton label={t('editor.blocks_v2.user.layout_compact', 'Compact')} active={layout === 'compact'} onClick={() => layout !== 'compact' && props.updateAttributes({ layout: 'compact' })}>
        <Rows size={14} />
      </BlockToolbarButton>
    </>
  ) : undefined

  let body: React.ReactNode
  if (!userId || picking) {
    body = (
      <div className="rounded-lg bg-white p-4 nice-shadow">
        {!userId && <p className="mb-3 text-sm text-neutral-500">{t('editor.blocks_v2.user.subtitle', 'An instructor, a guest or a teammate. Learners see their name, photo and bio.')}</p>}
        {picker(!!picking)}
      </div>
    )
  } else if (state.status === 'loading' || state.status === 'idle') {
    body = <CardSkeleton layout={layout} surface="white" />
  } else if (state.status === 'ok') {
    body = <MemberCard user={state.user} layout={layout} orgslug={org?.slug} editing surface="white" />
  } else {
    body = (
      <div className="flex flex-col gap-3 rounded-lg bg-white p-4 nice-shadow sm:flex-row sm:items-center">
        <WarningCircle size={20} weight="fill" className="shrink-0 text-amber-500" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-neutral-800">
            {state.status === 'missing' ? t('editor.blocks_v2.user.missing', 'This member can’t be found') : t('editor.blocks_v2.user.load_failed', 'Couldn’t load this member')}
          </div>
          <div className="text-xs text-neutral-500">
            {state.status === 'missing'
              ? t('editor.blocks_v2.user.missing_hint', 'They may have left the organization. Learners won’t see this card until you pick someone else.')
              : t('editor.blocks_v2.user.load_failed_hint', 'Check your connection and try again.')}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {state.status === 'error' && (
            <button type="button" className={buttonClass('ghost', 'sm')} onClick={() => setNonce((n) => n + 1)}>
              <ArrowsClockwise size={13} /> {t('editor.blocks_v2.retry', 'Retry')}
            </button>
          )}
          <button type="button" className={buttonClass('secondary', 'sm')} onClick={() => setPicking(true)}>
            <UserSwitch size={13} /> {t('editor.blocks_v2.choose_another', 'Choose another')}
          </button>
        </div>
      </div>
    )
  }

  // The original grey panel with its uppercase header, now with the tools.
  body = (
    <div data-lhb-panel="" className="rounded-xl bg-neutral-50 px-5 py-4 nice-shadow transition-all ease-linear">
      <div className="mb-3 flex items-center gap-2">
        <User weight="duotone" className="text-neutral-400" size={16} />
        <span className="text-[12px] font-semibold text-neutral-500">
          {userId ? t('editor.blocks.user_block.user_profile', 'User profile') : t('editor.blocks.user', 'User')}
        </span>
      </div>
      {body}
    </div>
  )

  return (
    <NodeViewWrapper className="block-user">
      <EditorBlockFrame
        editable
        node={props.node}
        editor={props.editor}
        getPos={props.getPos}
        selected={props.selected}
        tone="people"
        label={label}
        tools={tools}
        forceToolbar={changeOpen}
      >
        {body}
      </EditorBlockFrame>
    </NodeViewWrapper>
  )
}

export default UserBlockComponent
