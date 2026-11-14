'use client'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getAPIUrl } from '@services/config/config'
import { apiFetch } from '@services/utils/ts/requests'
import { addFolderContent, addOrgRootContent } from '@services/folders/folders'
import {
  Books,
  MicrophoneStage,
  SquaresFour,
  Lightning,
  MagnifyingGlass,
  Check,
  Plus,
  Tray,
  File as FileIcon,
  Garage,
} from '@phosphor-icons/react'
import { Button, Chip, INPUT } from '@components/Dashboard/Shared/DashKit/DashKit'
import MediaPreview from '@components/Dashboard/Library/MediaPreview'
import React from 'react'
import toast from 'react-hot-toast'
import useSWR from 'swr'
import { useTranslation } from 'react-i18next'
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics'

export type TabKey = 'courses' | 'podcasts' | 'communities' | 'boards' | 'playgrounds' | 'media'

// Singular resource kind stored on a resource activity's content.resource_type,
// used by the student renderer to build the correct resource route.
export type ResourceKind = 'course' | 'podcast' | 'community' | 'board' | 'playground' | 'media'

export const TAB_META: Record<
  TabKey,
  { feature: string; icon: any; uuidKey: string; kind: ResourceKind }
> = {
  courses: { feature: 'courses', icon: Books, uuidKey: 'course_uuid', kind: 'course' },
  media: { feature: 'library', icon: FileIcon, uuidKey: 'media_uuid', kind: 'media' },
  podcasts: { feature: 'podcasts', icon: MicrophoneStage, uuidKey: 'podcast_uuid', kind: 'podcast' },
  communities: { feature: 'communities', icon: Garage, uuidKey: 'community_uuid', kind: 'community' },
  boards: { feature: 'boards', icon: SquaresFour, uuidKey: 'board_uuid', kind: 'board' },
  playgrounds: { feature: 'playgrounds', icon: Lightning, uuidKey: 'playground_uuid', kind: 'playground' },
}

export function endpointFor(tab: TabKey, orgslug: string, org_id: any): string {
  switch (tab) {
    case 'courses':
      // include_unpublished so drafts show too (this is an admin/editor context).
      return `${getAPIUrl()}courses/org_slug/${orgslug}/page/1/limit/100?include_unpublished=true`
    case 'media':
      return `${getAPIUrl()}media/org/${org_id}/page/1/limit/100`
    case 'podcasts':
      return `${getAPIUrl()}podcasts/org_slug/${orgslug}/page/1/limit/100`
    case 'communities':
      return `${getAPIUrl()}communities/org/${org_id}/page/1/limit/100`
    case 'boards':
      return `${getAPIUrl()}boards/org/${org_id}`
    case 'playgrounds':
      return `${getAPIUrl()}playgrounds/org/${org_id}`
  }
}

export type SelectedResource = {
  resource_uuid: string
  resource_type: ResourceKind
  name?: string
  /** The full row, so callers can cache display metadata without a refetch. */
  resource?: any
}

type ResourceListProps = {
  tab: TabKey
  orgslug: string
  mode: 'add' | 'select'
  // add mode
  folderUuid?: string
  onChanged?: () => void
  // select mode
  onSelect?: (_resource: SelectedResource) => void
  selectedUuid?: string
}

function ResourceList({
  tab,
  orgslug,
  mode,
  folderUuid,
  onChanged,
  onSelect,
  selectedUuid,
}: ResourceListProps) {
  const { t } = useTranslation()
  const org = useOrg() as any
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const { track } = useLHAnalytics('dashboard')
  const [query, setQuery] = React.useState('')
  const [added, setAdded] = React.useState<Set<string>>(new Set())
  const [pending, setPending] = React.useState<string | null>(null)

  const { data, isLoading } = useSWR(
    org?.id ? endpointFor(tab, orgslug, org.id) : null,
    (url: string) => apiFetch(url, access_token)
  )

  const items: any[] = Array.isArray(data) ? data : data?.data ?? []
  const uuidKey = TAB_META[tab].uuidKey

  const filtered = query.trim()
    ? items.filter((it) => (it.name || '').toLowerCase().includes(query.toLowerCase()))
    : items

  const handleAdd = async (resourceUuid: string) => {
    setPending(resourceUuid)
    try {
      if (folderUuid) {
        await addFolderContent(folderUuid, resourceUuid, access_token)
      } else {
        await addOrgRootContent(org?.id, resourceUuid, access_token)
      }
      setAdded((prev) => new Set(prev).add(resourceUuid))
      track(AnalyticsEvent.LibraryContentAdded, {
        resource_type: tab,
        target: folderUuid ? 'folder' : 'root',
      })
      toast.success(t('library.content_added'))
      onChanged?.()
    } catch (error: any) {
      toast.error(error?.message || t('library.content_add_error'))
    } finally {
      setPending(null)
    }
  }

  const handleSelect = (item: any) => {
    onSelect?.({
      resource_uuid: item[uuidKey],
      resource_type: TAB_META[tab].kind,
      name: item.name,
      resource: item,
    })
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <MagnifyingGlass size={15} className="absolute start-3 top-1/2 -translate-y-1/2 text-neutral-400" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('library.dash.search_resources', { type: t(`library.tabs.${tab}`).toLowerCase() })}
          className={`${INPUT} ps-9`}
        />
      </div>

      {isLoading ? (
        <div className="rounded-xl ring-1 ring-inset ring-neutral-200 divide-y divide-neutral-100 animate-pulse">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-3.5 py-3">
              <div className="w-7 h-7 rounded-lg bg-neutral-100" />
              <div className="h-3.5 flex-1 max-w-[50%] rounded bg-neutral-100" />
              <div className="h-7 w-14 rounded-md bg-neutral-100" />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-10 text-center rounded-xl ring-1 ring-inset ring-neutral-200">
          <span className="w-10 h-10 rounded-xl bg-neutral-100 text-neutral-400 flex items-center justify-center">
            <Tray size={18} />
          </span>
          <p className="text-sm text-neutral-500">{query.trim() ? t('library.no_results') : t('library.no_resources')}</p>
        </div>
      ) : tab === 'media' ? (
        // Files need to be recognisable, so media gets thumbnails instead of rows.
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-h-[400px] overflow-y-auto p-0.5 pe-1">
          {filtered.map((item) => {
            const uuid = item[uuidKey]
            const isAdded = added.has(uuid)
            const isSelected = mode === 'select' && selectedUuid === uuid
            return (
              <button
                key={uuid}
                type="button"
                onClick={() => (mode === 'add' ? handleAdd(uuid) : handleSelect(item))}
                disabled={pending === uuid}
                aria-pressed={isSelected || isAdded}
                className={`group text-start rounded-xl overflow-hidden bg-white transition-shadow disabled:opacity-50 ${
                  isSelected || isAdded ? 'ring-2 ring-neutral-900' : 'ring-1 ring-neutral-200 hover:ring-neutral-300'
                }`}
              >
                <MediaPreview resource={item} resourceUuid={uuid} />
                <div className="p-2 flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-neutral-800 truncate">{item.name}</span>
                  {isAdded || isSelected ? (
                    <Check size={14} weight="bold" className="text-emerald-600 shrink-0" />
                  ) : (
                    <Plus size={14} className="text-neutral-400 shrink-0" />
                  )}
                </div>
                {item.public === false && (
                  <p className="px-2 pb-2 text-[10px] text-amber-600 leading-tight">{t('library.private_media_warning')}</p>
                )}
              </button>
            )
          })}
        </div>
      ) : (
        <ul className="rounded-xl ring-1 ring-inset ring-neutral-200 divide-y divide-neutral-100 max-h-[400px] overflow-y-auto">
          {filtered.map((item) => {
            const uuid = item[uuidKey]
            const isAdded = added.has(uuid)
            const isSelected = mode === 'select' && selectedUuid === uuid
            const Icon = TAB_META[tab].icon
            return (
              <li
                key={uuid}
                className={`flex items-center gap-3 px-3.5 py-2.5 transition-colors ${isSelected ? 'bg-neutral-50' : 'hover:bg-neutral-50/70'}`}
              >
                <span className="w-7 h-7 rounded-lg bg-neutral-100 text-neutral-500 flex items-center justify-center shrink-0">
                  <Icon size={15} />
                </span>
                <span className="text-sm font-medium text-neutral-800 truncate flex-1 min-w-0" dir="auto">
                  {item.name}
                </span>
                {mode === 'add' ? (
                  isAdded ? (
                    <Chip tone="emerald" icon={<Check size={12} weight="bold" />}>{t('library.added')}</Chip>
                  ) : (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => handleAdd(uuid)}
                      loading={pending === uuid}
                      icon={<Plus size={12} />}
                    >
                      {t('library.add')}
                    </Button>
                  )
                ) : isSelected ? (
                  <Chip tone="emerald" icon={<Check size={12} weight="bold" />}>{t('library.added')}</Chip>
                ) : (
                  <Button size="sm" variant="secondary" onClick={() => handleSelect(item)} icon={<Plus size={12} />}>
                    {t('library.add')}
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function TabButton({
  tab,
  orgslug,
  active,
  onClick,
}: {
  tab: TabKey
  orgslug: string
  active: boolean
  onClick: () => void
}) {
  const { t } = useTranslation()
  const org = useOrg() as any
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const Icon = TAB_META[tab].icon

  // Prefetch each tab's data so we can show a count and warm the cache. SWR
  // dedupes this against the active tab's ResourceList fetch (same key).
  const { data } = useSWR(
    org?.id ? endpointFor(tab, orgslug, org.id) : null,
    (url: string) => apiFetch(url, access_token)
  )
  const count = Array.isArray(data) ? data.length : data?.data?.length

  return (
    <button
      type="button"
      onClick={onClick}
      role="tab"
      aria-selected={active}
      className={`flex items-center gap-1.5 px-1 py-2.5 text-sm font-semibold border-b-2 transition-colors -mb-px whitespace-nowrap ${
        active
          ? 'border-neutral-900 text-neutral-900'
          : 'border-transparent text-neutral-500 hover:text-neutral-800'
      }`}
    >
      <Icon size={15} />
      {t(`library.tabs.${tab}`)}
      {count !== undefined && (
        <span
          className={`ms-0.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[11px] font-semibold tabular-nums ${
            active ? 'bg-neutral-900 text-white' : 'bg-neutral-100 text-neutral-500'
          }`}
        >
          {count}
        </span>
      )}
    </button>
  )
}

// The library "add content" flow places existing resources into a folder, and
// media already lives in the library, so offering it there would just file the
// same asset twice. Callers that want media (the Library block) opt in.
const DEFAULT_TABS: TabKey[] = ['courses', 'podcasts', 'communities', 'boards', 'playgrounds']

type ResourcePickerProps = {
  orgslug: string
  mode: 'add' | 'select'
  /** Which tabs to offer; defaults to every resource type except media. */
  tabs?: TabKey[]
  // add mode
  folderUuid?: string
  onChanged?: () => void
  // select mode
  onSelect?: (_resource: SelectedResource) => void
  selectedUuid?: string
}

function ResourcePicker({
  orgslug,
  mode,
  tabs = DEFAULT_TABS,
  folderUuid,
  onChanged,
  onSelect,
  selectedUuid,
}: ResourcePickerProps) {
  const org = useOrg() as any

  const enabledTabs = tabs.filter((tab) => {
    const feature = TAB_META[tab].feature
    return org?.config?.config?.resolved_features?.[feature]?.enabled ?? true
  })

  const [activeTab, setActiveTab] = React.useState<TabKey>(enabledTabs[0] || 'courses')

  return (
    <div>
      <div role="tablist" className="flex gap-4 mb-4 border-b border-neutral-100 overflow-x-auto scrollbar-hide">
        {enabledTabs.map((tab) => (
          <TabButton
            key={tab}
            tab={tab}
            orgslug={orgslug}
            active={activeTab === tab}
            onClick={() => setActiveTab(tab)}
          />
        ))}
      </div>

      <ResourceList
        tab={activeTab}
        orgslug={orgslug}
        mode={mode}
        folderUuid={folderUuid}
        onChanged={onChanged}
        onSelect={onSelect}
        selectedUuid={selectedUuid}
      />
    </div>
  )
}

export default ResourcePicker
