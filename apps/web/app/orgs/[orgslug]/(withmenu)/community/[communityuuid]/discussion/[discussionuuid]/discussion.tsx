'use client'

import React, { useState } from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { Garage } from '@phosphor-icons/react'
import GeneralWrapperStyled from '@components/Objects/StyledElements/Wrappers/GeneralWrapper'
import { DiscussionDetail } from '@components/Objects/Communities/DiscussionDetail'
import { DiscussionSidebar } from '@components/Objects/Communities/DiscussionSidebar'
import { Breadcrumbs } from '@components/Objects/Breadcrumbs/Breadcrumbs'
import { Community } from '@services/communities/communities'
import { isRichContentAllowed } from '@components/Objects/Communities/richContent'
import { communityHref } from '@components/Objects/Communities/communityUi'
import { DiscussionWithAuthor } from '@services/communities/discussions'
import { getUriWithOrg } from '@services/config/config'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useTrackView, AnalyticsEvent } from '@services/analytics'

// The editor (tiptap) behind it only matters once the author hits edit.
const EditDiscussionModal = dynamic(
  () => import('@components/Objects/Modals/Communities/EditDiscussionModal').then((m) => m.EditDiscussionModal),
  { ssr: false }
)

interface DiscussionPageClientProps {
  discussion: DiscussionWithAuthor
  community: Community
  orgslug: string
}

const DiscussionPageClient = ({ discussion: initialDiscussion, community, orgslug }: DiscussionPageClientProps) => {
  const { t } = useTranslation()
  const router = useRouter()
  const session = useLHSession() as any
  const [discussion, setDiscussion] = useState(initialDiscussion)
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  // Mounted on first open and kept, so closing still animates out.
  const [editModalMounted, setEditModalMounted] = useState(false)
  if (isEditModalOpen && !editModalMounted) setEditModalMounted(true)
  const allowRichContent = isRichContentAllowed(community)

  useTrackView(AnalyticsEvent.DiscussionViewed, {
    label: discussion.label,
    is_locked: discussion.is_locked,
    is_author: session?.data?.user?.id === discussion.author_id,
  })

  const handleDiscussionUpdated = (updated: DiscussionWithAuthor) => {
    setDiscussion((current) => ({ ...current, ...updated }))
    router.refresh()
  }

  return (
    <GeneralWrapperStyled>
      <div className="pb-5">
        <Breadcrumbs
          items={[
            { label: t('communities.title'), href: getUriWithOrg(orgslug, '/communities'), icon: <Garage size={14} /> },
            { label: community.name, href: communityHref(orgslug, community.community_uuid) },
            { label: discussion.title },
          ]}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px] gap-6 items-start">
        <DiscussionDetail
          discussion={discussion}
          communityUuid={community.community_uuid}
          orgslug={orgslug}
          onEdit={() => setIsEditModalOpen(true)}
          allowRichContent={allowRichContent}
          onUpdated={(updated) => setDiscussion((current) => ({ ...current, ...updated }))}
        />
        <aside className="lg:sticky lg:top-[calc(6rem+var(--lh-company-bar-h,0px))]">
          <DiscussionSidebar discussion={discussion} community={community} orgslug={orgslug} />
        </aside>
      </div>

      {editModalMounted && (
        <EditDiscussionModal
          isOpen={isEditModalOpen}
          onClose={() => setIsEditModalOpen(false)}
          discussion={discussion}
          onUpdated={handleDiscussionUpdated}
          allowRichContent={allowRichContent}
        />
      )}
    </GeneralWrapperStyled>
  )
}

export default DiscussionPageClient
