'use client'
import React from 'react'
import { Users, MessageCircle, Plus, Globe, Lock, Settings } from 'lucide-react'
import { Community } from '@services/communities/communities'
import { useCommunityRights } from '@components/Hooks/useCommunityRights'
import { useLHSession } from '@components/Contexts/LHSessionContext'

interface CommunityActionsProps {
  community: Community
  discussionCount: number
  onEdit?: () => void
  onCreateDiscussion?: () => void
}

export function CommunityActions({
  community,
  discussionCount,
  onEdit,
  onCreateDiscussion,
}: CommunityActionsProps) {
  const session = useLHSession() as any
  const { canManageCommunity, canCreateDiscussion } = useCommunityRights(community.community_uuid)

  const renderStatsSection = () => {
    return (
      <div className="relative bg-white nice-shadow rounded-lg overflow-hidden">
        <div
          className="absolute inset-0 opacity-[0.05]"
          style={{
            backgroundImage: 'radial-gradient(circle at center, #101010 1px, transparent 1px)',
            backgroundSize: '12px 12px'
          }}
        />
        <div className="relative p-4">
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-4">
                <div className="relative w-16 h-16">
                  <svg className="w-full h-full transform -rotate-90">
                    <circle
                      cx="32"
                      cy="32"
                      r="28"
                      stroke="#e5e7eb"
                      strokeWidth="6"
                      fill="none"
                    />
                    <circle
                      cx="32"
                      cy="32"
                      r="28"
                      stroke="#6366f1"
                      strokeWidth="6"
                      fill="none"
                      strokeLinecap="round"
                      strokeDasharray={2 * Math.PI * 28}
                      strokeDashoffset={0}
                      className="transition-all duration-500 ease-out"
                    />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <MessageCircle className="w-6 h-6 text-indigo-500" />
                  </div>
                </div>
                <div className="flex-1">
                  <div className="text-sm font-medium text-gray-900">Community Activity</div>
                  <div className="text-sm text-gray-500">
                    {discussionCount} {discussionCount === 1 ? 'discussion' : 'discussions'}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white shadow-md shadow-gray-300/25 outline outline-1 outline-neutral-200/40 rounded-lg overflow-hidden p-4">
      <div className="space-y-4">
        {/* Stats Section */}
        {renderStatsSection()}

        {/* Privacy Status */}
        <div className={`p-3 rounded-lg nice-shadow flex items-center gap-3 ${
          community.public
            ? 'bg-green-50 border border-green-200'
            : 'bg-gray-50 border border-gray-200'
        }`}>
          {community.public ? (
            <>
              <div className="w-2 h-2 bg-green-500 rounded-full" />
              <div className="flex items-center gap-2">
                <Globe size={16} className="text-green-600" />
                <span className="text-green-800 font-medium text-sm">Public Community</span>
              </div>
            </>
          ) : (
            <>
              <div className="w-2 h-2 bg-gray-400 rounded-full" />
              <div className="flex items-center gap-2">
                <Lock size={16} className="text-gray-600" />
                <span className="text-gray-700 font-medium text-sm">Private Community</span>
              </div>
            </>
          )}
        </div>

        {/* Create Discussion Button */}
        {canCreateDiscussion && onCreateDiscussion && (
          <button
            onClick={onCreateDiscussion}
            className="w-full py-3 rounded-lg nice-shadow font-semibold transition-colors flex items-center justify-center gap-2 cursor-pointer bg-neutral-900 text-white hover:bg-neutral-800"
          >
            <Plus className="w-5 h-5" />
            <span>New Discussion</span>
          </button>
        )}

        {/* Manage Button */}
        {canManageCommunity && onEdit && (
          <button
            onClick={onEdit}
            className="w-full bg-white text-neutral-700 border border-neutral-200 py-3 rounded-lg nice-shadow font-semibold hover:bg-neutral-50 transition-colors flex items-center justify-center gap-2 cursor-pointer"
          >
            <Settings className="w-5 h-5" />
            Manage Community
          </button>
        )}
      </div>
    </div>
  )
}

export default CommunityActions
