'use client'
import React from 'react'
import useSWR from 'swr'
import { useTranslation } from 'react-i18next'
import { Books, FolderSimple, Info, Stack, Tray, Image as ImageIcon } from '@phosphor-icons/react'
import AuthenticatedClientElement from '@components/Security/AuthenticatedClientElement'
import {
  Button,
  EmptyState,
  SearchInput,
  SegmentedControl,
  StatCard,
  ViewToggle,
  useStoredState,
} from '@components/Dashboard/Shared/DashKit/DashKit'
import FolderSortDropdown, { type FolderSortMode } from '@components/Dashboard/Library/FolderSortDropdown'
import LibraryGrid from '@components/Dashboard/Library/LibraryGrid'
import LibrarySearchResults from '@components/Dashboard/Library/LibrarySearchResults'
import { filterLibrary, sortLibrary, type FilterKey } from '@components/Dashboard/Library/LibraryHeader'
import { LibraryGridSkeleton, LibraryListSkeleton } from '@components/Dashboard/Library/libraryItems'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { searchLibrary } from '@services/folders/folders'

const VIEW_MODES = ['grid', 'list'] as const

type Props = {
  orgslug: string
  org_id: number
  folders: any[]
  items: any[]
  loading: boolean
  sortMode: FolderSortMode
  onSortChange: (_mode: FolderSortMode) => void
  /** Manual sort is on and the viewer may reorder. */
  isManual: boolean
  onChanged: () => void
  onRemoveItem: (_item: any) => void | Promise<void>
  onDeleteFolder: (_folder: any) => void | Promise<void>
  onReorderFolders?: (_folders: any[]) => void
  onReorderItems?: (_items: any[]) => void
  emptyTitle: string
  emptyDescription?: string
  emptyAction?: React.ReactNode
}

// Small debounce so typing doesn't fire a search request per keystroke.
function useDebounced<T>(value: T, delay = 250) {
  const [debounced, setDebounced] = React.useState(value)
  React.useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(id)
  }, [value, delay])
  return debounced
}

// Stats, toolbar and content for the library root and for a folder.
export default function LibraryBrowser({
  orgslug,
  org_id,
  folders,
  items,
  loading,
  sortMode,
  onSortChange,
  isManual,
  onChanged,
  onRemoveItem,
  onDeleteFolder,
  onReorderFolders,
  onReorderItems,
  emptyTitle,
  emptyDescription,
  emptyAction,
}: Props) {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token

  const [query, setQuery] = React.useState('')
  const [filter, setFilter] = React.useState<FilterKey>('all')
  const [view, setView] = useStoredState<'grid' | 'list'>('lh_dash_library_view', 'grid', VIEW_MODES)
  const search = useDebounced(query.trim())
  // The API needs at least two characters to search.
  const searching = query.trim().length >= 2

  // Search spans the whole library, not just this folder.
  const { data: searchData, isLoading: searchLoading, mutate: mutateSearch } = useSWR(
    search.length >= 2 && org_id ? ['library-search', org_id, search] : null,
    () => searchLibrary(org_id, search, access_token),
    { keepPreviousData: true }
  )

  const stats = React.useMemo(
    () => ({
      folders: folders.length,
      courses: items.filter((i) => i.resource_type === 'courses').length,
      media: items.filter((i) => i.resource_type === 'media').length,
      total: folders.length + items.length,
    }),
    [folders, items]
  )

  const filtered = filterLibrary(folders, items, '', filter)
  // Sort client-side so the chosen mode reorders folders AND content instantly.
  const { folders: visibleFolders, items: visibleItems } = sortLibrary(filtered.visibleFolders, filtered.visibleItems, sortMode)
  const filteredSearch = searchData
    ? filterLibrary(searchData.folders ?? [], searchData.items ?? [], '', filter)
    : null

  const toggle = (key: FilterKey) => setFilter(filter === key ? 'all' : key)
  const clearFilters = () => {
    setFilter('all')
    setQuery('')
  }
  const hasFilter = filter !== 'all'
  const isEmpty = visibleFolders.length === 0 && visibleItems.length === 0

  return (
    <div className="flex flex-col gap-5">
      {/* Stats double as type filters */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          icon={<Stack size={16} />}
          iconClass="bg-neutral-100 text-neutral-600"
          label={t('library.dash.stats.total')}
          value={loading ? null : stats.total}
          active={!hasFilter}
          onClick={() => setFilter('all')}
        />
        <StatCard
          icon={<FolderSimple size={16} />}
          iconClass="bg-violet-50 text-violet-600"
          label={t('library.folders')}
          value={loading ? null : stats.folders}
          active={filter === 'folders'}
          onClick={() => toggle('folders')}
        />
        <StatCard
          icon={<Books size={16} />}
          iconClass="bg-sky-50 text-sky-600"
          label={t('library.tabs.courses')}
          value={loading ? null : stats.courses}
          active={filter === 'courses'}
          onClick={() => toggle('courses')}
        />
        <StatCard
          icon={<ImageIcon size={16} />}
          iconClass="bg-amber-50 text-amber-600"
          label={t('media.media')}
          value={loading ? null : stats.media}
          active={filter === 'media'}
          onClick={() => toggle('media')}
        />
      </div>

      {/* Toolbar */}
      <div className="flex flex-col xl:flex-row gap-3 xl:items-center">
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder={t('library.dash.search_placeholder')}
          className="xl:max-w-md"
        />
        <div className="flex flex-wrap items-center gap-2 xl:ms-auto">
          <SegmentedControl<FilterKey>
            value={filter}
            onChange={setFilter}
            ariaLabel={t('library.dash.type_filter')}
            options={[
              { key: 'all', label: t('library.filters.all') },
              { key: 'folders', label: t('library.filters.folders') },
              { key: 'courses', label: t('library.filters.courses') },
              { key: 'media', label: t('library.filters.media') },
            ]}
          />
          <AuthenticatedClientElement checkMethod="roles" action="update" ressourceType={'folders' as any} orgId={org_id}>
            <FolderSortDropdown value={sortMode} onChange={onSortChange} />
          </AuthenticatedClientElement>
          <ViewToggle value={view} onChange={setView} />
        </div>
      </div>

      {/* Manual order can only be dragged in the grid. */}
      {isManual && !searching && !isEmpty && (
        <p className="-mt-1 flex items-center gap-1.5 text-xs text-neutral-500">
          <Info size={13} className="shrink-0" />
          {view === 'grid' ? t('library.dash.manual_hint_grid') : t('library.dash.manual_hint_list')}
        </p>
      )}

      {searching ? (
        <LibrarySearchResults
          results={filteredSearch ? { folders: filteredSearch.visibleFolders, items: filteredSearch.visibleItems } : null}
          isLoading={searchLoading || search !== query.trim()}
          orgslug={orgslug}
          org_id={org_id}
          view={view}
          onChanged={() => {
            mutateSearch()
            onChanged()
          }}
          onClear={() => setQuery('')}
        />
      ) : loading ? (
        view === 'grid' ? (
          <LibraryGridSkeleton />
        ) : (
          <LibraryListSkeleton />
        )
      ) : isEmpty ? (
        <div className="bg-white rounded-2xl nice-shadow">
          {hasFilter ? (
            <EmptyState
              icon={<Tray size={22} />}
              title={t('library.no_results')}
              description={t('library.dash.no_filter_results_description')}
              action={
                <Button size="sm" onClick={clearFilters}>
                  {t('library.dash.clear_filters')}
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={<FolderSimple size={22} />}
              title={emptyTitle}
              description={emptyDescription}
              action={emptyAction}
            />
          )}
        </div>
      ) : (
        <LibraryGrid
          folders={visibleFolders}
          items={visibleItems}
          orgslug={orgslug}
          org_id={org_id}
          view={view}
          onChanged={onChanged}
          onRemoveItem={onRemoveItem}
          onDeleteFolder={onDeleteFolder}
          // Reordering a filtered subset would drop the hidden entries' places.
          isManual={isManual && !hasFilter}
          onReorderFolders={onReorderFolders}
          onReorderItems={onReorderItems}
        />
      )}
    </div>
  )
}
