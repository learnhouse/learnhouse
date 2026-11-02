'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { Route } from 'lucide-react'
import { useOrg } from '@components/Contexts/OrgContext'
import PathThumbnail from '@components/Objects/Thumbnails/PathThumbnail'
import { useMyPaths } from '@/hooks/queries/usePaths'

/** Trail section listing the paths a learner follows. Path certificates are
 * listed with the course ones in UserCertificates. Hidden without Paths. */
function UserPaths({ orgslug }: { orgslug: string }) {
  const { t } = useTranslation()
  const org = useOrg() as any
  const enabled = org?.config?.config?.resolved_features?.paths?.enabled === true
  const { data: paths } = useMyPaths(enabled ? org?.id : undefined)

  if (!enabled) return null

  return (
    <>
      {!!paths?.length && (
        <div className="flex flex-col space-y-2 mb-10">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-white nice-shadow rounded-lg">
              <Route className="w-5 h-5 text-gray-900" />
            </div>
            <h2 className="text-lg font-bold text-gray-900">{t('paths.my_paths')}</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {paths.map((path) => (
              <PathThumbnail key={path.path_uuid} path={path} orgslug={orgslug} />
            ))}
          </div>
        </div>
      )}
    </>
  )
}

export default UserPaths
