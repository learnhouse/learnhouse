'use client'

import React, { useState } from 'react'
import dynamic from 'next/dynamic'
import GeneralWrapperStyled from '@components/Objects/StyledElements/Wrappers/GeneralWrapper'
import { Breadcrumbs } from '@components/Objects/Breadcrumbs/Breadcrumbs'
import { CommunitySidebar } from '@components/Objects/Communities/CommunitySidebar'
import { MessageCircle } from 'lucide-react'
import { getUriWithOrg } from '@services/config/config'
import { CommunityActionsMobile } from '@components/Objects/Communities/CommunityActionsMobile'
import { DiscussionList } from '@components/Objects/Communities/DiscussionList'
import { Community } from '@services/communities/communities'
import { isRichContentAllowed } from '@components/Objects/Communities/richContent'
import { DiscussionWithAuthor } from '@services/communities/discussions'
import { useMediaQuery } from 'usehooks-ts'
import { useTrackView, AnalyticsEvent } from '@services/analytics'
import { useTranslation } from 'react-i18next'
import { useCommunityRights } from '@components/Hooks/useCommunityRights'
import { useShortcut } from '@/lib/shortcuts/ShortcutsContext'
import ListShortcuts from '@components/Objects/Shortcuts/ListShortcuts'
import ResourcePaywall, { useResourcePaywall } from '@ee/components/Payments/ResourcePaywall'

// The editor (tiptap) behind it only matters once someone starts a discussion.
const CreateDiscussionModal = dynamic(
  () => import('@components/Objects/Modals/Communities/CreateDiscussionModal').then((m) => m.CreateDiscussionModal),
  { ssr: false }
)

interface CommunityClientProps {
  community: Community
  initialDiscussions: DiscussionWithAuthor[]
  orgslug: string
  org_id: number
}

const CommunityClient = ({
  community,
  initialDiscussions,
  orgslug,
  org_id,
}: CommunityClientProps) => {
  const [isCreateDiscussionModalOpen, setIsCreateDiscussionModalOpen] = useState(false)
  // Mounted on first open and kept, so closing still animates out.
  const [createModalMounted, setCreateModalMounted] = useState(false)
  if (isCreateDiscussionModalOpen && !createModalMounted) setCreateModalMounted(true)
  const isMobile = useMediaQuery('(max-width: 768px)')
  // People who have not bought a sold community can't post in it.
  const { locked } = useResourcePaywall(org_id, community.community_uuid)
  const openCreateDiscussion = locked ? undefined : () => setIsCreateDiscussionModalOpen(true)
  const { t } = useTranslation()
  const { canCreateDiscussion } = useCommunityRights(community.community_uuid)
  useShortcut(
    { id: 'community.new', keys: 'n', group: 'page', label: t('shortcuts.new_discussion'),
      run: () => setIsCreateDiscussionModalOpen(true) },
    !!canCreateDiscussion,
  )

  useTrackView(AnalyticsEvent.CommunityViewed, {
    community_uuid: community.community_uuid,
    is_public: community.public,
    initial_discussion_count: initialDiscussions.length,
  })

  return (
    <>
      <GeneralWrapperStyled>
        <ListShortcuts />
        {/* Breadcrumbs */}
        <div className="pb-4">
          <Breadcrumbs items={[
            { label: 'Communities', href: getUriWithOrg(orgslug, '/communities'), icon: <MessageCircle size={14} /> },
            { label: community.name }
          ]} />
        </div>

        {/* Forum Layout - Sidebar Left, Content Right */}
        <div className="flex flex-col md:flex-row gap-6 pt-2">
          {/* Left Sidebar - Community Info (Desktop only) */}
          <div className="hidden md:block w-full md:w-72 lg:w-80 flex-shrink-0">
            <div className="sticky top-24">
              <CommunitySidebar
                community={community}
                discussionCount={initialDiscussions.length}
                orgslug={orgslug}
                onCreateDiscussion={openCreateDiscussion}
              />
            </div>
          </div>

          {/* Main Content - Discussions Feed */}
          <div className="flex-1 min-w-0">
            {/* Mobile only shows community name */}
            <div className="md:hidden mb-4">
              <h1 className="text-xl font-bold text-gray-900">{community.name}</h1>
              {community.description && (
                <p className="mt-1 text-sm text-gray-500 line-clamp-2">
                  {community.description}
                </p>
              )}
            </div>

            {/* Discussions List, or what unlocks it when the community is sold */}
            <ResourcePaywall orgId={org_id} orgslug={orgslug} resourceUuid={community.community_uuid} resourceName={community.name}>
              <div className="bg-white nice-shadow rounded-lg overflow-hidden">
                <DiscussionList
                  communityUuid={community.community_uuid}
                  orgslug={orgslug}
                  onCreateClick={() => setIsCreateDiscussionModalOpen(true)}
                  initialDiscussions={initialDiscussions}
                />
              </div>
            </ResourcePaywall>
          </div>
        </div>

        {/* Bottom padding for mobile action bar */}
        {isMobile && <div className="h-24" />}
      </GeneralWrapperStyled>

      {/* Mobile Actions Bar */}
      {isMobile && (
        <CommunityActionsMobile
          community={community}
          orgslug={orgslug}
          onCreateDiscussion={openCreateDiscussion}
        />
      )}

      {/* Modals */}
      {createModalMounted && (
        <CreateDiscussionModal
          isOpen={isCreateDiscussionModalOpen}
          onClose={() => setIsCreateDiscussionModalOpen(false)}
          allowRichContent={isRichContentAllowed(community)}
          communityUuid={community.community_uuid}
          orgSlug={orgslug}
        />
      )}
    </>
  )
}

export default CommunityClient
