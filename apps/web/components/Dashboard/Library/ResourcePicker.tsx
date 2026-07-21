'use client'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getAPIUrl } from '@services/config/config'
import { apiFetch } from '@services/utils/ts/requests'
import { addFolderContent, addOrgRootContent } from '@services/folders/folders'
import {
  BookCopy,
  Podcast,
  Users,
  LayoutGrid,
  Gamepad2,
  Search,
  Check,
  Plus,
  Loader2,
} from 'lucide-react'
import React from 'react'
import toast from 'react-hot-toast'
import useSWR from 'swr'
import { useTranslation } from 'react-i18next'
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics'

export type TabKey = 'courses' | 'podcasts' | 'communities' | 'boards' | 'playgrounds'

// Singular resource kind stored on a resource activity's content.resource_type,
// used by the student renderer to build the correct resource route.
export type ResourceKind = 'course' | 'podcast' | 'community' | 'board' | 'playground'

export const TAB_META: Record<
  TabKey,
  { feature: string; icon: any; uuidKey: string; kind: ResourceKind }
> = {
  courses: { feature: 'courses', icon: BookCopy, uuidKey: 'course_uuid', kind: 'course' },
  podcasts: { feature: 'podcasts', icon: Podcast, uuidKey: 'podcast_uuid', kind: 'podcast' },
  communities: { feature: 'communities', icon: Users, uuidKey: 'community_uuid', kind: 'community' },
  boards: { feature: 'boards', icon: LayoutGrid, uuidKey: 'board_uuid', kind: 'board' },
  playgrounds: { feature: 'playgrounds', icon: Gamepad2, uuidKey: 'playground_uuid', kind: 'playground' },
}

export function endpointFor(tab: TabKey, orgslug: string, org_id: any): string {
  switch (tab) {
    case 'courses':
      // include_unpublished so drafts show too (this is an admin/editor context).
      return `${getAPIUrl()}courses/org_slug/${orgslug}/page/1/limit/100?include_unpublished=true`
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
    })
  }

  return (
    <div>
      <div className="relative mb-3">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('library.search')}
          className="w-full pl-10 pr-3 py-2 bg-white nice-shadow rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-black/10 border-0"
        />
      </div>

      {isLoading ? (
        <div className="py-10 flex justify-center text-gray-400">
          <Loader2 className="w-6 h-6 animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-10 text-center text-sm text-gray-400">{t('library.no_resources')}</div>
      ) : (
        <div className="flex flex-col gap-1.5 max-h-[400px] overflow-y-auto">
          {filtered.map((item) => {
            const uuid = item[uuidKey]
            const isAdded = added.has(uuid)
            const isSelected = mode === 'select' && selectedUuid === uuid
            return (
              <div
                key={uuid}
                className={`flex items-center justify-between px-3 py-2.5 rounded-lg border transition-colors ${
                  isSelected ? 'border-black bg-gray-50' : 'border-gray-100 hover:bg-gray-50'
                }`}
              >
                <span className="text-sm font-medium text-gray-800 truncate pr-3">{item.name}</span>
                {mode === 'add' ? (
                  isAdded ? (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-600">
                      <Check className="w-4 h-4" /> {t('library.added')}
                    </span>
                  ) : (
                    <button
                      onClick={() => handleAdd(uuid)}
                      disabled={pending === uuid}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-black px-3 py-1.5 text-xs font-semibold text-white nice-shadow hover:bg-neutral-800 transition-colors disabled:opacity-50"
                    >
                      {pending === uuid ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Plus className="w-3.5 h-3.5" />
                      )}
                      {t('library.add')}
                    </button>
                  )
                ) : (
                  <button
                    onClick={() => handleSelect(item)}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold nice-shadow transition-colors ${
                      isSelected
                        ? 'bg-green-600 text-white'
                        : 'bg-black text-white hover:bg-neutral-800'
                    }`}
                  >
                    {isSelected ? <Check className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                    {isSelected ? t('library.added') : t('library.add')}
                  </button>
                )}
              </div>
            )
          })}
        </div>
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
      className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
        active
          ? 'border-black text-gray-900'
          : 'border-transparent text-gray-400 hover:text-gray-600'
      }`}
    >
      <Icon className="w-4 h-4" />
      {t(`library.tabs.${tab}`)}
      {count !== undefined && (
        <span
          className={`ml-1 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[11px] font-semibold ${
            active ? 'bg-black text-white' : 'bg-gray-100 text-gray-500'
          }`}
        >
          {count}
        </span>
      )}
    </button>
  )
}

type ResourcePickerProps = {
  orgslug: string
  mode: 'add' | 'select'
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
  folderUuid,
  onChanged,
  onSelect,
  selectedUuid,
}: ResourcePickerProps) {
  const org = useOrg() as any

  const enabledTabs = (Object.keys(TAB_META) as TabKey[]).filter((tab) => {
    const feature = TAB_META[tab].feature
    return org?.config?.config?.resolved_features?.[feature]?.enabled ?? true
  })

  const [activeTab, setActiveTab] = React.useState<TabKey>(enabledTabs[0] || 'courses')

  return (
    <div>
      <div className="flex gap-1 mb-4 border-b border-gray-100 overflow-x-auto">
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
