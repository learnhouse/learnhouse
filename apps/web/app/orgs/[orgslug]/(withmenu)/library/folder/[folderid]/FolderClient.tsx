'use client'

import React from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import GeneralWrapperStyled from '@components/Objects/StyledElements/Wrappers/GeneralWrapper'
import FeatureGate from '@components/Dashboard/Shared/FeatureGate/FeatureGate'
import { Breadcrumbs } from '@components/Objects/Breadcrumbs/Breadcrumbs'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { queryKeys } from '@/lib/query/keys'
import { getFolderById, removeFolderPrefix } from '@services/folders/folders'
import { getUriWithOrg } from '@services/config/config'
import { shareFolderLink } from '@components/Dashboard/Library/shareFolder'
import { FolderSimple, LinkSimple } from '@phosphor-icons/react'
import { FolderCard, LibraryItemCard } from '../../library-cards'
import { useTrackView, AnalyticsEvent } from '@services/analytics'

function FolderClient({
  orgslug,
  folderid,
}: {
  orgslug: string
  folderid: string
}) {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const folderUuid = `folder_${folderid}`

  const { data: folder, isLoading } = useQuery({
    queryKey: queryKeys.folders.detail(folderUuid),
    queryFn: () => getFolderById(folderUuid, access_token),
    enabled: !!folderid,
  })

  useTrackView(
    AnalyticsEvent.FolderViewed,
    {
      folder_count: (folder?.subfolders || []).length,
      is_empty: (folder?.subfolders || []).length === 0 && (folder?.items || []).length === 0,
    },
    !isLoading && !!folder,
    'learner',
  )

  if (isLoading && !folder) {
    return (
      <div className="w-full animate-pulse">
        <GeneralWrapperStyled>
          <div className="h-7 bg-gray-200 rounded w-40 mb-4" />
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="bg-white rounded-xl nice-shadow p-3 h-16" />
            ))}
          </div>
        </GeneralWrapperStyled>
      </div>
    )
  }

  const subfolders = folder?.subfolders || []
  const items = folder?.items || []
  const breadcrumbs = folder?.breadcrumbs || []
  const isEmpty = subfolders.length === 0 && items.length === 0

  return (
    <FeatureGate feature="folders" orgslug={orgslug} context="public">
      <div className="w-full">
        <GeneralWrapperStyled>
          <div className="flex flex-col space-y-4 mb-2">
            <Breadcrumbs
              items={[
                {
                  label: t('library.library'),
                  href: getUriWithOrg(orgslug, '/library'),
                  icon: <FolderSimple size={14} weight="fill" />,
                },
                ...breadcrumbs.map((crumb: any) => ({
                  label: crumb.name,
                  href: getUriWithOrg(
                    orgslug,
                    `/library/folder/${removeFolderPrefix(crumb.folder_uuid)}`
                  ),
                })),
              ]}
            />

            <div className="flex items-center justify-between gap-3">
              <h1 className="text-2xl font-bold text-gray-800">{folder?.name}</h1>
              {folder && (
                <button
                  onClick={() => shareFolderLink(orgslug, folderUuid, folder.name, t('library.link_copied'), t('library.link_copy_error'))}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-gray-700 nice-shadow hover:bg-gray-50 transition-colors flex-none"
                >
                  <LinkSimple size={16} />
                  <span>{t('library.share')}</span>
                </button>
              )}
            </div>

            {folder?.description && (
              <p className="text-sm text-gray-500">{folder.description}</p>
            )}

            <div className="flex flex-col gap-7">
              {subfolders.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                  {subfolders.map((sub: any) => (
                    <FolderCard key={sub.folder_uuid} folder={sub} orgslug={orgslug} />
                  ))}
                </div>
              )}

              {items.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 items-start">
                  {items.map((item: any) => (
                    <LibraryItemCard key={item.resource_uuid} item={item} orgslug={orgslug} />
                  ))}
                </div>
              )}

              {isEmpty && (
                <div className="col-span-full flex flex-col justify-center items-center py-12 px-4 border-2 border-dashed border-gray-100 rounded-2xl bg-gray-50/30">
                  <div className="p-4 bg-white rounded-full nice-shadow mb-4">
                    <FolderSimple className="w-8 h-8 text-gray-300" weight="duotone" />
                  </div>
                  <h3 className="text-lg font-bold text-gray-600 mb-1">
                    {t('library.empty_folder')}
                  </h3>
                </div>
              )}
            </div>
          </div>
        </GeneralWrapperStyled>
      </div>
    </FeatureGate>
  )
}

export default FolderClient
