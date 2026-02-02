'use client'

import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import AuthenticatedClientElement from '@components/Security/AuthenticatedClientElement'
import TypeOfContentTitle from '@components/Objects/StyledElements/Titles/TypeOfContentTitle'
import GeneralWrapperStyled from '@components/Objects/StyledElements/Wrappers/GeneralWrapper'
import CommunityCard from '@components/Objects/Communities/CommunityCard'
import { CreateCommunityModal } from '@components/Objects/Modals/Communities/CreateCommunityModal'
import { EditCommunityModal } from '@components/Objects/Modals/Communities/EditCommunityModal'
import ContentPlaceHolderIfUserIsNotAdmin from '@components/Objects/ContentPlaceHolder'
import { Users, Plus, MessagesSquare } from 'lucide-react'
import { Community } from '@services/communities/communities'
import FeatureDisabledView from '@components/Dashboard/Shared/FeatureDisabled/FeatureDisabledView'

interface CommunitiesClientProps {
  communities: Community[]
  orgslug: string
  org_id: number
}

const CommunitiesClient = ({ communities, orgslug, org_id }: CommunitiesClientProps) => {
  const { t } = useTranslation()
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [editingCommunity, setEditingCommunity] = useState<Community | null>(null)

  return (
    <FeatureDisabledView
      featureName="communities"
      orgslug={orgslug}
      icon={MessagesSquare}
      context="public"
    >
    <GeneralWrapperStyled>
      <div className="flex flex-col space-y-2 mb-6">
        <div className="flex items-center justify-between">
          <TypeOfContentTitle title={t('communities.title')} type="col" />
          <AuthenticatedClientElement
            ressourceType="communities"
            action="create"
            checkMethod="roles"
            orgId={org_id}
          >
            <button
              onClick={() => setIsCreateModalOpen(true)}
              className="flex items-center gap-2 px-4 py-2 bg-black hover:bg-black/90 text-white rounded-lg transition-colors text-sm font-medium"
            >
              <Plus size={16} />
              {t('communities.new_community')}
            </button>
          </AuthenticatedClientElement>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {communities.map((community: Community) => (
            <div key={community.community_uuid}>
              <CommunityCard
                community={community}
                orgslug={orgslug}
                org_id={org_id}
                variant="public"
              />
            </div>
          ))}
          {communities.length === 0 && (
            <div className="col-span-full flex flex-col justify-center items-center py-12 px-4 border-2 border-dashed border-gray-100 rounded-2xl bg-gray-50/30">
              <div className="p-4 bg-white rounded-full nice-shadow mb-4">
                <Users className="w-8 h-8 text-gray-300" strokeWidth={1.5} />
              </div>
              <h1 className="text-xl font-bold text-gray-600 mb-2">
                {t('communities.no_communities')}
              </h1>
              <p className="text-md text-gray-400 mb-6 text-center max-w-xs">
                <ContentPlaceHolderIfUserIsNotAdmin
                  text={t('communities.no_communities_description')}
                />
              </p>
              <div className="flex justify-center">
                <AuthenticatedClientElement
                  checkMethod="roles"
                  ressourceType="communities"
                  action="create"
                  orgId={org_id}
                >
                  <button
                    onClick={() => setIsCreateModalOpen(true)}
                    className="flex items-center gap-2 px-4 py-2 bg-black hover:bg-black/90 text-white rounded-lg transition-colors text-sm font-medium"
                  >
                    <Plus size={16} />
                    {t('communities.new_community')}
                  </button>
                </AuthenticatedClientElement>
              </div>
            </div>
          )}
        </div>
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
    </GeneralWrapperStyled>
    </FeatureDisabledView>
  )
}

export default CommunitiesClient
