'use client'
import AuthenticatedClientElement from '@components/Security/AuthenticatedClientElement'
import LibraryHeader, { type LibraryDialog } from '@components/Dashboard/Library/LibraryHeader'
import LibraryBrowser from '@components/Dashboard/Library/LibraryBrowser'
import ManageAccessModal from '@components/Dashboard/Library/ManageAccessModal'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import { ResourceSeoEditor } from '@components/Dashboard/Shared/SEO/ResourceSeoEditor'
import { getFolderThumbnailMediaDirectory } from '@services/media/media'
import { type FolderSortMode } from '@components/Dashboard/Library/FolderSortDropdown'
import { shareFolderLink } from '@components/Dashboard/Library/shareFolder'
import { Button, EmptyState, buttonClass } from '@components/Dashboard/Shared/DashKit/DashKit'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import useAdminStatus from '@components/Hooks/useAdminStatus'
import {
  deleteFolder,
  getFolderById,
  removeFolderContent,
  removeFolderPrefix,
  reorderFolders,
  reorderFolderContent,
} from '@services/folders/folders'
import { updateOrgFoldersSort } from '@services/organizations/orgs'
import { getUriWithOrg } from '@services/config/config'
import { ArrowLeft, FolderSimple, FolderSimplePlus, LinkSimple, Lock, MagnifyingGlass } from '@phosphor-icons/react'
import Link from 'next/link'
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
  // The SEO report links here with ?seo=1 to open the folder's SEO settings.
  const [seoOpen, setSeoOpen] = React.useState(false)
  React.useEffect(() => {
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('seo') === '1') setSeoOpen(true)
  }, [])
  const [dialog, setDialog] = React.useState<LibraryDialog>(null)

  // Sort mode is persisted server-side in the org config (shared with the root
  // library view); seed local state from it and keep it in sync.
  const configSortMode: FolderSortMode = org?.config?.config?.general?.folders?.sort_mode ?? 'name_asc'
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

  const refresh = () => {
    mutate()
  }

  if (!folder) {
    return (
      <div className="px-4 sm:px-10 pt-10">
        <div className="bg-white rounded-2xl nice-shadow">
          <EmptyState
            icon={<FolderSimple size={22} />}
            title={t('library.folder_not_found')}
            description={t('library.dash.folder_not_found_description')}
            action={
              <Link href={getUriWithOrg(orgslug, '/dash/library')} className={buttonClass('secondary', 'sm')}>
                <ArrowLeft size={13} className="rtl:rotate-180" /> {t('library.dash.back_to_library')}
              </Link>
            }
          />
        </div>
      </div>
    )
  }

  const folderUuid = folder.folder_uuid
  const subfolders: any[] = Array.isArray(folder.subfolders) ? folder.subfolders : []
  const items: any[] = Array.isArray(folder.items) ? folder.items : []

  // Path breadcrumb: Library / … / current folder
  const crumbs = [
    { label: t('library.library'), href: getUriWithOrg(orgslug, '/dash/library'), icon: <FolderSimple size={14} /> },
    ...(Array.isArray(folder.breadcrumbs) ? folder.breadcrumbs : []).map((b: any) => ({
      label: b.name,
      href: getUriWithOrg(orgslug, `/dash/library/folder/${removeFolderPrefix(b.folder_uuid)}`),
    })),
  ]
  // The API may or may not include the current folder; make sure it ends the trail.
  if (crumbs[crumbs.length - 1]?.label !== folder.name || crumbs.length === 1) {
    crumbs.push({ label: folder.name, href: getUriWithOrg(orgslug, `/dash/library/folder/${folderid}`) })
  }

  // Optimistic edits to this folder's children, reverted on failure.
  const handleRemove = async (item: any) => {
    mutate({ ...folder, items: items.filter((i) => i.resource_uuid !== item.resource_uuid) }, false)
    try {
      await removeFolderContent(folderUuid, item.resource_uuid, access_token)
      toast.success(t('library.content_removed'))
      mutate()
    } catch (error: any) {
      mutate(folder, false)
      toast.error(error?.message || t('library.content_remove_error'))
    }
  }

  const handleDeleteFolder = async (sub: any) => {
    mutate({ ...folder, subfolders: subfolders.filter((f) => f.folder_uuid !== sub.folder_uuid) }, false)
    try {
      await deleteFolder(sub.folder_uuid, access_token)
      toast.success(t('library.folder_deleted_success'))
      mutate()
    } catch {
      mutate(folder, false)
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
      mutate()
    } catch (error: any) {
      setSortMode(previous)
      toast.error(error?.message || t('library.sort.sort_error'))
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
      toast.error(error?.message || t('library.sort.reorder_error'))
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
      toast.error(error?.message || t('library.sort.reorder_error'))
    }
  }

  const count = folder.total_items ?? subfolders.length + items.length

  return (
    <div className="flex w-full">
      <div className="px-4 sm:px-10 pb-16 flex flex-col gap-5 w-full min-w-0">
        <LibraryHeader
          orgslug={orgslug}
          org_id={org_id}
          folderUuid={folderUuid}
          breadcrumbs={crumbs}
          title={
            <span className="inline-flex items-center gap-2 min-w-0">
              <span className="truncate" dir="auto">{folder.name}</span>
              {folder.public === false && <Lock size={18} className="text-violet-500 shrink-0" aria-label={t('library.private')} />}
            </span>
          }
          subtitle={folder.description || t('library.dash.item_count', { count })}
          onChanged={refresh}
          dialog={dialog}
          setDialog={setDialog}
          extraActions={
            <AuthenticatedClientElement checkMethod="roles" action="update" ressourceType={'folders' as any} orgId={org_id}>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  icon={<LinkSimple size={14} />}
                  onClick={() => shareFolderLink(orgslug, folderUuid, folder.name, t('library.link_copied'), t('library.link_copy_error'))}
                >
                  {t('library.share')}
                </Button>
                <Button variant="ghost" icon={<Lock size={14} />} onClick={() => setAccessOpen(true)}>
                  {t('library.manage_access')}
                </Button>
                <Button variant="ghost" icon={<MagnifyingGlass size={14} />} onClick={() => setSeoOpen(true)}>
                  {t('dashboard.courses.settings.tabs.seo')}
                </Button>
              </div>
            </AuthenticatedClientElement>
          }
        />

        <LibraryBrowser
          orgslug={orgslug}
          org_id={org_id}
          folders={subfolders}
          items={items}
          loading={false}
          sortMode={sortMode}
          onSortChange={handleSortChange}
          isManual={isManual}
          onChanged={refresh}
          onRemoveItem={handleRemove}
          onDeleteFolder={handleDeleteFolder}
          onReorderFolders={handleReorderFolders}
          onReorderItems={handleReorderItems}
          emptyTitle={t('library.empty_folder')}
          emptyDescription={t('library.empty_folder_description')}
          emptyAction={
            <AuthenticatedClientElement checkMethod="roles" action="create" ressourceType={'folders' as any} orgId={org_id}>
              <div className="mt-1 flex flex-wrap justify-center gap-2">
                <Button onClick={() => setDialog('content')}>{t('library.add_content')}</Button>
                <Button variant="primary" icon={<FolderSimplePlus size={14} />} onClick={() => setDialog('folder')}>
                  {t('library.dash.new_subfolder')}
                </Button>
              </div>
            </AuthenticatedClientElement>
          }
        />
      </div>

      <Modal
        isDialogOpen={seoOpen}
        onOpenChange={setSeoOpen}
        dialogTitle={folder.name}
        icon={<MagnifyingGlass size={18} />}
        size="xl"
        dialogContent={
          seoOpen ? (
            <ResourceSeoEditor
              type="folder"
              uuid={folderUuid}
              orgslug={orgslug}
              isPublic={folder.public !== false}
              thumbnailUrl={folder.thumbnail_image ? getFolderThumbnailMediaDirectory(org?.org_uuid, folderUuid, folder.thumbnail_image) : null}
              onSaved={refresh}
            />
          ) : null
        }
      />

      <ManageAccessModal
        open={accessOpen}
        onOpenChange={setAccessOpen}
        resource_uuid={folderUuid}
        resourceType="folders"
        orgslug={orgslug}
        name={folder.name}
      />
    </div>
  )
}

export default FolderView
