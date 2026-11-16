'use client'
import React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { Toaster } from 'react-hot-toast'
import { useQuery } from '@tanstack/react-query'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { CaretDown, Check, List, MagnifyingGlass, Moon, SignOut, Sun, X } from '@phosphor-icons/react'
import { signOut } from '@components/Contexts/AuthContext'
import { useIsMac } from '@/hooks/useIsMac'
import { cn } from '@/lib/utils'
import { getOverview } from '@services/ee/platform/api'
import { platformKeys } from '@services/ee/platform/keys'
import { listDeletions } from '@services/ee/platform/ops'
import { useAccessToken, usePlatformMe, shouldRetry } from '@components/Admin/hooks'
import { Avatar, RoleBadge } from '@components/Admin/Shared/AdminKit'
import { useAdminTheme, type AdminThemePref } from './AdminTheme'
import { ADMIN_NAV, isNavActive, type AdminNavGroup, type AdminNavItem } from './nav'
import CommandSearch from './CommandSearch'
import InboxBell from './InboxBell'

// The console frame: one calm, always-dark top bar (h-12) in both themes;
// only the page below follows Light / Dark. Logo start, six entries centered
// on the viewport (a 1fr auto 1fr grid), actions end. Overview and Users are
// links; the four groups open a dark menu (click, hover with a short delay,
// or the keyboard). Below 1100px a menu button opens the same groups as a
// sheet. `adm-bar` (adminDark.css) points the tokens at the dark bar set,
// and every menu that belongs to the bar carries it too.

const THEMES: { key: AdminThemePref; Icon: typeof Sun }[] = [
  { key: 'light', Icon: Sun },
  { key: 'dark', Icon: Moon },
]

const FOCUS_RING = 'outline-none focus-visible:ring-2 focus-visible:ring-white/20'

const MENU_SURFACE =
  'adm-bar rounded-xl bg-[var(--adm-raised)] shadow-[var(--adm-shadow)] p-1.5 text-[var(--adm-fg)] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95'

const ICON_BUTTON = cn(
  'h-8 inline-flex items-center justify-center gap-1.5 rounded-lg text-[var(--adm-fg-2)] hover:text-[var(--adm-fg)] hover:bg-[var(--adm-hover)] transition-colors shrink-0',
  FOCUS_RING
)

function entryClass(active: boolean, open?: boolean) {
  return cn(
    'group inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-[13px] font-medium leading-none whitespace-nowrap transition-colors',
    FOCUS_RING,
    active ? 'bg-white/[0.07] text-[var(--adm-fg)]' : open ? 'bg-white/[0.05] text-[var(--adm-fg)]' : 'text-[var(--adm-fg-2)] hover:text-[var(--adm-fg)]'
  )
}

/** Counts that roll up onto their group: overdue tasks, pending deletions. */
function useNavBadges(enabled: boolean): Record<string, number> {
  const token = useAccessToken()
  const overview = useQuery({
    queryKey: platformKeys.overview(30),
    queryFn: () => getOverview(token, 30),
    enabled: !!token && enabled,
    retry: shouldRetry,
    staleTime: 60_000,
  })
  const deletions = useQuery({
    queryKey: ['platform', 'nav-badges', 'deletions'],
    queryFn: () => listDeletions(token, { status: 'pending', limit: 50 }),
    enabled: !!token && enabled,
    retry: shouldRetry,
    staleTime: 60_000,
  })
  const myTasks = (overview.data as { my_tasks?: { overdue?: number } } | undefined)?.my_tasks
  return {
    tasks: Number(myTasks?.overdue ?? 0),
    deletions: Array.isArray(deletions.data?.pending) ? deletions.data!.pending.length : 0,
  }
}

function Badge({ count }: { count: number }) {
  if (!count) return null
  return (
    <span className="ms-auto min-w-4 h-4 px-1 rounded-full bg-rose-500 text-[10px] font-semibold leading-none text-white tabular-nums inline-flex items-center justify-center">
      {count > 99 ? '99+' : count}
    </span>
  )
}

/** One group: a trigger with a dark menu of its pages (icon, name, one line). */
function NavGroupMenu({ group, pathname, badges }: { group: AdminNavGroup; pathname: string; badges: Record<string, number> }) {
  const { t } = useTranslation()
  const [open, setOpen] = React.useState(false)
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const active = group.items.some((i) => isNavActive(i, pathname))
  const rollup = group.items.reduce((sum, i) => sum + (badges[i.key] ?? 0), 0)
  const Icon = group.icon

  // Hover opens after a short delay and closes a little later, so moving the
  // pointer from the trigger into the menu doesn't flicker.
  const later = (fn: () => void, ms: number) => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(fn, ms)
  }
  React.useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])
  React.useEffect(() => setOpen(false), [pathname])

  return (
    <DropdownMenu.Root open={open} onOpenChange={setOpen} modal={false}>
      <DropdownMenu.Trigger
        className={entryClass(active, open)}
        onPointerEnter={(e) => e.pointerType === 'mouse' && later(() => setOpen(true), 120)}
        onPointerLeave={(e) => e.pointerType === 'mouse' && later(() => setOpen(false), 200)}
      >
        <Icon size={14} weight={active ? 'fill' : 'bold'} className={cn('shrink-0 transition-colors', active ? group.hue : 'text-white/40 group-hover:text-white/70')} />
        {t(group.labelKey)}
        {rollup > 0 && <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-rose-500" />}
        <CaretDown size={10} weight="bold" className={cn('text-white/40 transition-transform', open && 'rotate-180')} />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="center"
          sideOffset={8}
          collisionPadding={12}
          onPointerEnter={() => later(() => setOpen(true), 0)}
          onPointerLeave={() => later(() => setOpen(false), 200)}
          className={cn(MENU_SURFACE, 'w-72')}
          style={{ zIndex: 'var(--z-dropdown)' as any }}
        >
          {group.items.map((item) => {
            const isActive = isNavActive(item, pathname)
            const ItemIcon = item.icon
            return (
              <DropdownMenu.Item key={item.key} asChild>
                <Link
                  href={item.href}
                  aria-current={isActive ? 'page' : undefined}
                  className={cn(
                    'flex items-start gap-3 rounded-lg px-2.5 py-2 outline-none cursor-pointer',
                    isActive ? 'bg-[var(--adm-active)]' : 'data-[highlighted]:bg-[var(--adm-hover)]'
                  )}
                >
                  <span className="mt-0.5 h-7 w-7 shrink-0 rounded-md bg-white/[0.06] flex items-center justify-center">
                    <ItemIcon size={15} weight="fill" className={item.hue} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-[13px] font-medium text-[var(--adm-fg)]">
                      {t(item.labelKey)}
                      {isActive && <Check size={12} weight="bold" className="text-white/60" />}
                      <Badge count={badges[item.key] ?? 0} />
                    </span>
                    {item.descKey && <span className="block mt-0.5 text-xs text-[var(--adm-fg-3)] leading-snug">{t(item.descKey)}</span>}
                  </span>
                </Link>
              </DropdownMenu.Item>
            )
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

function DirectLink({ item, pathname }: { item: AdminNavItem; pathname: string }) {
  const { t } = useTranslation()
  const active = isNavActive(item, pathname)
  const Icon = item.icon
  return (
    <Link href={item.href} aria-current={active ? 'page' : undefined} className={entryClass(active)}>
      <Icon size={14} weight={active ? 'fill' : 'bold'} className={cn('shrink-0 transition-colors', active ? item.hue : 'text-white/40 group-hover:text-white/70')} />
      {t(item.labelKey)}
    </Link>
  )
}

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation()
  const pathname = usePathname() || ''
  const me = usePlatformMe()
  const theme = useAdminTheme()
  const isMac = useIsMac()
  const [menuOpen, setMenuOpen] = React.useState(false)
  const [searchOpen, setSearchOpen] = React.useState(false)
  const badges = useNavBadges(me.can('platform.read'))

  React.useEffect(() => {
    setMenuOpen(false)
  }, [pathname])

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSearchOpen((v) => !v)
      }
      if (e.key === 'Escape') setMenuOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Permission filtering: hide pages the member can't use, and empty groups.
  const groups = ADMIN_NAV.map((g) => ({
    ...g,
    items: g.items.filter((i) => !i.soon && (i.perms.length === 0 || me.canAny(...i.perms))),
  })).filter((g) => g.items.length)
  const logOut = () => signOut({ redirect: true, callbackUrl: '/admin/login' })
  const user = { user_uuid: me.userUuid, avatar_image: me.avatarImage, username: me.username }

  return (
    <div translate="no" className="notranslate min-h-screen bg-[var(--adm-canvas)] text-neutral-900">
      {/* Spacer for the fixed bar */}
      <div className="h-12" />
      <header
        className="adm-bar fixed top-0 start-0 end-0 h-12 bg-[var(--adm-bar)] border-b border-[var(--adm-bar-line)] grid grid-cols-[minmax(max-content,1fr)_auto_minmax(max-content,1fr)] items-center gap-2 ps-3 pe-2 sm:ps-4 sm:pe-3 text-[var(--adm-fg)]"
        style={{ zIndex: 'var(--z-overlay)' as any }}
      >
        {/* Start column: menu button (narrow screens), logo and badge */}
        <div className="justify-self-start flex items-center gap-2 min-w-0">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label={menuOpen ? t('admin.shell.close_menu') : t('admin.shell.open_menu')}
            aria-expanded={menuOpen}
            className={cn(ICON_BUTTON, 'min-[1100px]:hidden w-8 -ms-1')}
          >
            {menuOpen ? <X size={17} /> : <List size={18} />}
          </button>
          <Link className={cn('flex items-center gap-2 shrink-0 rounded-lg pe-2 transition-opacity hover:opacity-80', FOCUS_RING)} href="/admin">
            {/* The bar is always dark, so always the white mark. */}
            <img src="/lrn-dash.svg" alt="" className="h-6 w-6" />
            <span className="text-[13px] font-semibold leading-none text-[var(--adm-fg)]">{t('admin.menu.admin')}</span>
            <span className="hidden sm:inline-flex items-center h-4 px-1.5 rounded text-[9px] font-semibold uppercase tracking-wider leading-none text-amber-400 bg-amber-400/10">
              {t('admin.menu.superadmin')}
            </span>
          </Link>
        </div>

        {/* Center column: six entries, centered on the viewport. */}
        <nav aria-label={t('admin.shell.navigation')} className="hidden min-[1100px]:flex items-center justify-center gap-0.5 min-w-0">
          {groups.map((group) =>
            group.direct ? (
              <DirectLink key={group.key} item={group.items[0]} pathname={pathname} />
            ) : (
              <NavGroupMenu key={group.key} group={group} pathname={pathname} badges={badges} />
            )
          )}
        </nav>
        {/* Keeps the grid's center column when the nav is hidden. */}
        <span className="min-[1100px]:hidden" />

        {/* End column: search, inbox, account */}
        <div className="justify-self-end flex items-center gap-1">
          <button type="button" onClick={() => setSearchOpen(true)} aria-label={t('admin.search.trigger')} className={cn(ICON_BUTTON, 'w-8 sm:w-auto sm:px-2')}>
            <MagnifyingGlass size={16} />
            <kbd className="hidden sm:inline-flex h-[18px] items-center rounded px-1 text-[10.5px] font-medium leading-none text-[var(--adm-fg-3)] ring-1 ring-inset ring-[var(--adm-line)]">
              {isMac ? '⌘K' : 'Ctrl K'}
            </kbd>
          </button>

          <InboxBell />

          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button type="button" aria-label={t('admin.shell.account_menu')} className={cn(ICON_BUTTON, 'w-8')}>
                <Avatar user={user} size={24} />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content align="end" sideOffset={8} collisionPadding={12} className={cn(MENU_SURFACE, 'w-64')} style={{ zIndex: 'var(--z-dropdown)' as any }}>
                <div className="flex items-center gap-2.5 px-2.5 py-2">
                  <Avatar user={user} size={32} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-[var(--adm-fg)] truncate">{user.username}</p>
                    {me.email && <p className="text-xs text-[var(--adm-fg-3)] truncate">{me.email}</p>}
                  </div>
                  {!me.isLoading && <RoleBadge role={me.role} />}
                </div>
                <DropdownMenu.Separator className="my-1 h-px bg-[var(--adm-line)]" />
                <DropdownMenu.Label className="px-2.5 pt-1.5 pb-1 text-[11px] font-medium text-[var(--adm-fg-3)]">{t('admin.theme.label')}</DropdownMenu.Label>
                <DropdownMenu.RadioGroup value={theme.pref} onValueChange={(v) => theme.setPref(v as AdminThemePref)} className="grid grid-cols-2 gap-1 px-1.5 pb-1.5">
                  {THEMES.map(({ key, Icon }) => (
                    <DropdownMenu.RadioItem
                      key={key}
                      value={key}
                      onSelect={(e) => e.preventDefault()}
                      className="flex flex-col items-center gap-1 rounded-lg py-2 text-[11px] text-[var(--adm-fg-2)] outline-none cursor-pointer data-[highlighted]:bg-[var(--adm-hover)] data-[state=checked]:bg-[var(--adm-active)] data-[state=checked]:text-[var(--adm-fg)]"
                    >
                      <Icon size={15} weight="bold" />
                      {t(`admin.theme.${key}`)}
                    </DropdownMenu.RadioItem>
                  ))}
                </DropdownMenu.RadioGroup>
                <DropdownMenu.Separator className="my-1 h-px bg-[var(--adm-line)]" />
                <DropdownMenu.Item
                  onSelect={logOut}
                  className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-rose-400 outline-none cursor-pointer data-[highlighted]:bg-[var(--adm-hover)]"
                >
                  <SignOut size={15} weight="bold" className="rtl:rotate-180" />
                  {t('common.sign_out')}
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      </header>

      {/* The same groups as a sheet below 1100px, dark like the bar */}
      {menuOpen && (
        <div className="min-[1100px]:hidden fixed inset-x-0 top-12 bottom-0" style={{ zIndex: 'var(--z-overlay)' as any }}>
          <div aria-hidden="true" onClick={() => setMenuOpen(false)} className="absolute inset-0 bg-black/50 animate-in fade-in-0" />
          <nav
            aria-label={t('admin.shell.navigation')}
            className="adm-bar relative max-h-full overflow-y-auto bg-[var(--adm-bar)] border-b border-[var(--adm-bar-line)] px-3 pt-1 pb-4 text-[var(--adm-fg)] animate-in slide-in-from-top-2 fade-in-0"
          >
            {/* Direct links first, then each group as a section. */}
            <div className="pt-2 grid grid-cols-1 sm:grid-cols-2 gap-0.5">
              {groups.filter((g) => g.direct).map((g) => (
                <SheetLink key={g.key} item={g.items[0]} pathname={pathname} badge={0} onClick={() => setMenuOpen(false)} />
              ))}
            </div>
            {groups.filter((g) => !g.direct).map((group) => (
              <div key={group.key} className="pt-2">
                <p className="px-3 pt-2 pb-1 text-[11px] font-medium text-[var(--adm-fg-3)]">{t(group.labelKey)}</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-0.5">
                  {group.items.map((item) => (
                    <SheetLink key={item.key} item={item} pathname={pathname} badge={badges[item.key] ?? 0} onClick={() => setMenuOpen(false)} />
                  ))}
                </div>
              </div>
            ))}
          </nav>
        </div>
      )}

      {/* Not <main>: the root layout already provides the landmark. */}
      <div className="flex flex-col w-full min-w-0">{children}</div>

      <CommandSearch open={searchOpen} onOpenChange={setSearchOpen} />
      <Toaster
        // Top, below the bar: the bottom is taken by the sticky save and bulk bars.
        position="top-center"
        containerStyle={{ top: 60 }}
        toastOptions={{
          style: { fontSize: 13, background: 'var(--adm-raised)', color: 'var(--adm-fg)', border: '1px solid var(--adm-line)', boxShadow: 'var(--adm-shadow)' },
        }}
      />
    </div>
  )
}

function SheetLink({ item, pathname, badge, onClick }: { item: AdminNavItem; pathname: string; badge: number; onClick: () => void }) {
  const { t } = useTranslation()
  const active = isNavActive(item, pathname)
  const Icon = item.icon
  return (
    <Link
      href={item.href}
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cn('flex items-center gap-2.5 h-10 px-3 rounded-lg text-[13px] font-medium', FOCUS_RING, active ? 'bg-white/[0.07] text-[var(--adm-fg)]' : 'text-[var(--adm-fg-2)] hover:text-[var(--adm-fg)] hover:bg-[var(--adm-hover)]')}
    >
      <Icon size={16} weight={active ? 'fill' : 'bold'} className={active ? item.hue : 'text-white/45'} />
      <span className="flex-1 truncate">{t(item.labelKey)}</span>
      <Badge count={badge} />
    </Link>
  )
}
