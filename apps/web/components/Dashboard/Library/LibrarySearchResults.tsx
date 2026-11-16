'use client'
import LibraryGrid from '@components/Dashboard/Library/LibraryGrid'
import { LibraryGridSkeleton, LibraryListSkeleton } from '@components/Dashboard/Library/libraryItems'
import { removeFolderContent, removeOrgRootContent, deleteFolder } from '@services/folders/folders'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { Button, EmptyState, type ViewMode } from '@components/Dashboard/Shared/DashKit/DashKit'
import { FolderSimple, MagnifyingGlass } from '@phosphor-icons/react'
import React from 'react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'

type Props = {
  results: { folders: any[]; items: any[] } | null
  isLoading: boolean
  orgslug: string
  org_id: number
  view: ViewMode
  onChanged: () => void
  onClear: () => void
}

// Where a result lives, since search spans the whole library.
function ContextPath({ path }: { path: any[] }) {
  const { t } = useTranslation()
  const names = [t('library.library'), ...(path || []).map((p: any) => p.name)]
  return (
    <span className="mt-1 flex items-center gap-1 text-[11px] text-neutral-400 min-w-0">
      <FolderSimple size={11} weight="fill" className="shrink-0" />
      <span className="truncate">{names.join(' / ')}</span>
    </span>
  )
}

export default function LibrarySearchResults({ results, isLoading, orgslug, org_id, view, onChanged, onClear }: Props) {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token

  const folders = results?.folders ?? []
  const items = results?.items ?? []

  const removeItem = async (item: any) => {
    try {
      const containing = item.path?.length ? item.path[item.path.length - 1].folder_uuid : null
      if (containing) await removeFolderContent(containing, item.resource_uuid, access_token)
      else await removeOrgRootContent(org_id, item.resource_uuid, access_token)
      toast.success(t('library.content_removed'))
      onChanged()
    } catch (e: any) {
      toast.error(e?.message || t('library.content_remove_error'))
    }
  }

  const removeFolder = async (folder: any) => {
    try {
      await deleteFolder(folder.folder_uuid, access_token)
      toast.success(t('library.folder_deleted_success'))
      onChanged()
    } catch {
      toast.error(t('library.folder_deleted_error'))
    }
  }

  if (isLoading && !results) return view === 'grid' ? <LibraryGridSkeleton /> : <LibraryListSkeleton />

  if (folders.length === 0 && items.length === 0) {
    return (
      <div className="bg-white rounded-2xl nice-shadow">
        <EmptyState
          icon={<MagnifyingGlass size={22} />}
          title={t('library.no_results')}
          description={t('library.dash.no_results_description')}
          action={
            <Button size="sm" onClick={onClear}>
              {t('library.clear_search')}
            </Button>
          }
        />
      </div>
    )
  }

  return (
    <LibraryGrid
      folders={folders}
      items={items}
      orgslug={orgslug}
      org_id={org_id}
      view={view}
      onChanged={onChanged}
      onRemoveItem={removeItem}
      onDeleteFolder={removeFolder}
      contextFor={(entry) => <ContextPath path={entry.path} />}
    />
  )
}
