'use client'

import React, { useState } from 'react'
import { Plus, Route } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Breadcrumbs } from '@components/Objects/Breadcrumbs/Breadcrumbs'
import PathThumbnail from '@components/Objects/Thumbnails/PathThumbnail'
import AuthenticatedClientElement from '@components/Security/AuthenticatedClientElement'
import FeatureGate from '@components/Dashboard/Shared/FeatureGate/FeatureGate'
import { CreatePathModal } from '@components/Objects/Modals/Paths/CreatePathModal'
import { usePaths } from '@/hooks/queries/usePaths'

interface PathsDashClientProps {
  org_id: number
  orgslug: string
}

const PathsDashClient = ({ org_id, orgslug }: PathsDashClientProps) => {
  const { t } = useTranslation()
  const { data: paths, isLoading } = usePaths(org_id)
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)

  const newPathButton = (
    <AuthenticatedClientElement checkMethod="roles" action="create" ressourceType="courses" orgId={org_id}>
      <button
        onClick={() => setIsCreateModalOpen(true)}
        className="rounded-lg bg-black hover:scale-105 transition-all duration-100 ease-linear antialiased p-2 px-5 my-auto font text-xs font-bold text-white nice-shadow flex space-x-2 items-center"
      >
        <Plus className="w-4 h-4" />
        <span>{t('paths.new_path')}</span>
      </button>
    </AuthenticatedClientElement>
  )

  return (
    <FeatureGate feature="paths" orgslug={orgslug} context="dashboard">
      <div className="h-full w-full bg-[#f8f8f8] ps-4 pe-4 sm:ps-10 sm:pe-10">
        <div className="mb-6 pt-6">
          <Breadcrumbs items={[{ label: t('paths.title'), href: '/dash/paths', icon: <Route size={14} /> }]} />
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mt-4">
            <div>
              <h1 className="text-3xl font-bold mb-1">{t('paths.title')}</h1>
              <p className="text-sm text-gray-500 mb-4 sm:mb-0">{t('paths.dashboard.subtitle')}</p>
            </div>
            {newPathButton}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 pb-10">
          {isLoading &&
            [1, 2, 3, 4].map((i) => (
              <div key={i} className="bg-white rounded-xl nice-shadow overflow-hidden animate-pulse">
                <div className="aspect-video bg-gray-100" />
                <div className="p-3 space-y-2">
                  <div className="h-4 w-2/3 bg-gray-200 rounded" />
                  <div className="h-3 w-full bg-gray-100 rounded" />
                </div>
              </div>
            ))}
          {paths?.map((path) => (
            <PathThumbnail key={path.path_uuid} path={path} orgslug={orgslug} isDashboard />
          ))}
          {!isLoading && paths?.length === 0 && (
            <div className="col-span-full flex justify-center items-center py-8">
              <div className="text-center">
                <div className="mb-4">
                  <div className="w-24 h-24 mx-auto bg-gray-100 rounded-full flex items-center justify-center">
                    <Route size={48} className="text-gray-300" />
                  </div>
                </div>
                <h2 className="text-2xl font-bold text-gray-600 mb-2">{t('paths.no_paths')}</h2>
                <p className="text-lg text-gray-400 max-w-md mx-auto">{t('paths.no_paths_description')}</p>
                <div className="mt-6 flex justify-center">{newPathButton}</div>
              </div>
            </div>
          )}
        </div>

        <CreatePathModal
          isOpen={isCreateModalOpen}
          onClose={() => setIsCreateModalOpen(false)}
          orgId={org_id}
          orgSlug={orgslug}
        />
      </div>
    </FeatureGate>
  )
}

export default PathsDashClient
