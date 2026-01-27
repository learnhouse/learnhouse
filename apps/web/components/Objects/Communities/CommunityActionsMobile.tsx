'use client'
import React from 'react'
import Link from 'next/link'
import { Plus, Settings, MessageCircle } from 'lucide-react'
import { Community } from '@services/communities/communities'
import { useCommunityRights } from '@components/Hooks/useCommunityRights'
import { getUriWithOrg } from '@services/config/config'

interface CommunityActionsMobileProps {
  community: Community
  orgslug: string
  onCreateDiscussion?: () => void
}

export function CommunityActionsMobile({
  community,
  orgslug,
  onCreateDiscussion,
}: CommunityActionsMobileProps) {
  const { canManageCommunity, canCreateDiscussion } = useCommunityRights(community.community_uuid)

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 md:hidden">
      <div className="mx-3 mb-4 bg-white/95 backdrop-blur-sm rounded-xl nice-shadow p-3">
        <div className="flex items-center gap-3">
          {/* Community Icon */}
          <div className="flex-shrink-0 w-9 h-9 bg-gray-100 rounded-lg flex items-center justify-center">
            <MessageCircle size={18} className="text-gray-500" />
          </div>

          {/* Community Name */}
          <div className="flex-1 min-w-0">
            <p className="font-medium text-gray-900 truncate text-sm">{community.name}</p>
            <p className="text-xs text-gray-400">
              {community.public ? 'Public' : 'Private'}
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2">
            {canManageCommunity && (
              <Link
                href={getUriWithOrg(orgslug, '/dash/communities')}
                className="p-2 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                aria-label="Manage community"
              >
                <Settings size={16} className="text-gray-600" />
              </Link>
            )}
            {canCreateDiscussion && onCreateDiscussion && (
              <button
                onClick={onCreateDiscussion}
                className="flex items-center gap-1.5 px-3 py-2 bg-neutral-900 hover:bg-neutral-800 text-white rounded-lg transition-colors text-sm font-medium"
              >
                <Plus size={14} />
                New
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default CommunityActionsMobile
