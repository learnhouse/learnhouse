'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Users, MessagesSquare } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useOrg } from '@components/Contexts/OrgContext'
import { Community } from '@services/communities/communities'
import { CreateCommunityModal } from '@components/Objects/Modals/Communities/CreateCommunityModal'
import { EditCommunityModal } from '@components/Objects/Modals/Communities/EditCommunityModal'
import { Breadcrumbs } from '@components/Objects/Breadcrumbs/Breadcrumbs'
import CommunityCard from '@components/Objects/Communities/CommunityCard'
import AuthenticatedClientElement from '@components/Security/AuthenticatedClientElement'
import PlanRestrictedFeature from '@components/Dashboard/Shared/PlanRestricted/PlanRestrictedFeature'
import { FeatureDisabledBanner } from '@components/Dashboard/Shared/FeatureDisabled/FeatureDisabledView'
import { PlanLevel } from '@services/plans/plans'

interface CommunitiesDashClientProps {
  org_id: number
  orgslug: string
  communities: Community[]
}

const CommunitiesDashClient = ({
  org_id,
  orgslug,
  communities,
}: CommunitiesDashClientProps) => {
  const { t } = useTranslation()
  const router = useRouter()
  const org = useOrg() as any
  const currentPlan: PlanLevel = org?.config?.config?.cloud?.plan || 'free'

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [editingCommunity, setEditingCommunity] = useState<Community | null>(null)

  return (
    <PlanRestrictedFeature
      currentPlan={currentPlan}
      requiredPlan="standard"
      icon={MessagesSquare}
      titleKey="common.plans.feature_restricted.communities.title"
      descriptionKey="common.plans.feature_restricted.communities.description"
      fullScreen
    >
    <div className="h-full w-full bg-[#f8f8f8] pl-10 pr-10">
      <div className="mb-6 pt-6">
        <FeatureDisabledBanner featureName="communities" orgslug={orgslug} />
        <Breadcrumbs items={[
          { label: t('dashboard.courses.communities.title'), href: '/dash/communities', icon: <MessagesSquare size={14} /> }
        ]} />
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mt-4">
          <div className="flex items-center space-x-4">
            <h1 className="text-3xl font-bold mb-4 sm:mb-0">{t('dashboard.courses.communities.title')}</h1>
          </div>
          <AuthenticatedClientElement
            checkMethod="roles"
            action="create"
            ressourceType="communities"
            orgId={org_id}
          >
            <button
              onClick={() => setIsCreateModalOpen(true)}
              className="rounded-lg bg-black hover:scale-105 transition-all duration-100 ease-linear antialiased p-2 px-5 my-auto font text-xs font-bold text-white nice-shadow flex space-x-2 items-center"
            >
              <Plus className="w-4 h-4" />
              <span>{t('dashboard.courses.communities.new_community')}</span>
            </button>
          </AuthenticatedClientElement>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {communities.map((community) => (
          <div key={community.community_uuid}>
            <CommunityCard
              community={community}
              orgslug={orgslug}
              org_id={org_id}
              onEdit={() => setEditingCommunity(community)}
            />
          </div>
        ))}
        {communities.length === 0 && (
          <div className="col-span-full flex justify-center items-center py-8">
            <div className="text-center">
              <div className="mb-4">
                <div className="w-24 h-24 mx-auto bg-gray-100 rounded-full flex items-center justify-center">
                  <Users size={48} className="text-gray-300" />
                </div>
              </div>
              <h2 className="text-2xl font-bold text-gray-600 mb-2">
                {t('dashboard.courses.communities.no_communities')}
              </h2>
              <p className="text-lg text-gray-400">
                {t('dashboard.courses.communities.no_communities_description')}
              </p>
              <div className="mt-6 flex justify-center">
                <AuthenticatedClientElement
                  action="create"
                  ressourceType="communities"
                  checkMethod="roles"
                  orgId={org_id}
                >
                  <button
                    onClick={() => setIsCreateModalOpen(true)}
                    className="rounded-lg bg-black hover:scale-105 transition-all duration-100 ease-linear antialiased p-2 px-5 my-auto font text-xs font-bold text-white nice-shadow flex space-x-2 items-center"
                  >
                    <Plus className="w-4 h-4" />
                    <span>{t('dashboard.courses.communities.new_community')}</span>
                  </button>
                </AuthenticatedClientElement>
              </div>
            </div>
          </div>
        )}
      </div>

      <CreateCommunityModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        orgId={org_id}
        orgSlug={orgslug}
      />

      {editingCommunity && (
        <EditCommunityModal
          isOpen={!!editingCommunity}
          onClose={() => setEditingCommunity(null)}
          community={editingCommunity}
          orgSlug={orgslug}
        />
      )}
    </div>
    </PlanRestrictedFeature>
  )
}

export default CommunitiesDashClient
