'use client'

import React, { useState } from 'react'
import { Plus, Mic2, Headphones } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useOrg } from '@components/Contexts/OrgContext'
import { PodcastWithEpisodeCount } from '@services/podcasts/podcasts'
import { CreatePodcastModal } from '@components/Objects/Modals/Podcasts/CreatePodcastModal'
import { Breadcrumbs } from '@components/Objects/Breadcrumbs/Breadcrumbs'
import PodcastThumbnail from '@components/Objects/Thumbnails/PodcastThumbnail'
import AuthenticatedClientElement from '@components/Security/AuthenticatedClientElement'

interface PodcastsDashClientProps {
  org_id: number
  orgslug: string
  podcasts: PodcastWithEpisodeCount[]
}

const PodcastsDashClient = ({
  org_id,
  orgslug,
  podcasts,
}: PodcastsDashClientProps) => {
  const { t } = useTranslation()
  const org = useOrg() as any

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)

  return (
    <div className="h-full w-full bg-[#f8f8f8] pl-10 pr-10">
      <div className="mb-6 pt-6">
        <Breadcrumbs items={[
          { label: t('podcasts.podcasts'), href: '/dash/podcasts', icon: <Headphones size={14} /> }
        ]} />
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mt-4">
          <div className="flex items-center space-x-4">
            <h1 className="text-3xl font-bold mb-4 sm:mb-0">{t('podcasts.podcasts')}</h1>
          </div>
          <AuthenticatedClientElement
            checkMethod="roles"
            action="create"
            ressourceType="podcasts"
            orgId={org_id}
          >
            <button
              onClick={() => setIsCreateModalOpen(true)}
              className="rounded-lg bg-black hover:scale-105 transition-all duration-100 ease-linear antialiased p-2 px-5 my-auto font text-xs font-bold text-white nice-shadow flex space-x-2 items-center"
            >
              <Plus className="w-4 h-4" />
              <span>{t('podcasts.new_podcast')}</span>
            </button>
          </AuthenticatedClientElement>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {podcasts.map((podcast) => (
          <div key={podcast.podcast_uuid}>
            <PodcastThumbnail
              podcast={podcast}
              orgslug={orgslug}
              isDashboard={true}
            />
          </div>
        ))}
        {podcasts.length === 0 && (
          <div className="col-span-full flex justify-center items-center py-8">
            <div className="text-center">
              <div className="mb-4">
                <div className="w-24 h-24 mx-auto bg-gray-100 rounded-full flex items-center justify-center">
                  <Mic2 size={48} className="text-gray-300" />
                </div>
              </div>
              <h2 className="text-2xl font-bold text-gray-600 mb-2">
                {t('podcasts.no_podcasts')}
              </h2>
              <p className="text-lg text-gray-400">
                {t('podcasts.no_podcasts_description')}
              </p>
              <div className="mt-6 flex justify-center">
                <AuthenticatedClientElement
                  action="create"
                  ressourceType="podcasts"
                  checkMethod="roles"
                  orgId={org_id}
                >
                  <button
                    onClick={() => setIsCreateModalOpen(true)}
                    className="rounded-lg bg-black hover:scale-105 transition-all duration-100 ease-linear antialiased p-2 px-5 my-auto font text-xs font-bold text-white nice-shadow flex space-x-2 items-center"
                  >
                    <Plus className="w-4 h-4" />
                    <span>{t('podcasts.new_podcast')}</span>
                  </button>
                </AuthenticatedClientElement>
              </div>
            </div>
          </div>
        )}
      </div>

      <CreatePodcastModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        orgId={org_id}
        orgSlug={orgslug}
      />
    </div>
  )
}

export default PodcastsDashClient
