'use client'
import { Breadcrumbs } from '@components/Objects/Breadcrumbs/Breadcrumbs'
import AuthenticatedClientElement from '@components/Security/AuthenticatedClientElement'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import ManageAccessPopover from '@components/Dashboard/Library/ManageAccessPopover'
import LibraryGrid from '@components/Dashboard/Library/LibraryGrid'
import LibraryHeader, { filterLibrary, type FilterKey } from '@components/Dashboard/Library/LibraryHeader'
import LibrarySearchResults from '@components/Dashboard/Library/LibrarySearchResults'
import { shareFolderLink } from '@components/Dashboard/Library/shareFolder'
import { SECONDARY_BTN } from '@components/Dashboard/Library/LibraryToolbar'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getFolderById, removeFolderContent, removeFolderPrefix, searchLibrary } from '@services/folders/folders'
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

  const [accessOpen, setAccessOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const [filter, setFilter] = React.useState<FilterKey>('all')
  const searching = query.trim().length > 0

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
      <div className="pl-4 sm:pl-10 mr-4 sm:mr-10 pt-6">
        <p className="text-gray-400">{t('library.folder_not_found')}</p>
      </div>
    )
  }

  const folderUuid = folder.folder_uuid
  const subfolders: any[] = folder.subfolders || []
  const items: any[] = folder.items || []
  const { visibleFolders, visibleItems } = filterLibrary(subfolders, items, '', filter)

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

  return (
    <div className="flex w-full">
      <div className="pl-4 sm:pl-10 mr-4 sm:mr-10 tracking-tight flex flex-col space-y-5 w-full">
        {/* Persistent library header (with content targeting THIS folder) */}
        <LibraryHeader
          orgslug={orgslug}
          org_id={org_id}
          folderUuid={folderUuid}
          query={query}
          setQuery={setQuery}
          filter={filter}
          setFilter={setFilter}
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
