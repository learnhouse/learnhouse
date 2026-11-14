'use client'
import LibraryHeader, { type LibraryDialog } from '@components/Dashboard/Library/LibraryHeader'
import LibraryBrowser from '@components/Dashboard/Library/LibraryBrowser'
import { type FolderSortMode } from '@components/Dashboard/Library/FolderSortDropdown'
import AuthenticatedClientElement from '@components/Security/AuthenticatedClientElement'
import { Button } from '@components/Dashboard/Shared/DashKit/DashKit'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import useAdminStatus from '@components/Hooks/useAdminStatus'
import { deleteFolder, getOrgFolders, getOrgRootItems, removeOrgRootContent, reorderFolders } from '@services/folders/folders'
import { updateOrgFoldersSort } from '@services/organizations/orgs'
import { FolderSimple, FolderSimplePlus } from '@phosphor-icons/react'
import React from 'react'
import toast from 'react-hot-toast'
import useSWR from 'swr'
import { useTranslation } from 'react-i18next'
import { asArray } from '@services/utils/ts/requests'

type Props = {
  orgslug: string
  org_id: number
}

function LibraryHome({ orgslug, org_id }: Props) {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const org = useOrg() as any
  const [dialog, setDialog] = React.useState<LibraryDialog>(null)

  // Sort mode is persisted server-side in the org config; seed local state from
  // it and keep it in sync as the org config loads.
  const configSortMode: FolderSortMode = org?.config?.config?.general?.folders?.sort_mode ?? 'name_asc'
  const [sortMode, setSortMode] = React.useState<FolderSortMode>(configSortMode)
  React.useEffect(() => {
    setSortMode(configSortMode)
  }, [configSortMode])

  // Only admins (folders:update) can rearrange; everyone else sees the
  // resulting server-side order read-only.
  const { rights } = useAdminStatus()
  const canReorder = rights?.folders?.action_update === true
  const isManual = sortMode === 'manual' && canReorder

  const { data: folders, error: foldersError, mutate: mutateFolders } = useSWR(
    org_id ? ['folders', org_id, 'root'] : null,
    () => getOrgFolders(org_id, access_token, { revalidate: 60, tags: ['folders'] })
  )
  const { data: rootItems, mutate: mutateItems } = useSWR(
    org_id && access_token ? ['library-root-items', org_id] : null,
    () => getOrgRootItems(org_id, access_token)
  )

  const refresh = () => {
    mutateFolders()
    mutateItems()
  }

  const folderList: any[] = asArray(folders)
  const itemList: any[] = asArray(rootItems)

  // Optimistic: the card leaves at once and comes back if the API refuses.
  const handleRemove = async (item: any) => {
    const previous = itemList
    mutateItems(itemList.filter((i) => i.resource_uuid !== item.resource_uuid), false)
    try {
      await removeOrgRootContent(org_id, item.resource_uuid, access_token)
      toast.success(t('library.content_removed'))
      mutateItems()
    } catch (error: any) {
      mutateItems(previous, false)
      toast.error(error?.message || t('library.content_remove_error'))
    }
  }

  const handleDeleteFolder = async (folder: any) => {
    const previous = folderList
    mutateFolders(folderList.filter((f) => f.folder_uuid !== folder.folder_uuid), false)
    try {
      await deleteFolder(folder.folder_uuid, access_token)
      toast.success(t('library.folder_deleted_success'))
      mutateFolders()
    } catch {
      mutateFolders(previous, false)
      toast.error(t('library.folder_deleted_error'))
    }
  }

  // Persist the chosen sort mode server-side (admin-only; API also rejects
  // non-admins). Optimistically flip the control, revert on failure.
  const handleSortChange = async (mode: FolderSortMode) => {
    const previous = sortMode
    setSortMode(mode)
    try {
      await updateOrgFoldersSort(org_id, mode, access_token)
      mutateFolders()
    } catch (error: any) {
      setSortMode(previous)
      toast.error(error?.message || t('library.sort.sort_error'))
    }
  }

  // Persist a manual drag reorder on drop (the library has no Save button).
  // Optimistically show the new order, then re-mutate to revert on failure.
  const handleReorderFolders = async (newFolders: any[]) => {
    mutateFolders(newFolders, false)
    try {
      await reorderFolders(
        org_id,
        newFolders.map((f: any) => ({ folder_id: f.id })),
        access_token
      )
      mutateFolders()
    } catch (error: any) {
      mutateFolders()
      toast.error(error?.message || t('library.sort.reorder_error'))
    }
  }

  return (
    <div className="flex w-full">
      <div className="px-4 sm:px-10 pb-16 flex flex-col gap-5 w-full min-w-0">
        <LibraryHeader
          orgslug={orgslug}
          org_id={org_id}
          breadcrumbs={[{ label: t('library.library'), href: '/dash/library', icon: <FolderSimple size={14} /> }]}
          title={t('library.library')}
          subtitle={t('library.dash.subtitle')}
          onChanged={refresh}
          dialog={dialog}
          setDialog={setDialog}
        />

        <LibraryBrowser
          orgslug={orgslug}
          org_id={org_id}
          folders={folderList}
          items={itemList}
          loading={!!access_token && (rootItems === undefined || (folders === undefined && !foldersError))}
          sortMode={sortMode}
          onSortChange={handleSortChange}
          isManual={isManual}
          onChanged={refresh}
          onRemoveItem={handleRemove}
          onDeleteFolder={handleDeleteFolder}
          onReorderFolders={handleReorderFolders}
          emptyTitle={t('library.no_items')}
          emptyDescription={t('library.no_items_description')}
          emptyAction={
            <AuthenticatedClientElement checkMethod="roles" action="create" ressourceType={'folders' as any} orgId={org_id}>
              <Button variant="primary" className="mt-1" icon={<FolderSimplePlus size={14} />} onClick={() => setDialog('folder')}>
                {t('library.new_folder')}
              </Button>
            </AuthenticatedClientElement>
          }
        />
      </div>
    </div>
  )
}

export default LibraryHome
