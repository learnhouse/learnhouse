'use client'
import React, { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { Command } from 'cmdk'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import {
  MagnifyingGlass,
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
  const { results, isLoading, isWaiting, enabled } = useContentSearch(query)

  const grouped = useMemo(() => groupContentResults(results), [results])

  const onSelect = (href: string) => {
    setOpen(false)
    setQuery('')
    router.push(href)
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
        className="group flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm text-gray-700 aria-selected:bg-gray-100 aria-selected:text-gray-900"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-gray-100 text-gray-600 group-aria-selected:bg-white">
          <Icon size={16} />
        </span>
        <span className="flex flex-1 flex-col">
          <span className="font-medium leading-tight">{title}</span>
          {description ? (
            <span className="text-xs text-gray-500 leading-tight">{description}</span>
          ) : null}
        </span>
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
        className="group flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm text-gray-700 aria-selected:bg-gray-100 aria-selected:text-gray-900"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-gray-100 text-gray-600 group-aria-selected:bg-white">
          <Icon size={16} />
        </span>
        <span className="flex flex-1 flex-col min-w-0">
          <span className="truncate font-medium leading-tight">{r.title}</span>
          {r.subtitle ? (
            <span className="truncate text-xs text-gray-500 leading-tight">{r.subtitle}</span>
          ) : null}
        </span>
      </Command.Item>
    )
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className="fixed inset-0 bg-black/40"
          style={{ zIndex: 'var(--z-modal-backdrop)' as any }}
        />
        <DialogPrimitive.Content
          aria-label={t('dashboard.search.placeholder')}
          className="fixed left-1/2 top-[20%] w-[92vw] max-w-[640px] -translate-x-1/2 overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-2xl shadow-black/10"
          style={{ zIndex: 'var(--z-modal)' as any }}
          onOpenAutoFocus={(e) => {
            e.preventDefault()
            const input = (e.currentTarget as HTMLElement).querySelector('input')
            if (input) (input as HTMLInputElement).focus()
          }}
        >
          <DialogPrimitive.Title className="sr-only">
            {t('dashboard.search.placeholder')}
          </DialogPrimitive.Title>

          <Command
            label={t('dashboard.search.placeholder')}
            shouldFilter={true}
            filter={(value, search, keywords) => {
              const haystack = `${value} ${(keywords ?? []).join(' ')}`.toLowerCase()
              const needle = search.toLowerCase().trim()
              if (!needle) return 1
              if (haystack.includes(needle)) return 1
              const tokens = needle.split(/\s+/).filter(Boolean)
              return tokens.every((tok) => haystack.includes(tok)) ? 0.8 : 0
            }}
          >
            <div className="flex items-center gap-3 border-b border-gray-100 px-4 py-3">
              <MagnifyingGlass size={18} className="text-gray-400" />
              <Command.Input
                value={query}
                onValueChange={setQuery}
                placeholder={t('dashboard.search.placeholder')}
                className="flex-1 bg-transparent text-sm text-gray-800 outline-none placeholder:text-gray-400"
              />
              <kbd className="hidden sm:inline-flex h-5 items-center rounded border border-gray-200 bg-gray-50 px-1.5 text-[10px] font-medium text-gray-500">
                ESC
              </kbd>
            </div>

            <Command.List className="max-h-[60vh] overflow-y-auto p-2">
              <Command.Empty className="px-4 py-8 text-center text-sm text-gray-500">
                {isLoading || isWaiting
                  ? t('dashboard.search.loading')
                  : t('dashboard.search.no_results')}
              </Command.Empty>

              <Command.Group
                heading={t('dashboard.search.groups.pages')}
                className="px-1 pt-1 pb-2 text-[11px] font-medium uppercase tracking-wide text-gray-400 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5"
              >
                {pages.map(renderPageItem)}
              </Command.Group>

              {enabled && results.length > 0 && (
                <>
                  {(['course', 'collection', 'user', 'community', 'discussion', 'playground', 'podcast'] as ContentResultType[]).map(
                    (type) => {
                      const items = grouped[type]
                      if (items.length === 0) return null
                      return (
                        <Command.Group
                          key={type}
                          heading={t(CONTENT_TYPE_GROUP_KEY[type])}
                          className="px-1 pt-1 pb-2 text-[11px] font-medium uppercase tracking-wide text-gray-400 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5"
                        >
                          {items.map(renderContentItem)}
                        </Command.Group>
                      )
                    },
                  )}
                </>
              )}
            </Command.List>
          </Command>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
