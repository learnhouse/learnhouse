'use client'
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { Command } from 'cmdk'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import {
  ArrowRight,
  BookCopy,
  BookOpen,
  Folder,
  MessageCircle,
  MessagesSquare,
  Mic,
  Search as SearchIcon,
  Users as UsersIcon,
} from 'lucide-react'
import { Cube } from '@phosphor-icons/react'

import { useOrg } from '@components/Contexts/OrgContext'
import UserAvatar from '@components/Objects/UserAvatar'
import { getUriWithOrg } from '@services/config/config'
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics'
import { useIsMac } from '@/hooks/useIsMac'
import { rankPages } from '@/lib/site-search/match'
import { useSitePages } from '@/lib/site-search/useSitePages'
import {
  MIN_QUERY,
  SITE_RESULT_ORDER,
  useSiteSearch,
  type SiteResult,
  type SiteResultType,
} from '@/lib/site-search/useSiteSearch'
import type { SitePageMeta } from '@/lib/site-search/types'
import { useSiteCommandPalette } from './SiteCommandPaletteContext'
import { useOptionalShortcuts } from '@/lib/shortcuts/ShortcutsContext'
import { Keys } from '@components/Objects/Shortcuts/Kbd'
import { Zap } from 'lucide-react'

const TYPE_ICON: Record<SiteResultType, React.ComponentType<any>> = {
  course: BookCopy,
  activity: BookOpen,
  folder: Folder,
  community: MessagesSquare,
  discussion: MessageCircle,
  playground: Cube,
  podcast: Mic,
  user: UsersIcon,
}

const ITEM_CLASS =
  'group/item flex cursor-pointer select-none items-center gap-3 rounded-lg px-2.5 py-2 ' +
  'text-black/80 transition-colors aria-selected:bg-black/[0.045]'

const THUMB_CLASS =
  'flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-md bg-black/5 text-black/45'

/**
 * Learner-facing command palette: a page list for jumping around the org,
 * and live results from the org search endpoint, grouped by type. Opens
 * with ⌘K / Ctrl K or the header search field.
 */
export default function SiteCommandPalette() {
  const { t } = useTranslation()
  const router = useRouter()
  const org = useOrg() as any
  const orgslug: string = org?.slug ?? ''
  const { open, setOpen } = useSiteCommandPalette()
  const { track } = useLHAnalytics('learner')
  const isMac = useIsMac()
  const [query, setQuery] = useState('')
  const shortcuts = useOptionalShortcuts()

  const lessonLocation = useCallback(
    (course: string, chapter: string) => t('search.lesson_location', { course, chapter }),
    [t],
  )
  const pages = useSitePages()
  const { results, total, isLoading, isWaiting } = useSiteSearch(query, lessonLocation)

  const trimmed = query.trim()
  const hasQuery = trimmed.length >= MIN_QUERY

  const rankedPages = useMemo(() => {
    const described = pages.map((page) => ({
      page,
      title: t(page.titleKey),
      description: page.descriptionKey ? t(page.descriptionKey) : '',
      keywords: page.keywordsKey ? t(page.keywordsKey) : '',
    }))
    const ranked = rankPages(described, query)
    // Typing narrows the page list to the best few so content stays in view.
    return (trimmed ? ranked.slice(0, 4) : ranked).map((entry) => entry.page)
  }, [pages, query, trimmed, t])

  const pageActions = useMemo(() => {
    const all = (shortcuts?.actions ?? []).filter((a) => a.group === 'page' && !a.hideFromPalette)
    const described = all.map((a) => ({ action: a, title: a.label }))
    const ranked = rankPages(described, query)
    return (trimmed ? ranked.slice(0, 4) : ranked).map((entry) => entry.action)
  }, [shortcuts?.actions, query, trimmed])

  const grouped = useMemo(() => {
    const groups = {} as Record<SiteResultType, SiteResult[]>
    for (const type of SITE_RESULT_ORDER) groups[type] = []
    for (const r of results) groups[r.type].push(r)
    return groups
  }, [results])

  const showViewAll = hasQuery && !isLoading && !isWaiting && results.length > 0
  const nothingFound =
    rankedPages.length === 0 &&
    pageActions.length === 0 &&
    results.length === 0 &&
    !isLoading &&
    !isWaiting

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!open) setQuery('')
  }, [open])

  useEffect(() => {
    if (open) track(AnalyticsEvent.CommandPaletteOpened)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const go = (href: string, resultType: string, index: number) => {
    track(AnalyticsEvent.CommandPaletteResultSelected, {
      result_type: resultType,
      result_index: index,
    })
    setOpen(false)
    router.push(href)
  }

  const openSelectedInNewTab = (root: HTMLElement | null) => {
    const selected = root?.querySelector('[cmdk-item][aria-selected="true"]') as HTMLElement | null
    const href = selected?.getAttribute('data-href')
    if (href) window.open(href, '_blank', 'noopener,noreferrer')
  }

  const searchHref = getUriWithOrg(orgslug, `/search?q=${encodeURIComponent(trimmed)}`)

  const renderPage = (page: SitePageMeta, index: number) => {
    const Icon = page.icon
    const href = getUriWithOrg(orgslug, page.href)
    return (
      <Command.Item
        key={page.id}
        value={page.id}
        onSelect={() => go(href, 'page', index)}
        className={ITEM_CLASS}
        data-href={href}
      >
        <span className={THUMB_CLASS}>
          <Icon size={17} weight="fill" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col leading-snug">
          <span className="truncate text-sm font-medium">{t(page.titleKey)}</span>
          {page.descriptionKey && (
            <span className="truncate text-xs text-black/50">{t(page.descriptionKey)}</span>
          )}
        </span>
        {page.shortcut && <Keys keys={page.shortcut} tone="muted" className="hidden sm:inline-flex" />}
        <ReturnHint />
      </Command.Item>
    )
  }

  const renderAction = (action: NonNullable<typeof shortcuts>['actions'][number], index: number) => (
    <Command.Item
      key={action.id}
      value={action.id}
      onSelect={() => {
        track(AnalyticsEvent.CommandPaletteResultSelected, { result_type: 'action', result_index: index })
        setOpen(false)
        action.run()
      }}
      className={ITEM_CLASS}
    >
      <span className={THUMB_CLASS}>
        <Zap size={16} />
      </span>
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{action.label}</span>
      <Keys keys={action.keys} tone="muted" className="hidden sm:inline-flex" />
      <ReturnHint />
    </Command.Item>
  )

  const renderResult = (r: SiteResult, index: number) => {
    const Icon = TYPE_ICON[r.type]
    return (
      <Command.Item
        key={`${r.type}-${r.id}`}
        value={`${r.type}-${r.id}`}
        onSelect={() => go(r.href, r.type, index)}
        className={ITEM_CLASS}
        data-href={r.href}
      >
        {r.type === 'user' ? (
          <span className="shrink-0">
            <UserAvatar
              width={36}
              avatar_url={r.imageUrl ?? ''}
              predefined_avatar={r.imageUrl ? undefined : 'empty'}
              userId={r.userId ?? r.id}
              showProfilePopup={false}
              rounded="rounded-full"
              backgroundColor="bg-gray-100"
            />
          </span>
        ) : (
          <span className={THUMB_CLASS}>
            {r.imageUrl ? (
              <img src={r.imageUrl} alt="" className="h-full w-full object-cover" />
            ) : r.emoji ? (
              <span className="text-base leading-none">{r.emoji}</span>
            ) : (
              <Icon size={17} />
            )}
          </span>
        )}
        <span className="flex min-w-0 flex-1 flex-col leading-snug">
          <span className="truncate text-sm font-medium">{r.title}</span>
          {r.subtitle && <span className="truncate text-xs text-black/50">{r.subtitle}</span>}
        </span>
        <ReturnHint />
      </Command.Item>
    )
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className="fixed inset-0 bg-black/30 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:duration-100 data-[state=closed]:duration-75 ease-out"
          style={{ zIndex: 'var(--z-modal-backdrop)' as any }}
        />
        <DialogPrimitive.Content
          aria-label={t('search.palette.placeholder')}
          className="fixed inset-x-3 top-[8vh] mx-auto flex max-h-[84vh] w-auto max-w-[620px] flex-col overflow-hidden rounded-2xl border border-black/5 bg-white shadow-2xl shadow-black/15 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95 data-[state=open]:duration-150 data-[state=closed]:duration-100 ease-out sm:top-[14vh]"
          style={{ zIndex: 'var(--z-modal)' as any }}
          onOpenAutoFocus={(e) => {
            e.preventDefault()
            const input = (e.currentTarget as HTMLElement).querySelector('input')
            input?.focus()
          }}
        >
          <DialogPrimitive.Title className="sr-only">
            {t('search.palette.trigger')}
          </DialogPrimitive.Title>

          <Command
            label={t('search.palette.trigger')}
            shouldFilter={false}
            className="flex min-h-0 flex-col [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-black/45"
          >
            <div className="flex items-center gap-3 border-b border-black/5 px-4 py-3.5">
              <SearchIcon size={18} className="shrink-0 text-black/40" />
              <Command.Input
                value={query}
                onValueChange={setQuery}
                placeholder={t('search.palette.placeholder')}
                autoComplete="off"
                spellCheck={false}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                    e.preventDefault()
                    e.stopPropagation()
                    const root = (e.currentTarget as HTMLElement).closest('[cmdk-root]')
                    openSelectedInNewTab(root as HTMLElement | null)
                  }
                }}
                className="min-w-0 flex-1 bg-transparent text-base text-black/85 outline-none placeholder:text-black/35 sm:text-[15px]"
              />
              {(isLoading || isWaiting) && (
                <span className="shrink-0 text-xs text-black/40">{t('search.palette.loading')}</span>
              )}
              <kbd className="hidden shrink-0 rounded-md bg-black/5 px-1.5 py-0.5 font-sans text-[10.5px] font-medium text-black/45 sm:inline-flex">
                esc
              </kbd>
            </div>

            <Command.List
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2 scroll-py-2"
              style={{ scrollbarWidth: 'thin' }}
            >
              {nothingFound && (
                <div className="px-4 py-12 text-center text-sm text-black/50">
                  {hasQuery
                    ? t('search.palette.no_results', { query: trimmed })
                    : t('search.palette.empty_hint')}
                </div>
              )}

              {pageActions.length > 0 && (
                <Command.Group heading={t('shortcuts.palette_actions')}>
                  {pageActions.map(renderAction)}
                </Command.Group>
              )}

              {rankedPages.length > 0 && (
                <Command.Group heading={t('search.palette.groups.pages')}>
                  {rankedPages.map(renderPage)}
                </Command.Group>
              )}

              {SITE_RESULT_ORDER.map((type) => {
                const items = grouped[type]
                if (items.length === 0) return null
                const groupKey = type === 'activity' ? 'activities' : `${type}s`
                return (
                  <Command.Group key={type} heading={t(`search.palette.groups.${groupKey}`)}>
                    {items.map(renderResult)}
                  </Command.Group>
                )
              })}

              {showViewAll && (
                <Command.Group>
                  <Command.Item
                    value="site.view-all"
                    onSelect={() => go(searchHref, 'view_all', total)}
                    className={`${ITEM_CLASS} mt-1 text-black/60`}
                    data-href={searchHref}
                  >
                    <span className={THUMB_CLASS}>
                      <ArrowRight size={16} />
                    </span>
                    <span className="flex-1 truncate text-sm">
                      {t('search.palette.view_all', { query: trimmed })}
                    </span>
                    <span className="text-xs text-black/40">{total}</span>
                  </Command.Item>
                </Command.Group>
              )}
            </Command.List>

            <div className="flex items-center gap-4 border-t border-black/5 bg-black/[0.02] px-4 py-2.5 text-[11.5px] text-black/45">
              <KeyHint label={t('search.palette.keys.navigate')} keys={['↑', '↓']} />
              <KeyHint label={t('search.palette.keys.open')} keys={['↵']} />
              <span className="hidden sm:contents">
                <KeyHint label={t('search.palette.keys.new_tab')} keys={[isMac ? '⌘' : 'Ctrl', '↵']} />
                <KeyHint label={t('search.palette.keys.close')} keys={['esc']} />
              </span>
              {shortcuts && (
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false)
                    shortcuts.setHelpOpen(true)
                  }}
                  className="ms-auto inline-flex items-center gap-1.5 rounded px-1 text-black/45 transition-colors hover:text-black/70"
                >
                  <kbd className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded bg-black/5 px-1 font-sans text-[10.5px] font-medium leading-none text-black/55">
                    ?
                  </kbd>
                  <span>{t('shortcuts.help')}</span>
                </button>
              )}
            </div>
          </Command>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

function ReturnHint() {
  return (
    <span className="hidden text-xs text-black/35 group-aria-selected/item:inline" aria-hidden="true">
      ↵
    </span>
  )
}

function KeyHint({ label, keys }: { label: string; keys: string[] }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {keys.map((k) => (
        <kbd
          key={k}
          className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded bg-black/5 px-1 font-sans text-[10.5px] font-medium leading-none text-black/55"
        >
          {k}
        </kbd>
      ))}
      <span>{label}</span>
    </span>
  )
}
