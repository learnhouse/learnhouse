'use client'

import React, { useState } from 'react'
import dynamic from 'next/dynamic'
import { useQuery } from '@tanstack/react-query'
import { PencilSimpleLine } from '@phosphor-icons/react'
import GeneralWrapperStyled from '@components/Objects/StyledElements/Wrappers/GeneralWrapper'
import { CommunityAbout, CommunityHero } from '@components/Objects/Communities/CommunityHero'
import { DiscussionList } from '@components/Objects/Communities/DiscussionList'
import { Community, getCommunitiesSummary } from '@services/communities/communities'
import { isRichContentAllowed } from '@components/Objects/Communities/richContent'
import { DiscussionWithAuthor } from '@services/communities/discussions'
import { useTrackView, AnalyticsEvent } from '@services/analytics'
import { useTranslation } from 'react-i18next'
import { useCommunityRights } from '@components/Hooks/useCommunityRights'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrgMembership } from '@components/Contexts/OrgContext'
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

const CommunityClient = ({ community, initialDiscussions, orgslug, org_id }: CommunityClientProps) => {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token
  const [isCreateDiscussionModalOpen, setIsCreateDiscussionModalOpen] = useState(false)
  // Mounted on first open and kept, so closing still animates out.
  const [createModalMounted, setCreateModalMounted] = useState(false)
  if (isCreateDiscussionModalOpen && !createModalMounted) setCreateModalMounted(true)
  // People who have not bought a sold community can't post in it.
  const { locked } = useResourcePaywall(org_id, community.community_uuid)
  const { canCreateDiscussion } = useCommunityRights(community.community_uuid)
  const { isUserPartOfTheOrg } = useOrgMembership()
  const canPost = !!canCreateDiscussion && isUserPartOfTheOrg && !locked
  const openCreateDiscussion = canPost ? () => setIsCreateDiscussionModalOpen(true) : undefined
  useShortcut(
    {
      id: 'community.new',
      keys: 'n',
      group: 'page',
      label: t('shortcuts.new_discussion'),
      run: () => setIsCreateDiscussionModalOpen(true),
    },
    canPost
  )

  // Same summary call as the catalog, so it is usually already cached.
  const { data: summaries } = useQuery({
    queryKey: ['communities', org_id, 'summary', !!accessToken],
    queryFn: () => getCommunitiesSummary(org_id, accessToken),
    enabled: session?.status !== 'loading',
    staleTime: 60_000,
    retry: false,
  })
  const summary = summaries?.find((s) => s.community_uuid === community.community_uuid) ?? null

  useTrackView(AnalyticsEvent.CommunityViewed, {
    community_uuid: community.community_uuid,
    is_public: community.public,
    initial_discussion_count: initialDiscussions.length,
  })

  return (
    <>
      <GeneralWrapperStyled>
        <ListShortcuts />
        <div className="flex flex-col gap-6">
          <CommunityHero
            community={community}
            summary={summary}
            orgslug={orgslug}
            onCreateDiscussion={openCreateDiscussion}
          />

          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px] gap-6 items-start">
            {/* Feed, or what unlocks it when the community is sold */}
            <ResourcePaywall
              orgId={org_id}
              orgslug={orgslug}
              resourceUuid={community.community_uuid}
              resourceName={community.name}
            >
              <DiscussionList
                communityUuid={community.community_uuid}
                orgslug={orgslug}
                onCreateClick={openCreateDiscussion}
                initialDiscussions={initialDiscussions}
                allowRichContent={isRichContentAllowed(community)}
              />
            </ResourcePaywall>
            <aside className="lg:sticky lg:top-[calc(6rem+var(--lh-company-bar-h,0px))]">
              <CommunityAbout community={community} orgslug={orgslug} />
            </aside>
          </div>
        </div>
      </GeneralWrapperStyled>

      {/* Phones: the post button stays in reach while scrolling the feed. */}
      {openCreateDiscussion && (
        <button
          type="button"
          onClick={openCreateDiscussion}
          aria-label={t('communities.new_discussion')}
          className="md:hidden fixed end-4 bottom-[calc(var(--lh-mobile-nav-h,0px)+16px)] z-40 h-12 w-12 rounded-full bg-neutral-900 text-white shadow-xl flex items-center justify-center active:scale-95 transition-transform"
        >
          <PencilSimpleLine size={20} />
        </button>
      )}

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
