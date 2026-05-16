'use client'
import React, { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { Command } from 'cmdk'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import {
  BookOpen,
  Stack,
  User as UserIcon,
  ChatsCircle,
  ChatCircle,
  Cube,
  Microphone,
} from '@phosphor-icons/react'

import { useCommandPalette } from './CommandPaletteContext'
import { dashboardPages } from '@/lib/dashboard-search/registry'
import type { SearchMeta } from '@/lib/dashboard-search/types'
import {
  useContentSearch,
  type ContentResult,
  type ContentResultType,
} from '@/lib/dashboard-search/useContentSearch'
import { useOrgMembership } from '@components/Contexts/OrgContext'
import { isFeatureAvailable } from '@services/plans/plans'
import { normalizeForSearch } from '@/lib/search/normalize'

const CONTENT_TYPE_ICON: Record<ContentResultType, SearchMeta['icon']> = {
  course: BookOpen,
  collection: Stack,
  user: UserIcon,
  community: ChatsCircle,
  discussion: ChatCircle,
  playground: Cube,
  podcast: Microphone,
}

const CONTENT_TYPE_GROUP_KEY: Record<ContentResultType, string> = {
  course: 'dashboard.search.groups.courses',
  collection: 'dashboard.search.groups.collections',
  user: 'dashboard.search.groups.users',
  community: 'dashboard.search.groups.communities',
  discussion: 'dashboard.search.groups.discussions',
  playground: 'dashboard.search.groups.playgrounds',
  podcast: 'dashboard.search.groups.podcasts',
}

const CONTENT_TYPE_ORDER: ContentResultType[] = [
  'course',
  'collection',
  'user',
  'community',
  'discussion',
  'playground',
  'podcast',
]

function usePagesFiltered(): SearchMeta[] {
  const { org } = useOrgMembership()
  const resolvedFeatures = org?.config?.config?.resolved_features
  return useMemo(
    () =>
      dashboardPages.filter((p) => {
        if (!p.featureKey) return true
        const rf = resolvedFeatures?.[p.featureKey]
        if (rf) return rf.enabled
        return isFeatureAvailable(p.featureKey)
      }),
    [resolvedFeatures],
  )
}

function groupContentResults(results: ContentResult[]): Record<ContentResultType, ContentResult[]> {
  const groups: Record<ContentResultType, ContentResult[]> = {
    course: [],
    collection: [],
    user: [],
    community: [],
    discussion: [],
    playground: [],
    podcast: [],
  }
  for (const r of results) groups[r.type].push(r)
  return groups
}

export default function CommandPalette() {
  const { t } = useTranslation()
  const { open, setOpen } = useCommandPalette()
  const router = useRouter()
  const [query, setQuery] = useState('')

  const pages = usePagesFiltered()
  const { results, isLoading, isWaiting } = useContentSearch(query)
  const grouped = useMemo(() => groupContentResults(results), [results])

  // Reset state when palette closes.
  useEffect(() => {
    if (!open) setQuery('')
  }, [open])

  const onSelect = (href: string) => {
    setOpen(false)
    router.push(href)
  }

  const openSelectedInNewTab = (rootEl: HTMLElement | null) => {
    const selected = rootEl?.querySelector(
      '[cmdk-item][aria-selected="true"]',
    ) as HTMLElement | null
    const href = selected?.getAttribute('data-href')
    if (!href) return
    window.open(href, '_blank', 'noopener,noreferrer')
  }

  const renderPageItem = (p: SearchMeta) => {
    const title = t(p.titleKey)
    const description = p.descriptionKey ? t(p.descriptionKey) : undefined
    const keywords = p.keywordsKey ? t(p.keywordsKey) : ''
    const Icon = p.icon
    return (
      <Command.Item
        key={p.id}
        value={`${title} ${description ?? ''} ${keywords}`}
        onSelect={() => onSelect(p.href)}
        className="group/item flex cursor-pointer items-center gap-3.5 rounded-lg px-3 py-2.5 text-white/70 transition-colors aria-selected:bg-white/[0.06] aria-selected:text-white"
        data-href={p.href}
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-white/[0.04] text-white/60 group-aria-selected/item:bg-white/[0.08] group-aria-selected/item:text-white">
          <Icon size={15} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col leading-snug">
          <span className="truncate text-[14px] font-medium text-white/90 group-aria-selected/item:text-white">
            {title}
          </span>
          {description ? (
            <span className="truncate text-[12.5px] text-white/40">{description}</span>
          ) : null}
        </span>
        <span className="hidden text-white/40 group-aria-selected/item:inline">↵</span>
      </Command.Item>
    )
  }

  const renderContentItem = (r: ContentResult) => {
    const Icon = CONTENT_TYPE_ICON[r.type]
    return (
      <Command.Item
        key={`${r.type}-${r.id}`}
        value={`${r.title} ${r.subtitle ?? ''}`}
        onSelect={() => onSelect(r.href)}
        className="group/item flex cursor-pointer items-center gap-3.5 rounded-lg px-3 py-2.5 text-white/70 transition-colors aria-selected:bg-white/[0.06] aria-selected:text-white"
        data-href={r.href}
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-white/[0.04] text-white/60 group-aria-selected/item:bg-white/[0.08] group-aria-selected/item:text-white">
          <Icon size={15} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col leading-snug">
          <span className="truncate text-[14px] font-medium text-white/90 group-aria-selected/item:text-white">
            {r.title}
          </span>
          {r.subtitle ? (
            <span className="truncate text-[12.5px] text-white/40">{r.subtitle}</span>
          ) : null}
        </span>
        <span className="hidden text-white/40 group-aria-selected/item:inline">↵</span>
      </Command.Item>
    )
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className="fixed inset-0 bg-black/40 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:duration-100 data-[state=closed]:duration-75 ease-out"
          style={{ zIndex: 'var(--z-modal-backdrop)' as any }}
        />
        <DialogPrimitive.Content
          aria-label={t('dashboard.search.placeholder')}
          className="fixed left-1/2 top-[10%] flex w-[94vw] max-w-[760px] -translate-x-1/2 flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-black/85 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.7)] backdrop-blur-2xl backdrop-saturate-150 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95 data-[state=open]:slide-in-from-top-2 data-[state=closed]:slide-out-to-top-2 data-[state=open]:duration-150 data-[state=closed]:duration-100 ease-out"
          style={{ zIndex: 'var(--z-modal)' as any }}
          onOpenAutoFocus={(e) => {
            e.preventDefault()
            const input = (e.currentTarget as HTMLElement).querySelector('input')
            if (input) (input as HTMLInputElement).focus()
          }}
        >
          {/* Top rim highlight + soft top glow */}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent"
          />
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-white/[0.06] via-white/[0.015] to-transparent"
          />
          <DialogPrimitive.Title className="sr-only">
            {t('dashboard.search.placeholder')}
          </DialogPrimitive.Title>

          <Command
            label={t('dashboard.search.placeholder')}
            shouldFilter={true}
            filter={(value: string, search: string) => {
              const haystack = normalizeForSearch(value)
              const needle = normalizeForSearch(search)
              if (!needle) return 1
              if (haystack.includes(needle)) return 1
              const tokens = needle.split(/\s+/u).filter(Boolean)
              return tokens.every((tok: string) => haystack.includes(tok)) ? 0.8 : 0
            }}
            className="flex flex-col [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:text-[10.5px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.08em] [&_[cmdk-group-heading]]:text-white/35"
          >
            {/* Header */}
            <div className="flex items-start gap-4 px-4 sm:px-7 pt-5 sm:pt-6 pb-4 sm:pb-5">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className="text-[12px] font-medium text-white/45">
                    {t('dashboard.search.trigger')}
                  </span>
                  {(isLoading || isWaiting) && (
                    <span className="text-[11px] text-white/35">
                      · {t('dashboard.search.loading')}
                    </span>
                  )}
                </div>
                <Command.Input
                  value={query}
                  onValueChange={setQuery}
                  placeholder={t('dashboard.search.placeholder')}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                      e.preventDefault()
                      e.stopPropagation()
                      const root = (e.currentTarget as HTMLElement).closest(
                        '[cmdk-root]',
                      ) as HTMLElement | null
                      openSelectedInNewTab(root)
                    }
                  }}
                  className="w-full bg-transparent text-[18px] sm:text-[22px] font-medium leading-tight tracking-tight text-white outline-none placeholder:font-medium placeholder:text-white/35"
                />
              </div>
              <img
                src="/lrn-dash.svg"
                alt=""
                aria-hidden="true"
                draggable={false}
                className="h-8 w-8 sm:h-9 sm:w-9 shrink-0 select-none opacity-90"
              />
            </div>

            {/* Divider */}
            <div className="border-t border-white/[0.06]" />

            {/* List */}
            <Command.List
              className="min-h-[260px] max-h-[55vh] overflow-y-auto px-2 pt-1 pb-2 scroll-py-2 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/10 hover:[&::-webkit-scrollbar-thumb]:bg-white/20"
              style={{ scrollbarColor: 'rgba(255,255,255,0.15) transparent', scrollbarWidth: 'thin' }}
            >
              <Command.Empty className="px-4 py-14 text-center text-sm text-white/45">
                {isLoading || isWaiting
                  ? t('dashboard.search.loading')
                  : t('dashboard.search.no_results')}
              </Command.Empty>

              <Command.Group heading={t('dashboard.search.groups.pages')}>
                {pages.map(renderPageItem)}
              </Command.Group>

              {CONTENT_TYPE_ORDER.map((type) => {
                const items = grouped[type]
                if (items.length === 0) return null
                return (
                  <Command.Group key={type} heading={t(CONTENT_TYPE_GROUP_KEY[type])}>
                    {items.map(renderContentItem)}
                  </Command.Group>
                )
              })}
            </Command.List>

            {/* Footer */}
            <div className="flex items-center gap-3 sm:gap-5 border-t border-white/[0.06] bg-black/20 px-4 sm:px-7 py-3 text-[12px] text-white/40">
              <FooterHint label="Navigate" keys={['↑', '↓']} />
              <FooterHint label="Open" keys={['↵']} />
              <span className="hidden sm:contents">
                <FooterHint label="New tab" keys={['⌘', '↵']} />
                <FooterHint label="Close" keys={['esc']} />
              </span>
            </div>
          </Command>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

function FooterHint({ label, keys }: { label: string; keys: string[] }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span>{label}</span>
      {keys.map((k) => (
        <kbd
          key={k}
          className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded bg-white/[0.06] px-1 font-sans text-[10.5px] font-medium leading-none text-white/55"
        >
          {k}
        </kbd>
      ))}
    </span>
  )
}
