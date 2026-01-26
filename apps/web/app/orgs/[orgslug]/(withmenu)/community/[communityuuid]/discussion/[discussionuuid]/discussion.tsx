'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import GeneralWrapperStyled from '@components/Objects/StyledElements/Wrappers/GeneralWrapper'
import { DiscussionDetail } from '@components/Objects/Communities/DiscussionDetail'
import { DiscussionSidebar } from '@components/Objects/Communities/DiscussionSidebar'
import { Breadcrumbs } from '@components/Objects/Breadcrumbs/Breadcrumbs'
import { EditDiscussionModal } from '@components/Objects/Modals/Communities/EditDiscussionModal'
import { Community } from '@services/communities/communities'
import { DiscussionWithAuthor } from '@services/communities/discussions'
import { MessageCircle } from 'lucide-react'
import { getUriWithOrg } from '@services/config/config'

interface DiscussionPageClientProps {
  discussion: DiscussionWithAuthor
  community: Community
  orgslug: string
}

const DiscussionPageClient = ({
  discussion: initialDiscussion,
  community,
  orgslug,
}: DiscussionPageClientProps) => {
  const router = useRouter()
  const [discussion, setDiscussion] = useState(initialDiscussion)
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)

  const handleDiscussionUpdated = (updated: DiscussionWithAuthor) => {
    setDiscussion(updated)
    router.refresh()
  }

  return (
    <GeneralWrapperStyled>
      {/* Breadcrumbs */}
      <div className="pb-4">
        <Breadcrumbs items={[
          { label: 'Communities', href: getUriWithOrg(orgslug, '/communities'), icon: <MessageCircle size={14} /> },
          { label: community.name, href: getUriWithOrg(orgslug, `/community/${community.community_uuid.replace('community_', '')}`) },
          { label: discussion.title }
        ]} />
      </div>

      {/* Layout - Sidebar Left, Content Right */}
      <div className="flex flex-col md:flex-row gap-6 pt-2">
        {/* Left Sidebar - Discussion Info (Desktop only) */}
        <div className="hidden md:block w-full md:w-72 lg:w-80 flex-shrink-0">
          <div className="sticky top-24">
            <DiscussionSidebar
              discussion={discussion}
              community={community}
              orgslug={orgslug}
            />
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 min-w-0">
          <DiscussionDetail
            discussion={discussion}
            communityUuid={community.community_uuid}
            orgslug={orgslug}
            onEdit={() => setIsEditModalOpen(true)}
          />
        </div>
      </div>

      {/* Edit Modal */}
      <EditDiscussionModal
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        discussion={discussion}
        onUpdated={handleDiscussionUpdated}
      />
    </GeneralWrapperStyled>
  )
}

export default DiscussionPageClient
