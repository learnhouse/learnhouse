'use client'
import AuthenticatedClientElement from '@components/Security/AuthenticatedClientElement'
import CreateFolderModal from '@components/Dashboard/Library/CreateFolderModal'
import UploadMediaModal from '@components/Dashboard/Library/UploadMediaModal'
import AddContentModal from '@components/Dashboard/Library/AddContentModal'
import { Button, DashPageHeader } from '@components/Dashboard/Shared/DashKit/DashKit'
import { FolderSimplePlus, Plus, UploadSimple } from '@phosphor-icons/react'
import React from 'react'
import { useTranslation } from 'react-i18next'

export type FilterKey = 'all' | 'folders' | 'courses' | 'media'

export type LibraryDialog = 'folder' | 'upload' | 'content' | null

type Props = {
  orgslug: string
  org_id: number
  /** Current folder uuid; undefined = library root. New content targets this. */
  folderUuid?: string
  breadcrumbs: { label: string; href: string; icon?: React.ReactNode }[]
  title: React.ReactNode
  subtitle?: React.ReactNode
  /** Folder-level actions shown before the create buttons. */
  extraActions?: React.ReactNode
  onChanged: () => void
  /** Lets an empty state open the same dialogs. */
  dialog: LibraryDialog
  setDialog: (_d: LibraryDialog) => void
}

export default function LibraryHeader({
  orgslug,
  org_id,
  folderUuid,
  breadcrumbs,
  title,
  subtitle,
  extraActions,
  onChanged,
  dialog,
  setDialog,
}: Props) {
  const { t } = useTranslation()
  const close = (open: boolean) => !open && setDialog(null)

  return (
    <>
      <DashPageHeader
        breadcrumbs={breadcrumbs}
        title={title}
        subtitle={subtitle}
        actions={
          <>
            {extraActions}
            <AuthenticatedClientElement checkMethod="roles" action="create" ressourceType={'folders' as any} orgId={org_id}>
              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={() => setDialog('content')} icon={<Plus size={14} />} aria-label={t('library.add_content')}>
                  <span className="hidden sm:inline">{t('library.add_content')}</span>
                </Button>
                <Button onClick={() => setDialog('upload')} icon={<UploadSimple size={14} />} aria-label={t('media.upload_media')}>
                  <span className="hidden sm:inline">{t('media.upload_media')}</span>
                </Button>
                <Button variant="primary" onClick={() => setDialog('folder')} icon={<FolderSimplePlus size={14} />}>
                  {folderUuid ? t('library.dash.new_subfolder') : t('library.new_folder')}
                </Button>
              </div>
            </AuthenticatedClientElement>
          </>
        }
      />
      <AddContentModal
        open={dialog === 'content'}
        onOpenChange={close}
        folderUuid={folderUuid}
        orgslug={orgslug}
        onChanged={onChanged}
      />
      <UploadMediaModal
        open={dialog === 'upload'}
        onOpenChange={close}
        folderUuid={folderUuid}
        orgslug={orgslug}
        onChanged={onChanged}
      />
      <CreateFolderModal
        open={dialog === 'folder'}
        onOpenChange={close}
        parentFolderUuid={folderUuid}
        orgslug={orgslug}
        onChanged={onChanged}
      />
    </>
  )
}

// The sort comparator lives in @lib/library/sort so the public learner views can
// reuse it without importing this (client, i18n-bound) component. Re-exported
// here so existing dashboard imports keep working.
export { sortLibrary } from '@lib/library/sort'

// Shared client-side filtering used by both root and folder views.
export function filterLibrary(folders: any[], items: any[], query: string, filter: FilterKey) {
  const q = query.trim().toLowerCase()
  const showFolders = filter === 'all' || filter === 'folders'
  const visibleFolders = (showFolders ? folders : []).filter((f) => !q || (f.name || '').toLowerCase().includes(q))
  const visibleItems = (filter === 'folders' ? [] : items).filter((i) => {
    if (filter === 'courses' && i.resource_type !== 'courses') return false
    if (filter === 'media' && i.resource_type !== 'media') return false
    if (q) {
      const name = (i.resource?.name || i.resource?.title || '').toLowerCase()
      return name.includes(q)
    }
    return true
  })
  return { visibleFolders, visibleItems }
}
