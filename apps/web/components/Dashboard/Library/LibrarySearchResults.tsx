'use client'
import FolderThumbnail from '@components/Objects/Thumbnails/FolderThumbnail'
import LibraryItemCard from '@components/Dashboard/Library/LibraryItemCard'
import CourseThumbnail, { removeCoursePrefix } from '@components/Objects/Thumbnails/CourseThumbnail'
import { getUriWithOrg } from '@services/config/config'
import { removeFolderContent, removeOrgRootContent } from '@services/folders/folders'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { FolderSimple, MagnifyingGlass } from '@phosphor-icons/react'
import React from 'react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'

type Props = {
  results: { folders: any[]; items: any[] } | null
  isLoading: boolean
  orgslug: string
  org_id: number
  onChanged: () => void
}

function ContextPath({ path }: { path: any[] }) {
  const { t } = useTranslation()
  const names = [t('library.library'), ...(path || []).map((p: any) => p.name)]
  return (
    <div className="mt-1.5 flex items-center gap-1 text-[11px] text-gray-400 min-w-0">
      <FolderSimple size={11} weight="fill" className="flex-shrink-0" />
      <span className="truncate">{names.join('  /  ')}</span>
    </div>
  )
}

export default function LibrarySearchResults({ results, isLoading, orgslug, org_id, onChanged }: Props) {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token

  const folders = results?.folders || []
  const items = results?.items || []

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

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 animate-pulse">
        {Array.from({ length: 4 }).map((_, i) => <div key={i} className="bg-white rounded-xl nice-shadow h-16" />)}
      </div>
    )
  }

  if (folders.length === 0 && items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
        <div className="bg-gray-100 rounded-2xl p-4 text-gray-400">
          <MagnifyingGlass size={28} weight="duotone" />
        </div>
        <p className="text-sm font-semibold text-gray-500">{t('library.no_results')}</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-7">
      {folders.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 items-start">
          {folders.map((folder: any) => (
            <div key={folder.folder_uuid} className="flex flex-col">
              <FolderThumbnail folder={folder} orgslug={orgslug} org_id={org_id} isDashboard onChanged={onChanged} />
              <ContextPath path={folder.path} />
            </div>
          ))}
        </div>
      )}

      {items.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 items-start">
          {items.map((item: any) => {
            const resource = item.resource || {}
            return (
              <div key={`${item.resource_uuid}-${(item.path || []).map((p: any) => p.folder_uuid).join('-')}`} className="flex flex-col">
                {item.resource_type === 'courses' ? (
                  <CourseThumbnail
                    course={resource}
                    orgslug={orgslug}
                    isDashboard
                    customLink={getUriWithOrg(orgslug, `/dash/courses/course/${removeCoursePrefix(resource.course_uuid || item.resource_uuid)}/general`)}
                  />
                ) : (
                  <LibraryItemCard item={item} orgslug={orgslug} org_id={org_id} onRemove={() => removeItem(item)} />
                )}
                <ContextPath path={item.path} />
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
