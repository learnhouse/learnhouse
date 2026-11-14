'use client'
import React from 'react'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { Command } from 'cmdk'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, FunnelSimple, MagnifyingGlass } from '@phosphor-icons/react'
import { isNotAvailable, listOrgs, listUsers, searchPlatform } from '@services/ee/platform/api'
import { platformKeys } from '@services/ee/platform/keys'
import type { PlatformPermission, SearchResults } from '@services/ee/platform/types'
import { useAccessToken, useDebounced, usePlatformMe, shouldRetry } from '@components/Admin/hooks'
import { Avatar, OrgLogo, PlanChip, adminPath, orgDisplayName } from '@components/Admin/Shared/AdminKit'
import { ADMIN_NAV } from './nav'

// ⌘K for the console: jump to a page, an organization or a user. Uses
// GET /search and falls back to the org/user list endpoints on servers that
// predate it.

const QUICK_FILTERS: { key: string; href: string; hue: string; perms: PlatformPermission[] }[] = [
  { key: 'orgs_pro', href: '/admin/organizations?plan=pro', hue: 'text-violet-400', perms: ['platform.read'] },
  { key: 'orgs_paid', href: '/admin/organizations?plan=paid', hue: 'text-amber-400', perms: ['platform.read'] },
  { key: 'orgs_at_risk', href: '/admin/organizations?plan=paid&health_max=39&sort=health:asc', hue: 'text-rose-600', perms: ['platform.read'] },
  { key: 'orgs_new_week', href: '/admin/organizations?created_since=7d', hue: 'text-sky-400', perms: ['platform.read'] },
  { key: 'pocs_ending', href: '/admin/pocs?status=ending', hue: 'text-violet-400', perms: ['platform.read'] },
  { key: 'users_new_week', href: '/admin/users?created_since=7d', hue: 'text-emerald-400', perms: ['platform.read'] },
  { key: 'activity_failed', href: '/admin/activity?outcome=failed,denied', hue: 'text-rose-600', perms: ['audit.read'] },
  { key: 'activity_today', href: '/admin/activity?since=24h', hue: 'text-cyan-400', perms: ['audit.read'] },
]

const ITEM =
  'group/item flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-start aria-selected:bg-[var(--adm-active)] transition-colors'

async function runSearch(token: string | undefined, q: string): Promise<SearchResults> {
  try {
    return await searchPlatform(token, q)
  } catch (err) {
    if (!isNotAvailable(err)) throw err
    const [orgs, users] = await Promise.all([
      listOrgs(token, { q, limit: 6, page: 1 }).catch(() => ({ items: [] as any[] })),
      listUsers(token, { search: q, limit: 6, page: 1 }).catch(() => ({ items: [] as any[] })),
    ])
    return { orgs: orgs.items ?? [], users: users.items ?? [] }
  }
}

export default function CommandSearch({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation()
  const router = useRouter()
  const token = useAccessToken()
  const me = usePlatformMe()
  const [query, setQuery] = React.useState('')
  const q = useDebounced(query.trim(), 200)

  React.useEffect(() => {
    if (!open) setQuery('')
  }, [open])

  const { data, isFetching } = useQuery({
    queryKey: platformKeys.search(q),
    queryFn: () => runSearch(token, q),
    enabled: open && !!token && q.length >= 2,
    retry: shouldRetry,
    staleTime: 30_000,
  })

  // Pages in the nav's own grouping: the direct links together, then one
  // section per menu (Organizations, Operations, Insights, Settings).
  const allowed = (i: (typeof ADMIN_NAV)[number]['items'][number]) => !i.soon && (i.perms.length === 0 || me.canAny(...i.perms))
  const pageSections = [
    { key: 'pages', heading: t('admin.search.pages'), items: ADMIN_NAV.filter((g) => g.direct).flatMap((g) => g.items).filter(allowed) },
    ...ADMIN_NAV.filter((g) => !g.direct).map((g) => ({ key: g.key, heading: t(g.labelKey), items: g.items.filter(allowed) })),
  ].filter((sec) => sec.items.length)
  // Saved jumps into filtered lists.
  const quick = QUICK_FILTERS.filter((f) => me.canAny(...f.perms))
  // Newer servers also return automations, POCs, tasks, team members and
  // channels, each with its console `path`.
  const extra = q.length >= 2
    ? Object.entries((data ?? {}) as unknown as Record<string, unknown>)
        .filter(([k, v]) => k !== 'orgs' && k !== 'users' && Array.isArray(v) && v.length)
        .map(([k, v]) => ({
          key: k,
          items: (v as any[])
            .filter((x) => x && typeof x.path === 'string' && x.path.startsWith('/admin'))
            .slice(0, 6)
            .map((x) => ({ path: x.path as string, label: String(x.name ?? x.title ?? x.label ?? x.username ?? x.org_name ?? x.path), sub: x.org_name ?? x.email ?? x.status ?? '' })),
        }))
        .filter((g) => g.items.length)
    : []
  const orgs = q.length >= 2 ? (data?.orgs ?? []).slice(0, 8) : []
  const users = q.length >= 2 ? (data?.users ?? []).slice(0, 8) : []

  const go = (href: string) => {
    onOpenChange(false)
    router.push(href)
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className="fixed inset-0 bg-[var(--adm-overlay)] data-[state=open]:animate-in data-[state=open]:fade-in-0"
          style={{ zIndex: 'var(--z-modal-backdrop)' as any }}
        />
        <DialogPrimitive.Content
          aria-label={t('admin.search.placeholder')}
          className="fixed start-1/2 top-[calc(12px+env(safe-area-inset-top))] sm:top-[12%] flex w-[94vw] max-w-[640px] -translate-x-1/2 rtl:translate-x-1/2 flex-col overflow-hidden rounded-2xl bg-[var(--adm-raised)] ring-1 ring-[var(--adm-line)] shadow-[var(--adm-shadow)] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
          style={{ zIndex: 'var(--z-modal)' as any }}
        >
          <DialogPrimitive.Title className="sr-only">{t('admin.search.placeholder')}</DialogPrimitive.Title>
          <Command
            label={t('admin.search.placeholder')}
            // Pages are filtered by cmdk; server results are already matched.
            filter={(value, search) => (value.startsWith('srv:') ? 1 : value.toLowerCase().includes(search.toLowerCase()) ? 1 : 0)}
            className="flex flex-col [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-[var(--adm-fg-3)]"
          >
            <div className="flex items-center gap-3 px-4 h-14 border-b border-[var(--adm-line)]">
              <MagnifyingGlass size={18} className="text-[var(--adm-fg-3)] shrink-0" />
              <Command.Input
                value={query}
                onValueChange={setQuery}
                autoFocus
                placeholder={t('admin.search.placeholder')}
                className="adm-bare-input flex-1 min-w-0 bg-transparent text-[15px] text-[var(--adm-fg)] outline-none placeholder:text-[var(--adm-fg-3)]"
              />
              {isFetching && <span className="text-[11px] text-[var(--adm-fg-3)]">{t('admin.search.searching')}</span>}
              <kbd className="hidden sm:inline-flex h-5 items-center rounded bg-[var(--adm-active)] px-1.5 text-[10.5px] text-[var(--adm-fg-3)]">Esc</kbd>
            </div>
            <Command.List className="max-h-[60vh] min-h-[200px] overflow-y-auto p-2">
              <Command.Empty className="px-4 py-12 text-center text-sm text-[var(--adm-fg-3)]">
                {q.length < 2 ? t('admin.search.hint') : t('admin.search.no_results')}
              </Command.Empty>
              {orgs.length > 0 && (
                <Command.Group heading={t('admin.search.orgs')}>
                  {orgs.map((o) => (
                    <Command.Item key={`o${o.id}`} value={`srv:org:${o.id}:${o.name}`} onSelect={() => go(`/admin/organizations/${o.id}`)} className={ITEM}>
                      <OrgLogo org={o} size={28} />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-sm font-medium text-[var(--adm-fg)]">{orgDisplayName(o, t)}</span>
                        <span className="truncate text-xs text-[var(--adm-fg-3)]" dir="ltr">
                          {o.slug} · #{o.id}
                        </span>
                      </span>
                      <PlanChip plan={o.plan} />
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {users.length > 0 && (
                <Command.Group heading={t('admin.search.users')}>
                  {users.map((u) => (
                    <Command.Item
                      key={`u${u.id}`}
                      value={`srv:user:${u.id}:${u.username}`}
                      onSelect={() => go(adminPath.user(u.id))}
                      className={ITEM}
                    >
                      <Avatar user={u} size={28} />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-sm font-medium text-[var(--adm-fg)]">{u.username}</span>
                        <span className="truncate text-xs text-[var(--adm-fg-3)]">{u.email}</span>
                      </span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {extra.map((g) => (
                <Command.Group key={g.key} heading={t(`admin.search.groups.${g.key}`, { defaultValue: g.key })}>
                  {g.items.map((x) => (
                    <Command.Item key={x.path} value={`srv:${g.key}:${x.path}`} onSelect={() => go(x.path)} className={ITEM}>
                      <span className="flex h-7 w-7 items-center justify-center rounded-md bg-[var(--adm-hover)] text-[var(--adm-fg-2)]">
                        <ArrowRight size={14} className="rtl:rotate-180" />
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-sm font-medium text-[var(--adm-fg)]">{x.label}</span>
                        {x.sub && <span className="truncate text-xs text-[var(--adm-fg-3)]">{x.sub}</span>}
                      </span>
                    </Command.Item>
                  ))}
                </Command.Group>
              ))}
              <Command.Group heading={t('admin.search.quick')}>
                {quick.map((f) => (
                  <Command.Item key={f.key} value={`quick:${t(`admin.search.quick_filters.${f.key}`)}`} onSelect={() => go(f.href)} className={ITEM}>
                    <span className={`flex h-7 w-7 items-center justify-center rounded-md bg-[var(--adm-hover)] ${f.hue}`}>
                      <FunnelSimple size={14} weight="bold" />
                    </span>
                    <span className="text-sm text-[var(--adm-fg)]">{t(`admin.search.quick_filters.${f.key}`)}</span>
                  </Command.Item>
                ))}
              </Command.Group>
              {pageSections.map((sec) => (
                <Command.Group key={sec.key} heading={sec.heading}>
                  {sec.items.map((p) => {
                    const Icon = p.icon
                    return (
                      <Command.Item key={p.key} value={`page:${sec.heading} ${t(p.labelKey)}`} onSelect={() => go(p.href)} className={ITEM}>
                        <span className={`flex h-7 w-7 items-center justify-center rounded-md bg-[var(--adm-hover)] ${p.hue}`}>
                          <Icon size={16} weight="duotone" />
                        </span>
                        <span className="text-sm text-[var(--adm-fg)]">{t(p.labelKey)}</span>
                      </Command.Item>
                    )
                  })}
                </Command.Group>
              ))}
            </Command.List>
          </Command>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
