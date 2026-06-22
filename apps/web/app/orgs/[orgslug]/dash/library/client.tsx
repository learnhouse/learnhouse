'use client'
import LibraryGrid from '@components/Dashboard/Library/LibraryGrid'
import LibraryHeader, { filterLibrary, type FilterKey } from '@components/Dashboard/Library/LibraryHeader'
import LibrarySearchResults from '@components/Dashboard/Library/LibrarySearchResults'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getOrgFolders, getOrgRootItems, removeOrgRootContent, searchLibrary } from '@services/folders/folders'
import React from 'react'
import toast from 'react-hot-toast'
import useSWR from 'swr'
import { useTranslation } from 'react-i18next'

type Props = {
  orgslug: string
  org_id: number
  initialFolders: any[]
}

function LibraryHome({ orgslug, org_id, initialFolders }: Props) {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token

  const [query, setQuery] = React.useState('')
  const [filter, setFilter] = React.useState<FilterKey>('all')
  const searching = query.trim().length > 0

  const { data: folders, mutate: mutateFolders } = useSWR(
    org_id ? ['folders', org_id, 'root'] : null,
    () => getOrgFolders(org_id, access_token, { revalidate: 60, tags: ['folders'] }),
    { fallbackData: initialFolders }
  )
  const { data: rootItems, mutate: mutateItems } = useSWR(
    org_id && access_token ? ['library-root-items', org_id] : null,
    () => getOrgRootItems(org_id, access_token)
  )
  const { data: searchData, isLoading: searchLoading, mutate: mutateSearch } = useSWR(
    searching && org_id ? ['library-search', org_id, query.trim()] : null,
    () => searchLibrary(org_id, query.trim(), access_token)
  )

  const refresh = () => {
    mutateFolders()
    mutateItems()
    if (searching) mutateSearch()
  }

  const folderList: any[] = Array.isArray(folders) ? folders : folders?.data ?? []
  const itemList: any[] = Array.isArray(rootItems) ? rootItems : rootItems?.data ?? []
  const { visibleFolders, visibleItems } = filterLibrary(folderList, itemList, '', filter)

  // Apply the active filter pill to search results too.
  const filteredSearch = searchData
    ? filterLibrary(searchData.folders || [], searchData.items || [], '', filter)
    : null

  const handleRemove = async (resourceUuid: string) => {
    try {
      await removeOrgRootContent(org_id, resourceUuid, access_token)
      toast.success(t('library.content_removed'))
      refresh()
    } catch (error: any) {
      toast.error(error?.message || t('library.content_remove_error'))
    }
  }

  return (
    <div className="flex w-full">
      <div className="pl-4 sm:pl-10 mr-4 sm:mr-10 tracking-tight flex flex-col space-y-5 w-full">
        <LibraryHeader
          orgslug={orgslug}
          org_id={org_id}
          query={query}
          setQuery={setQuery}
          filter={filter}
          setFilter={setFilter}
          onChanged={refresh}
        />

        {searching ? (
          <LibrarySearchResults
            results={filteredSearch ? { folders: filteredSearch.visibleFolders, items: filteredSearch.visibleItems } : null}
            isLoading={searchLoading}
            orgslug={orgslug}
            org_id={org_id}
            onChanged={refresh}
          />
        ) : (
          <LibraryGrid
            folders={visibleFolders}
            items={visibleItems}
            orgslug={orgslug}
            org_id={org_id}
            onChanged={refresh}
            onRemoveItem={handleRemove}
            emptyTitle={filter !== 'all' ? t('library.no_results') : t('library.no_items')}
            emptyDescription={filter !== 'all' ? undefined : t('library.no_items_description')}
            emptyAction={undefined}
          />
        )}
      </div>
    </div>
  )
}

export default LibraryHome
