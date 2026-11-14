'use client'
/*
 Searchable member picker for the User card block.

 Lists the organization's members (GET /orgs/{id}/users, which any member may
 call) as you type, with avatar, name, @username and role. Arrow keys move,
 Enter picks, Escape closes. If the listing isn't available (older API or no
 org context), Enter falls back to an exact username lookup, which is what the
 block used to offer.

 Purely transient UI: the only thing it writes is the chosen id, through
 onPick, once.
*/
import React from 'react'
import { CircleNotch, MagnifyingGlass, UserCircle, WarningCircle } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { getAPIUrl } from '@services/config/config'
import { apiFetch } from '@services/utils/ts/requests'
import { getUserByUsername } from '@services/users/users'
import UserAvatar from '@components/Objects/UserAvatar'
import { getUserAvatarMediaDirectory } from '@services/media/media'
import { cn } from '@/lib/utils'
import { FIELD_CLASS } from '../../Blocks/ui/BlockChrome'
import { displayName, memberOptionsFrom, type MemberOption } from './userCard'

interface Props {
  orgId?: number | null
  accessToken?: string
  onPick: (_member: MemberOption) => void
  autoFocus?: boolean
  /** Hide this id from the list (the member already on the card). */
  currentId?: string | null
}

export function avatarSrc(user_uuid: string, avatar_image: string) {
  return avatar_image ? getUserAvatarMediaDirectory(user_uuid, avatar_image) : ''
}

export default function MemberPicker({ orgId, accessToken, onPick, autoFocus, currentId }: Props) {
  const { t } = useTranslation()
  const [query, setQuery] = React.useState('')
  const [options, setOptions] = React.useState<MemberOption[]>([])
  const [loading, setLoading] = React.useState(false)
  const [listUnavailable, setListUnavailable] = React.useState(!orgId)
  const [error, setError] = React.useState<string | null>(null)
  const [active, setActive] = React.useState(0)
  const listId = React.useId()

  // Debounced search. Empty query lists the newest members, so the picker is
  // useful before anyone types.
  React.useEffect(() => {
    if (!orgId || !accessToken) {
      setListUnavailable(true)
      return
    }
    let cancelled = false
    setLoading(true)
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ page: '1', limit: '8', sort_order: 'desc' })
        if (query.trim()) params.set('search', query.trim())
        const data = await apiFetch(`${getAPIUrl()}orgs/${orgId}/users?${params}`, accessToken)
        if (cancelled) return
        setOptions(memberOptionsFrom(data).filter((m) => String(m.id) !== currentId))
        setListUnavailable(false)
        setActive(0)
      } catch {
        if (!cancelled) setListUnavailable(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, query ? 250 : 0)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query, orgId, accessToken, currentId])

  const lookupUsername = async () => {
    const name = query.trim().replace(/^@/, '')
    if (!name || !accessToken) return
    setLoading(true)
    setError(null)
    try {
      const u: any = await getUserByUsername(name, accessToken)
      if (!u?.id) throw new Error('not found')
      onPick({ id: u.id, user_uuid: u.user_uuid || '', username: u.username || name, name: displayName(u), avatar_image: u.avatar_image || '', role: '' })
    } catch {
      setError(t('editor.blocks_v2.user.not_found', 'No member with that username.'))
    } finally {
      setLoading(false)
    }
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Keep ProseMirror from seeing the keys typed into the field.
    e.stopPropagation()
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => Math.min(options.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(0, i - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (!listUnavailable && options[active]) onPick(options[active])
      else lookupUsername()
    } else if (e.key === 'Escape') {
      ;(e.target as HTMLInputElement).blur()
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <MagnifyingGlass size={14} className="pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2 text-neutral-400" />
        <input
          autoFocus={autoFocus}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setError(null)
          }}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded={!listUnavailable}
          aria-controls={listId}
          aria-activedescendant={options[active] ? `${listId}-${options[active].id}` : undefined}
          aria-label={t('editor.blocks_v2.user.search_label', 'Search members')}
          placeholder={
            listUnavailable
              ? t('editor.blocks.user_block.enter_username', 'Enter username')
              : t('editor.blocks_v2.user.search_placeholder', 'Search members by name or username…')
          }
          className={cn(FIELD_CLASS, 'ps-8 pe-8')}
        />
        {loading && <CircleNotch size={14} className="absolute end-2.5 top-1/2 -translate-y-1/2 animate-spin text-neutral-400" />}
      </div>

      {error && (
        <p role="alert" className="flex items-center gap-1.5 text-xs text-rose-600">
          <WarningCircle size={13} weight="fill" /> {error}
        </p>
      )}

      {listUnavailable ? (
        <p className="text-[11px] text-neutral-400">{t('editor.blocks_v2.user.username_hint', 'Press Enter to look up this username.')}</p>
      ) : (
        <ul id={listId} role="listbox" className="!m-0 flex max-h-64 list-none flex-col gap-0.5 overflow-y-auto !p-0">
          {options.map((m, i) => (
            <li
              key={m.id}
              id={`${listId}-${m.id}`}
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onPick(m)}
              className={cn(
                '!m-0 flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors',
                i === active ? 'bg-indigo-50/70' : 'hover:bg-neutral-50',
              )}
            >
              <UserAvatar width={28} avatar_url={avatarSrc(m.user_uuid, m.avatar_image)} predefined_avatar={m.avatar_image ? undefined : 'empty'} rounded="rounded-full" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[13px] font-medium text-neutral-800" dir="auto">{m.name}</span>
                <span className="truncate text-[11px] text-neutral-400"><bdi dir="ltr">@{m.username}</bdi></span>
              </span>
              {m.role && (
                <span className="shrink-0 rounded-md bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium text-neutral-500">{m.role}</span>
              )}
            </li>
          ))}
          {!loading && options.length === 0 && (
            <li className="!m-0 flex items-center gap-2 px-2 py-3 text-xs text-neutral-400">
              <UserCircle size={16} /> {t('editor.blocks_v2.user.no_results', 'No members match.')}
            </li>
          )}
        </ul>
      )}
    </div>
  )
}
