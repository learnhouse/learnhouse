'use client'
import { Breadcrumbs } from '@components/Objects/Breadcrumbs/Breadcrumbs'
import AuthenticatedClientElement from '@components/Security/AuthenticatedClientElement'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import ManageAccessPopover from '@components/Dashboard/Library/ManageAccessPopover'
import LibraryGrid from '@components/Dashboard/Library/LibraryGrid'
import LibraryHeader, { filterLibrary, sortLibrary, type FilterKey } from '@components/Dashboard/Library/LibraryHeader'
import { type FolderSortMode } from '@components/Dashboard/Library/FolderSortDropdown'
import LibrarySearchResults from '@components/Dashboard/Library/LibrarySearchResults'
import { shareFolderLink } from '@components/Dashboard/Library/shareFolder'
import { SECONDARY_BTN } from '@components/Dashboard/Library/LibraryToolbar'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import useAdminStatus from '@components/Hooks/useAdminStatus'
import { getFolderById, removeFolderContent, removeFolderPrefix, reorderFolders, reorderFolderContent, searchLibrary } from '@services/folders/folders'
import { updateOrgFoldersSort } from '@services/organizations/orgs'
import { getUriWithOrg } from '@services/config/config'
import { FolderSimple, LinkSimple, Lock } from '@phosphor-icons/react'
import React from 'react'
import toast from 'react-hot-toast'
import useSWR from 'swr'
import { useTranslation } from 'react-i18next'

type Props = {
  orgslug: string
  org_id: number
  folderid: string
  initialFolder: any
}

function FolderView({ orgslug, org_id, folderid, initialFolder }: Props) {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const org = useOrg() as any

  const [accessOpen, setAccessOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const [filter, setFilter] = React.useState<FilterKey>('all')
  const searching = query.trim().length > 0

  // Sort mode is persisted server-side in the org config (shared with the root
  // library view); seed local state from it and keep it in sync.
  const configSortMode: FolderSortMode =
    org?.config?.config?.general?.folders?.sort_mode ?? 'name_asc'
  const [sortMode, setSortMode] = React.useState<FolderSortMode>(configSortMode)
  React.useEffect(() => {
    setSortMode(configSortMode)
  }, [configSortMode])

  // Only admins (folders:update) can rearrange subfolders; everyone else sees
  // the resulting server-side order read-only.
  const { rights } = useAdminStatus()
  const canReorder = rights?.folders?.action_update === true
  const isManual = sortMode === 'manual' && canReorder

  const { data: folder, mutate } = useSWR(
    folderid && access_token ? ['folder', folderid] : null,
    () => getFolderById('folder_' + folderid, access_token, { revalidate: 0, tags: ['folders'] }),
    { fallbackData: initialFolder }
  )
  const { data: searchData, isLoading: searchLoading, mutate: mutateSearch } = useSWR(
    searching && org_id ? ['library-search', org_id, query.trim()] : null,
    () => searchLibrary(org_id, query.trim(), access_token)
  )

  const refresh = () => {
    mutate()
    if (searching) mutateSearch()
  }

  if (!folder) {
    return (
      <div className="ps-4 sm:ps-10 me-4 sm:me-10 pt-6">
        <p className="text-gray-400">{t('library.folder_not_found')}</p>
      </div>
    )
  }

  const folderUuid = folder.folder_uuid
  const subfolders: any[] = folder.subfolders || []
  const items: any[] = folder.items || []
  const filtered = filterLibrary(subfolders, items, '', filter)
  // Client-side sort so the chosen mode reorders the folder's subfolders AND its
  // content (courses/media) instantly.
  const { folders: visibleFolders, items: visibleItems } = sortLibrary(
    filtered.visibleFolders, filtered.visibleItems, sortMode
  )

  const filteredSearch = searchData
    ? filterLibrary(searchData.folders || [], searchData.items || [], '', filter)
    : null

  // Path breadcrumb: Library / … / current folder
  const crumbs = [
    { label: t('library.library'), href: getUriWithOrg(orgslug, '/dash/library'), icon: <FolderSimple size={14} /> },
    ...(folder.breadcrumbs || []).map((b: any) => ({
      label: b.name,
      href: getUriWithOrg(orgslug, `/dash/library/folder/${removeFolderPrefix(b.folder_uuid)}`),
    })),
  ]

  const handleRemove = async (resourceUuid: string) => {
    try {
      await removeFolderContent(folderUuid, resourceUuid, access_token)
      toast.success(t('library.content_removed'))
      mutate()
    } catch (error: any) {
      toast.error(error?.message || t('library.content_remove_error'))
    }
  }

  // Persist the chosen sort mode server-side (admin-only; API also rejects
  // non-admins). Optimistically flip the control, revert on failure.
  const handleSortChange = async (mode: FolderSortMode) => {
    const previous = sortMode
    setSortMode(mode)
    try {
      await updateOrgFoldersSort(org_id, mode, access_token)
      mutate()
    } catch (error: any) {
      setSortMode(previous)
      toast.error(error?.message || t('library.sort.sort_error', { defaultValue: 'Could not update sort order' }))
    }
  }

  // Persist a manual drag reorder of THIS folder's subfolders on drop, scoped to
  // the parent folder so nested folders reorder independently.
  const handleReorderFolders = async (newFolders: any[]) => {
    mutate({ ...folder, subfolders: newFolders }, false)
    try {
      await reorderFolders(
        org_id,
        newFolders.map((f: any) => ({ folder_id: f.id })),
        access_token,
        folderUuid
      )
      mutate()
    } catch (error: any) {
      mutate()
      toast.error(error?.message || t('library.sort.reorder_error', { defaultValue: 'Could not save the new order' }))
    }
  }

  // Persist a manual drag reorder of THIS folder's content items (courses/media)
  // on drop, storing their position on the folder-content link rows.
  const handleReorderItems = async (newItems: any[]) => {
    mutate({ ...folder, items: newItems }, false)
    try {
      await reorderFolderContent(
        folderUuid,
        newItems.map((i: any) => i.resource_uuid),
        access_token
      )
      mutate()
    } catch (error: any) {
      mutate()
      toast.error(error?.message || t('library.sort.reorder_error', { defaultValue: 'Could not save the new order' }))
    }
  }

  return (
    <div className="flex w-full">
      <div className="ps-4 sm:ps-10 me-4 sm:me-10 tracking-tight flex flex-col space-y-5 w-full">
        {/* Persistent library header (with content targeting THIS folder) */}
        <LibraryHeader
          orgslug={orgslug}
          org_id={org_id}
          folderUuid={folderUuid}
          query={query}
          setQuery={setQuery}
          filter={filter}
          setFilter={setFilter}
          sortMode={sortMode}
          setSortMode={handleSortChange}
          onChanged={refresh}
        />

        {/* Folder path breadcrumb + folder-level actions */}
        {!searching && (
          <div className="flex items-center justify-between gap-3 -mt-1">
            <Breadcrumbs items={crumbs} />
            <AuthenticatedClientElement checkMethod="roles" action="update" ressourceType={'folders' as any} orgId={org_id}>
              <div className="flex items-center gap-2 flex-none">
                <button
                  onClick={() => shareFolderLink(orgslug, folderUuid, folder.name, t('library.link_copied'), t('library.link_copy_error'))}
                  className={SECONDARY_BTN}
                >
                  <LinkSimple size={16} />
                  <span>{t('library.share')}</span>
                </button>
                <button onClick={() => setAccessOpen(true)} className={SECONDARY_BTN}>
                  <Lock size={16} />
                  <span>{t('library.manage_access')}</span>
                </button>
              </div>
            </AuthenticatedClientElement>
          </div>
        )}

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
            onChanged={mutate}
            onRemoveItem={handleRemove}
            isManual={isManual}
            onReorderFolders={handleReorderFolders}
            onReorderItems={handleReorderItems}
          />
        )}
      </div>

      <Modal
        isDialogOpen={accessOpen}
        onOpenChange={setAccessOpen}
        minHeight="no-min"
        minWidth="lg"
        dialogTitle={t('library.manage_access')}
        dialogContent={<ManageAccessPopover resource_uuid={folderUuid} resourceType="folders" orgslug={orgslug} />}
      />
    </div>
  )
}

export default FolderView
