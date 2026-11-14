'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CaretDown, ChatCircleText, Check, Eye, MagnifyingGlass, SignOut, UserSwitch, UsersThree } from '@phosphor-icons/react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import {
  IMPERSONATION_CHANNEL,
  IMPERSONATION_ENDED_EVENT,
  IMPERSONATION_REFUSED_EVENT,
  broadcastImpersonationEnded,
  consoleUrl,
  fetchImpersonationTargets,
  isPlatformContext,
  setActiveImpersonation,
  switchImpersonation,
  takeEarlyImpersonationEnd,
  type ImpersonationSession,
  type ImpersonationSwitch,
  type ImpersonationTargets,
} from '@/lib/auth/impersonation'

// The badge every page shows while impersonating, and its control center:
// "Viewing as Lea Fontaine · Admin · End". Clicking it opens a small menu to
// switch to another member or a role, flip read-only or messaging, and end.
// It sits on top of everything (z-max), takes no layout space, and only its
// own pixels catch the pointer.

const STATUS_POLL_MS = 30_000

function readCookie(name: string): string | null {
  const raw = document.cookie.split('; ').find((c) => c.startsWith(`${name}=`))?.split('=')[1]
  return raw ? decodeURIComponent(raw) : null
}

function Toggle({ on, onClick, disabled, label, icon }: { on: boolean; onClick: () => void; disabled?: boolean; label: string; icon: React.ReactNode }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-start text-[13px] text-neutral-800 outline-none hover:bg-neutral-100 focus-visible:ring-2 focus-visible:ring-amber-400 disabled:cursor-not-allowed disabled:opacity-40"
    >
      <span className="shrink-0 text-neutral-500">{icon}</span>
      <span className="min-w-0 flex-1">{label}</span>
      <span className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors ${on ? 'bg-amber-500' : 'bg-neutral-300'}`}>
        <span className={`absolute h-3 w-3 rounded-full bg-white shadow transition-[inset-inline-start] ${on ? 'start-3.5' : 'start-0.5'}`} />
      </span>
    </button>
  )
}

export default function ImpersonationBanner() {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const fromSession: ImpersonationSession | null = session?.data?.impersonation ?? null
  const [platform, setPlatform] = useState(true)
  const [returned, setReturned] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [targets, setTargets] = useState<ImpersonationTargets | null>(null)
  const endingRef = useRef(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onPlatform = isPlatformContext()
    setPlatform(onPlatform)
    if (!onPlatform) return
    // Back in the console after impersonating: say so once, tidy the URL.
    const url = new URL(window.location.href)
    const reason = url.searchParams.get('impersonation')
    if (reason === 'ended' || reason === 'expired' || reason === 'revoked') {
      setReturned(reason)
      url.searchParams.delete('impersonation')
      window.history.replaceState(window.history.state, '', url.toString())
      const id = window.setTimeout(() => setReturned(null), 5000)
      return () => window.clearTimeout(id)
    }
  }, [])

  const imp = platform ? null : fromSession
  useEffect(() => {
    setActiveImpersonation(imp)
  }, [imp])

  const finish = useCallback(
    async (reason: 'ended' | 'expired' | 'revoked') => {
      if (endingRef.current) return
      endingRef.current = true
      setBusy(true)
      let returnUrl = imp?.return_url ?? null
      try {
        const res = await fetch('/api/auth/impersonation', { method: 'DELETE', credentials: 'include' })
        const body = await res.json().catch(() => ({}))
        returnUrl = body?.return_url || returnUrl
      } catch {
        /* the cookie is cleared server-side on the next call anyway */
      }
      setActiveImpersonation(null)
      broadcastImpersonationEnded(imp?.session_uuid)
      const target = consoleUrl(returnUrl, readCookie('LH_frontend_domain'))
      const sep = target.includes('?') ? '&' : '?'
      // A full navigation on purpose: the console must start from its own
      // session, not this tab's in-memory impersonation state.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign(`${target}${sep}impersonation=${reason}`)
    },
    [imp?.return_url, imp?.session_uuid],
  )

  const doSwitch = useCallback(async (body: ImpersonationSwitch) => {
    setBusy(true)
    const res = await switchImpersonation(body)
    if (!res.ok) {
      setBusy(false)
      setNotice(res.message || t('impersonation.switch_failed'))
      return
    }
    // The page re-renders as the new member from a clean slate.
    window.location.reload()
  }, [t])

  // Ended on the server before this tab even had the session (idle or
  // revoked while it was closed): back to the console, never signed out.
  useEffect(() => {
    if (platform) return
    const toReason = (r?: string | null) => (r === 'ended' ? 'ended' : r === 'expired' ? 'expired' : 'revoked')
    const early = takeEarlyImpersonationEnd()
    if (early && !imp) {
      void finish(toReason(early))
      return
    }
    if (imp) return
    const onEnded = (e: Event) => void finish(toReason((e as CustomEvent<{ reason?: string }>).detail?.reason))
    window.addEventListener(IMPERSONATION_ENDED_EVENT, onEnded)
    return () => window.removeEventListener(IMPERSONATION_ENDED_EVENT, onEnded)
  }, [platform, imp, finish])

  // Ended elsewhere: another tab, the console (revoke), the API (401/410).
  useEffect(() => {
    if (!imp) return
    const onEnded = (e: Event) => {
      const reason = (e as CustomEvent<{ reason?: string }>).detail?.reason
      void finish(reason === 'ended' ? 'ended' : reason === 'expired' ? 'expired' : 'revoked')
    }
    window.addEventListener(IMPERSONATION_ENDED_EVENT, onEnded)
    let bc: BroadcastChannel | null = null
    try {
      bc = new BroadcastChannel(IMPERSONATION_CHANNEL)
      bc.onmessage = (e) => {
        if (e.data?.type === 'ended' && (!e.data.session_uuid || e.data.session_uuid === imp.session_uuid)) {
          void finish('revoked')
        }
      }
    } catch {
      bc = null
    }
    const poll = window.setInterval(async () => {
      try {
        const res = await fetch('/api/auth/impersonation', { credentials: 'include', cache: 'no-store' })
        const body = await res.json()
        if (body?.active === false) void finish('revoked')
      } catch {
        /* offline: try again */
      }
    }, STATUS_POLL_MS)
    return () => {
      window.removeEventListener(IMPERSONATION_ENDED_EVENT, onEnded)
      window.clearInterval(poll)
      bc?.close()
    }
  }, [imp, finish])

  // A refused write: say so right under the badge.
  useEffect(() => {
    if (!imp) return
    const onRefused = (e: Event) => {
      const code = (e as CustomEvent<{ code?: string }>).detail?.code
      const key =
        code === 'IMPERSONATION_READ_ONLY'
          ? 'impersonation.refused_read_only'
          : code === 'IMPERSONATION_MESSAGING_BLOCKED'
            ? 'impersonation.refused_messaging'
            : code === 'IMPERSONATION_WRONG_ORG'
              ? 'impersonation.refused_wrong_org'
              : 'impersonation.refused_denied'
      setNotice(t(key))
    }
    window.addEventListener(IMPERSONATION_REFUSED_EVENT, onRefused)
    return () => window.removeEventListener(IMPERSONATION_REFUSED_EVENT, onRefused)
  }, [imp, t])
  useEffect(() => {
    if (!notice) return
    const id = window.setTimeout(() => setNotice(null), 4500)
    return () => window.clearTimeout(id)
  }, [notice])

  // The switcher's member search.
  useEffect(() => {
    if (!open || !imp) return
    let live = true
    const id = window.setTimeout(async () => {
      const data = await fetchImpersonationTargets(query.trim())
      if (live) setTargets(data)
    }, 200)
    return () => {
      live = false
      window.clearTimeout(id)
    }
  }, [open, query, imp])

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!imp) {
    if (!returned) return null
    return (
      <div className="pointer-events-none fixed inset-x-0 top-1.5 flex justify-center px-4" style={{ zIndex: 'var(--z-max)' as any }}>
        <div
          role="status"
          data-testid="impersonation-returned"
          className="pointer-events-auto flex items-center gap-2 rounded-full bg-neutral-950/95 px-3 py-1.5 text-[12.5px] font-medium text-white shadow-lg ring-1 ring-white/15"
        >
          <UserSwitch size={14} weight="bold" className="text-amber-400" />
          {t(`impersonation.returned_${returned}`)}
        </div>
      </div>
    )
  }

  const readOnly = imp.mode !== 'full'
  const isRole = imp.target?.kind === 'role'
  const roleLabel = imp.target?.role_label ?? ''
  const name = imp.target?.label ?? ''
  const members = (targets?.members ?? []).filter((m) => !(imp.target.kind === 'user' && m.user_id === imp.target.user_id))

  return (
    <div
      ref={rootRef}
      data-testid="impersonation-banner"
      className="pointer-events-none fixed inset-x-0 top-1.5 flex flex-col items-center px-4"
      style={{ zIndex: 'var(--z-max)' as any }}
    >
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-auto flex max-w-full items-center gap-1.5 rounded-full bg-neutral-950/95 p-1 pe-1.5 text-white shadow-[0_6px_24px_rgba(0,0,0,0.28)] ring-1 ring-white/15 backdrop-blur"
      >
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-haspopup="menu"
          aria-label={t('impersonation.menu')}
          className="flex h-7 min-w-0 items-center gap-2 rounded-full ps-0.5 pe-2 text-[12.5px] leading-none outline-none hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-amber-400"
        >
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-amber-400 text-neutral-950">
            <UserSwitch size={14} weight="bold" />
          </span>
          <span className="hidden shrink-0 text-white/70 sm:inline">{t('impersonation.viewing_as')}</span>
          <span className="min-w-0 max-w-[10rem] truncate font-semibold sm:max-w-[16rem]" data-testid="impersonation-target">
            {name}
          </span>
          {roleLabel && !isRole && <span className="hidden shrink-0 text-white/70 md:inline">· {roleLabel}</span>}
          {readOnly && (
            <span
              className="inline-flex shrink-0 items-center gap-1 rounded-full bg-sky-400/20 px-1.5 py-0.5 text-[11px] font-semibold text-sky-200"
              data-testid="impersonation-mode"
            >
              <Eye size={11} weight="bold" />
              <span className="hidden sm:inline">{t('impersonation.read_only')}</span>
            </span>
          )}
          <CaretDown size={11} className={`shrink-0 opacity-60 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        <button
          type="button"
          onClick={() => void finish('ended')}
          disabled={busy}
          data-testid="impersonation-end"
          className="inline-flex h-7 shrink-0 items-center rounded-full bg-white/10 px-3 text-[12px] font-semibold leading-none text-white outline-none ring-1 ring-inset ring-white/15 transition-colors hover:bg-white hover:text-neutral-900 focus-visible:ring-2 focus-visible:ring-amber-400 disabled:opacity-60"
        >
          {t('impersonation.end')}
        </button>
      </div>

      {notice && !open && (
        <div
          role="alert"
          data-testid="impersonation-notice"
          className="pointer-events-auto mt-1.5 max-w-sm rounded-xl bg-amber-50 px-3 py-2 text-center text-[12.5px] font-medium text-amber-900 shadow-lg ring-1 ring-amber-200"
        >
          {notice}
        </div>
      )}

      {open && (
        <div
          role="menu"
          data-testid="impersonation-menu"
          className="pointer-events-auto mt-1.5 w-[min(20rem,calc(100vw-2rem))] rounded-2xl bg-white p-1.5 text-start text-[13px] text-neutral-700 shadow-[0_12px_40px_rgba(0,0,0,0.18)] ring-1 ring-black/5"
        >
          <div className="px-2.5 pb-2 pt-1.5">
            <p className="truncate font-semibold text-neutral-900">{t('impersonation.viewing_as_name', { name })}</p>
            <p className="truncate text-[12px] text-neutral-500">
              {imp.org?.name}
              {roleLabel && !isRole ? ` · ${roleLabel}` : ''}
            </p>
          </div>

          <div className="relative px-1">
            <MagnifyingGlass size={14} className="pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2 text-neutral-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('impersonation.switch_search')}
              aria-label={t('impersonation.switch_search')}
              className="h-8 w-full rounded-lg bg-neutral-100 ps-8 pe-2 text-[13px] text-neutral-900 placeholder:text-neutral-400 outline-none focus:ring-2 focus:ring-amber-400/60"
              data-testid="impersonation-search"
              autoFocus
            />
          </div>
          <div className="mt-1 max-h-48 overflow-y-auto">
            {members.slice(0, 8).map((m) => (
              <button
                key={m.user_id}
                type="button"
                role="menuitem"
                disabled={busy}
                onClick={() => void doSwitch({ user_id: m.user_id })}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-start outline-none hover:bg-neutral-100 focus-visible:bg-neutral-100 disabled:opacity-50"
                data-testid={`impersonation-switch-${m.username}`}
              >
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-neutral-200 text-[11px] font-semibold text-neutral-700">
                  {(m.name || m.username).slice(0, 1).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1 truncate text-neutral-900">{m.name}</span>
                <span className="shrink-0 text-[11px] text-neutral-500">{m.role_label}</span>
              </button>
            ))}
            {targets && members.length === 0 && <p className="px-2.5 py-2 text-[12px] text-neutral-500">{t('impersonation.switch_no_members')}</p>}
          </div>

          <div className="mx-1 my-1 h-px bg-neutral-200" />
          <p className="px-2.5 pb-1 pt-1 text-[11px] font-semibold text-neutral-500">{t('impersonation.switch_role')}</p>
          <div className="flex flex-wrap gap-1 px-2 pb-1.5">
            {(targets?.roles ?? []).map((r) => {
              const current = isRole && imp.target.role_id === r.id
              return (
                <button
                  key={r.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={current}
                  disabled={busy || current}
                  onClick={() => void doSwitch({ role_id: r.id })}
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[12px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${
                    current ? 'bg-amber-100 text-amber-900' : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
                  }`}
                  data-testid={`impersonation-role-${r.id}`}
                >
                  {current ? <Check size={11} weight="bold" /> : <UsersThree size={11} />}
                  {r.name}
                </button>
              )
            })}
          </div>

          <div className="mx-1 my-1 h-px bg-neutral-200" />
          {notice && (
            <p role="alert" className="mx-1 mb-1 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[12px] text-amber-900">
              {notice}
            </p>
          )}
          <Toggle
            on={readOnly}
            disabled={busy || isRole || (readOnly && imp.can_full === false)}
            onClick={() => void doSwitch({ mode: readOnly ? 'full' : 'read_only' })}
            label={t('impersonation.read_only')}
            icon={<Eye size={15} />}
          />
          {!readOnly && (
            <Toggle
              on={imp.allow_messaging}
              disabled={busy}
              onClick={() => void doSwitch({ allow_messaging: !imp.allow_messaging })}
              label={t('impersonation.allow_messaging')}
              icon={<ChatCircleText size={15} />}
            />
          )}
          <div className="mx-1 my-1 h-px bg-neutral-200" />
          <button
            type="button"
            role="menuitem"
            onClick={() => void finish('ended')}
            disabled={busy}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-start text-[13px] font-semibold text-neutral-900 outline-none hover:bg-neutral-100 disabled:opacity-60"
          >
            <SignOut size={15} className="text-neutral-500" />
            {t('impersonation.end_long')}
          </button>
        </div>
      )}
    </div>
  )
}
