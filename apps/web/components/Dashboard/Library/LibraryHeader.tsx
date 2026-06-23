'use client'
import { Breadcrumbs } from '@components/Objects/Breadcrumbs/Breadcrumbs'
import AuthenticatedClientElement from '@components/Security/AuthenticatedClientElement'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import CreateFolderModal from '@components/Dashboard/Library/CreateFolderModal'
import UploadMediaModal from '@components/Dashboard/Library/UploadMediaModal'
import AddContentModal from '@components/Dashboard/Library/AddContentModal'
import { FilterPill, PRIMARY_BTN, SECONDARY_BTN } from '@components/Dashboard/Library/LibraryToolbar'
import {
  FolderSimple,
  MagnifyingGlass,
  X,
  Plus,
  UploadSimple,
  FolderSimplePlus,
} from '@phosphor-icons/react'
import React from 'react'
import { useTranslation } from 'react-i18next'

export type FilterKey = 'all' | 'folders' | 'courses' | 'media'

type Props = {
  orgslug: string
  org_id: number
  /** Current folder uuid; undefined = library root. New content targets this. */
  folderUuid?: string
  query: string
  setQuery: (_v: string) => void
  filter: FilterKey
  setFilter: (_f: FilterKey) => void
  onChanged: () => void
}

export default function LibraryHeader({
  orgslug,
  org_id,
  folderUuid,
  query,
  setQuery,
  filter,
  setFilter,
  onChanged,
}: Props) {
  const { t } = useTranslation()
  const [newFolderOpen, setNewFolderOpen] = React.useState(false)
  const [uploadOpen, setUploadOpen] = React.useState(false)
  const [addContentOpen, setAddContentOpen] = React.useState(false)

  return (
    <div className="flex flex-col space-y-2 pt-6">
      <Breadcrumbs items={[{ label: t('library.library'), href: '/dash/library', icon: <FolderSimple size={14} /> }]} />
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <h1 className="pt-3 font-bold text-4xl">{t('library.library')}</h1>
        <AuthenticatedClientElement checkMethod="roles" action="create" ressourceType={'folders' as any} orgId={org_id}>
          <div className="flex items-center gap-2">
            <Modal
              isDialogOpen={addContentOpen}
              onOpenChange={setAddContentOpen}
              minHeight="no-min"
              minWidth="lg"
              dialogTitle={t('library.add_content')}
              dialogContent={<AddContentModal folderUuid={folderUuid} orgslug={orgslug} closeModal={() => setAddContentOpen(false)} onChanged={onChanged} />}
              dialogTrigger={<button className={SECONDARY_BTN}><Plus size={16} /><span>{t('library.add_content')}</span></button>}
            />
            <Modal
              isDialogOpen={uploadOpen}
              onOpenChange={setUploadOpen}
              minHeight="no-min"
              minWidth="lg"
              dialogTitle={t('media.upload_media')}
              dialogContent={<UploadMediaModal orgslug={orgslug} folderUuid={folderUuid} closeModal={() => setUploadOpen(false)} onChanged={onChanged} />}
              dialogTrigger={<button className={SECONDARY_BTN}><UploadSimple size={16} /><span>{t('media.upload_media')}</span></button>}
            />
            <Modal
              isDialogOpen={newFolderOpen}
              onOpenChange={setNewFolderOpen}
              minHeight="no-min"
              minWidth="md"
              dialogTitle={t('library.create_folder')}
              dialogContent={<CreateFolderModal orgslug={orgslug} parentFolderUuid={folderUuid} closeModal={() => setNewFolderOpen(false)} onChanged={onChanged} />}
              dialogTrigger={<button className={PRIMARY_BTN}><FolderSimplePlus size={16} weight="bold" /><span>{t('library.new_folder')}</span></button>}
            />
          </div>
        </AuthenticatedClientElement>
      </div>

      {/* Search + filters */}
      <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center pt-1">
        <div className="relative flex-1 max-w-md">
          <MagnifyingGlass size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('library.search')}
            className="w-full pl-9 pr-8 py-2 text-sm bg-white nice-shadow rounded-lg focus:outline-none focus:ring-2 focus:ring-black/5 placeholder:text-gray-400"
          />
          {query && (
            <button onClick={() => setQuery('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600" aria-label="Clear search">
              <X size={14} />
            </button>
          )}
        </div>
        <div className="flex gap-1.5 flex-wrap">
          <FilterPill label={t('library.filters.all')} active={filter === 'all'} activeClass="bg-neutral-700 text-white" onClick={() => setFilter('all')} />
          <FilterPill label={t('library.folders')} active={filter === 'folders'} activeClass="bg-violet-600 text-white" onClick={() => setFilter('folders')} />
          <FilterPill label={t('library.tabs.courses')} active={filter === 'courses'} activeClass="bg-blue-600 text-white" onClick={() => setFilter('courses')} />
          <FilterPill label={t('media.media')} active={filter === 'media'} activeClass="bg-amber-500 text-white" onClick={() => setFilter('media')} />
        </div>
      </div>
    </div>
  )
}

// Shared client-side filtering used by both root and folder views.
const _RESOURCE_TYPES = ['podcasts', 'communities', 'boards', 'playgrounds']
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
