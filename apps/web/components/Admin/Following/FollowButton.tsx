'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as PopoverPrimitive from '@radix-ui/react-popover'
import toast from 'react-hot-toast'
import { Bell, Eye, EyeSlash, EnvelopeSimple, Hash } from '@phosphor-icons/react'
import { Button, Chip, type ChipTone } from '@/design'
import { errorMessage } from '@services/ee/platform/api'
import {
  FOLLOW_KEYS_ALL,
  FOLLOW_KEYS_IMPORTANT,
  followOrg,
  listFollows,
  opsKeys,
  unfollowOrg,
  type Follow,
  type FollowLevel,
} from '@services/ee/platform/ops'
import { shouldRetry, useAccessToken, usePlatformMe } from '@components/Admin/hooks'
import { Switch } from '@components/Admin/Shared/AdminKit'
import { useChannelList } from '@components/Admin/Shared/OpsKit'

// Follow an org (§9.4): a button with a level picker (All / Important /
// Custom events) and where to deliver (inbox, email, a shared channel). One
// cached GET /follows answers "do I follow this?" for every button on a page.

export const LEVEL_TONE: Record<string, ChipTone> = { all: 'sky', important: 'amber', custom: 'violet' }

export function LevelChip({ level }: { level?: string | null }) {
  const { t } = useTranslation()
  if (!level) return null
  return <Chip tone={LEVEL_TONE[level] ?? 'neutral'}>{t(`admin.following.level.${level}`, { defaultValue: level })}</Chip>
}

export function useFollows(enabled = true) {
  const token = useAccessToken()
  const me = usePlatformMe()
  const q = useQuery({
    queryKey: opsKeys.follows(),
    queryFn: () => listFollows(token),
    enabled: !!token && enabled && me.can('platform.read'),
    retry: shouldRetry,
    staleTime: 60_000,
  })
  const follows: Follow[] = Array.isArray(q.data) ? q.data : []
  return { ...q, follows, byOrg: (orgId: number | string) => follows.find((f) => String(f.org_id) === String(orgId)) }
}

interface Draft {
  level: FollowLevel
  event_types: string[]
  deliver_inbox: boolean
  deliver_email: boolean
  channel_uuid: string
}

function toDraft(f?: Follow): Draft {
  return {
    level: (f?.level as FollowLevel) || 'important',
    event_types: Array.isArray(f?.event_types) ? f!.event_types : [],
    deliver_inbox: f ? !!f.deliver_inbox : true,
    deliver_email: f ? !!f.deliver_email : false,
    channel_uuid: f?.channel_uuid ?? '',
  }
}

/** The level + delivery form, shared by the popover and the Following page. */
export function FollowForm({ orgId, follow, onDone }: { orgId: number | string; follow?: Follow; onDone?: () => void }) {
  const { t } = useTranslation()
  const token = useAccessToken()
  const me = usePlatformMe()
  const qc = useQueryClient()
  const channels = useChannelList()
  const [draft, setDraft] = React.useState<Draft>(() => toDraft(follow))
  const [busy, setBusy] = React.useState<'save' | 'unfollow' | null>(null)
  React.useEffect(() => setDraft(toDraft(follow)), [follow])
  const patch = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }))
  const refresh = () => {
    qc.invalidateQueries({ queryKey: opsKeys.follows() })
    qc.invalidateQueries({ queryKey: opsKeys.followers(orgId) })
  }

  const save = async () => {
    if (draft.level === 'custom' && draft.event_types.length === 0) {
      toast.error(t('admin.following.pick_events'))
      return
    }
    setBusy('save')
    try {
      await followOrg(token, orgId, {
        level: draft.level,
        event_types: draft.level === 'custom' ? draft.event_types : undefined,
        deliver_inbox: draft.deliver_inbox,
        deliver_email: draft.deliver_email,
        channel_uuid: me.can('notifications.manage') ? draft.channel_uuid || null : undefined,
      })
      toast.success(follow ? t('admin.following.updated') : t('admin.following.followed'))
      refresh()
      onDone?.()
    } catch (err) {
      toast.error(errorMessage(err, t('admin.common.error_desc')))
    } finally {
      setBusy(null)
    }
  }
  const unfollow = async () => {
    setBusy('unfollow')
    try {
      await unfollowOrg(token, orgId)
      toast.success(t('admin.following.unfollowed'))
      refresh()
      onDone?.()
    } catch (err) {
      toast.error(errorMessage(err, t('admin.common.error_desc')))
    } finally {
      setBusy(null)
    }
  }
  const toggleKey = (k: string) =>
    patch({ event_types: draft.event_types.includes(k) ? draft.event_types.filter((x) => x !== k) : [...draft.event_types, k] })

  return (
    <div className="space-y-3.5">
      <div role="radiogroup" aria-label={t('admin.following.level_label')} className="space-y-1">
        {(['all', 'important', 'custom'] as const).map((lvl) => (
          <label key={lvl} className={`flex items-start gap-2.5 rounded-lg px-2.5 py-2 cursor-pointer ${draft.level === lvl ? 'bg-neutral-100' : 'hover:bg-neutral-50'}`}>
            <input type="radio" name={`follow-level-${orgId}`} className="mt-0.5 accent-neutral-900" checked={draft.level === lvl} onChange={() => patch({ level: lvl })} />
            <span className="min-w-0">
              <span className="block text-[13px] font-semibold text-neutral-900">{t(`admin.following.level.${lvl}`)}</span>
              <span className="block text-xs text-neutral-500">{t(`admin.following.level_desc.${lvl}`)}</span>
            </span>
          </label>
        ))}
      </div>
      {draft.level === 'custom' && (
        <div className="max-h-48 overflow-y-auto rounded-lg ring-1 ring-inset ring-neutral-200 p-2 space-y-2">
          {[
            { key: 'important', keys: FOLLOW_KEYS_IMPORTANT },
            { key: 'all', keys: FOLLOW_KEYS_ALL },
          ].map((g) => (
            <div key={g.key}>
              <p className="px-1 pb-1 text-[11px] font-semibold text-neutral-400">{t(`admin.following.group.${g.key}`)}</p>
              <div className="flex flex-wrap gap-1">
                {g.keys.map((k) => {
                  const on = draft.event_types.includes(k)
                  return (
                    <button
                      key={k}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggleKey(k)}
                      className={`h-7 px-2.5 rounded-full text-xs font-medium transition-colors ${on ? 'bg-neutral-900 text-white' : 'bg-neutral-100 text-neutral-600 hover:text-neutral-900'}`}
                    >
                      {t(`admin.following.keys.${k}`)}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="space-y-2 border-t border-neutral-100 pt-3">
        <p className="text-[11px] font-semibold text-neutral-400">{t('admin.following.deliver_to')}</p>
        <div className="flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-2 text-[13px] text-neutral-700">
            <Bell size={14} className="text-rose-600" />
            {t('admin.following.inbox')}
          </span>
          <Switch checked={draft.deliver_inbox} onChange={(v) => patch({ deliver_inbox: v })} label={t('admin.following.inbox')} />
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-2 text-[13px] text-neutral-700">
            <EnvelopeSimple size={14} className="text-sky-600" />
            {t('admin.following.email')}
          </span>
          <Switch checked={draft.deliver_email} onChange={(v) => patch({ deliver_email: v })} label={t('admin.following.email')} />
        </div>
        {me.can('notifications.manage') && (
          <label className="flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-2 text-[13px] text-neutral-700 shrink-0">
              <Hash size={14} className="text-violet-600" />
              {t('admin.following.channel')}
            </span>
            <select
              value={draft.channel_uuid}
              onChange={(e) => patch({ channel_uuid: e.target.value })}
              className="h-8 min-w-0 max-w-[11rem] rounded-lg bg-white px-2 text-[13px] ring-1 ring-inset ring-neutral-200 focus:outline-none"
            >
              <option value="">{t('admin.following.no_channel')}</option>
              {channels.channels.map((c) => (
                <option key={c.channel_uuid} value={c.channel_uuid}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div className="flex items-center justify-end gap-2 pt-1">
        {follow && (
          <Button size="sm" variant="danger-ghost" icon={<EyeSlash size={13} />} onClick={unfollow} loading={busy === 'unfollow'} className="me-auto">
            {t('admin.following.unfollow')}
          </Button>
        )}
        <Button size="sm" variant="primary" onClick={save} loading={busy === 'save'}>
          {follow ? t('common.save') : t('admin.following.follow')}
        </Button>
      </div>
    </div>
  )
}

/**
 * Follow / Following button. `compact` is an icon-only button for list rows.
 */
export default function FollowButton({ orgId, orgName, compact = false, size = 'md' }: { orgId: number | string; orgName?: string; compact?: boolean; size?: 'sm' | 'md' }) {
  const { t } = useTranslation()
  const me = usePlatformMe()
  const { byOrg, isLoading } = useFollows()
  const [open, setOpen] = React.useState(false)
  if (!me.can('platform.read')) return null
  const follow = byOrg(orgId)
  const label = follow ? t('admin.following.following_level', { level: t(`admin.following.level.${follow.level}`, { defaultValue: follow.level }) }) : t('admin.following.follow')
  const aria = orgName ? (follow ? t('admin.following.edit_named', { name: orgName }) : t('admin.following.follow_named', { name: orgName })) : label

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        {compact ? (
          <button
            type="button"
            aria-label={aria}
            title={label}
            disabled={isLoading}
            onClick={(e) => e.stopPropagation()}
            className={`h-7 w-7 shrink-0 inline-flex items-center justify-center rounded-lg transition-colors ${
              follow ? 'text-indigo-500 hover:bg-indigo-500/10' : 'text-neutral-300 hover:text-neutral-700 hover:bg-neutral-100'
            }`}
          >
            <Eye size={15} weight={follow ? 'fill' : 'regular'} />
          </button>
        ) : (
          <Button size={size} aria-label={aria} icon={<Eye size={14} weight={follow ? 'fill' : 'regular'} className={follow ? 'text-indigo-500' : ''} />} disabled={isLoading}>
            {label}
          </Button>
        )}
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="end"
          sideOffset={6}
          collisionPadding={12}
          onClick={(e) => e.stopPropagation()}
          className="w-[min(20rem,calc(100vw-2rem))] max-h-[var(--radix-popover-content-available-height)] overflow-y-auto rounded-xl bg-white p-3 shadow-[0_12px_40px_-12px_rgba(0,0,0,0.25)] ring-1 ring-neutral-200/80 focus:outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
          style={{ zIndex: 'var(--z-popover)' as any }}
        >
          <p className="px-1 pb-2 text-sm font-semibold text-neutral-900 truncate">
            {orgName ? t('admin.following.popover_title_named', { name: orgName }) : t('admin.following.popover_title')}
          </p>
          <FollowForm orgId={orgId} follow={follow} onDone={() => setOpen(false)} />
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}
