'use client'
import React from 'react'
import Link from 'next/link'
import {
  MessageCircle,
  Plus,
  Globe,
  Lock,
  Settings,
  Calendar,
  BookOpen,
  ChevronRight,
} from 'lucide-react'
import { Community } from '@services/communities/communities'
import { getCommunityThumbnailMediaDirectory, getCourseThumbnailMediaDirectory } from '@services/media/media'
import { useCommunityRights } from '@components/Hooks/useCommunityRights'
import { useOrg } from '@components/Contexts/OrgContext'
import { getAPIUrl, getUriWithOrg } from '@services/config/config'
import { swrFetcher } from '@services/utils/ts/requests'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import useSWR from 'swr'
import dayjs from 'dayjs'
import { SafeImage } from '@components/Objects/SafeImage'

interface CommunitySidebarProps {
  community: Community
  discussionCount: number
  orgslug: string
  onCreateDiscussion?: () => void
}

export function CommunitySidebar({
  community,
  discussionCount,
  orgslug,
  onCreateDiscussion,
}: CommunitySidebarProps) {
  const { canManageCommunity, canCreateDiscussion } = useCommunityRights(community.community_uuid)
  const org = useOrg() as any
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token

  // Fetch linked course if community has a course_id
  const { data: linkedCourse } = useSWR(
    community.course_id ? `${getAPIUrl()}courses/id/${community.course_id}` : null,
    (url: string) => swrFetcher(url, accessToken),
    { revalidateOnFocus: false }
  )

  const createdDate = dayjs(community.creation_date).format('MMM D, YYYY')

  const thumbnailUrl = community.thumbnail_image && org?.org_uuid
    ? getCommunityThumbnailMediaDirectory(
        org.org_uuid,
        community.community_uuid,
        community.thumbnail_image
      )
    : null

  const courseThumbnailUrl = linkedCourse?.thumbnail_image && org?.org_uuid
    ? getCourseThumbnailMediaDirectory(
        org.org_uuid,
        linkedCourse.course_uuid,
        linkedCourse.thumbnail_image
      )
    : null

  return (
    <div className="space-y-4">
      {/* Community Info Card */}
      <div className="bg-white nice-shadow rounded-lg overflow-hidden">
        {/* Header with community name */}
        <div className="p-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            {thumbnailUrl ? (
              <SafeImage
                src={thumbnailUrl}
                alt={community.name}
                className="w-10 h-10 rounded-lg object-cover flex-shrink-0"
              />
            ) : (
              <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0">
                <MessageCircle className="w-5 h-5 text-gray-400" />
              </div>
            )}
            <div className="min-w-0">
              <h2 className="font-semibold text-gray-900 truncate">{community.name}</h2>
              <div className="flex items-center gap-1.5 text-xs text-gray-500">
                {community.public ? (
                  <>
                    <Globe size={12} className="text-green-500" />
                    <span>Public</span>
                  </>
                ) : (
                  <>
                    <Lock size={12} className="text-gray-400" />
                    <span>Private</span>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Description */}
        {community.description && (
          <div className="px-4 py-3 border-b border-gray-100">
            <p className="text-sm text-gray-600 leading-relaxed">
              {community.description}
            </p>
          </div>
        )}

        {/* Stats */}
        <div className="px-4 py-3 space-y-2">
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <MessageCircle size={14} className="text-gray-400" />
            <span>{discussionCount} {discussionCount === 1 ? 'discussion' : 'discussions'}</span>
          </div>
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <Calendar size={14} className="text-gray-400" />
            <span>Created {createdDate}</span>
          </div>
        </div>

        {/* Linked Course */}
        {linkedCourse && (
          <div className="px-4 py-3 border-t border-gray-100">
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
              Linked Course
            </div>
            <Link
              href={getUriWithOrg(orgslug, `/course/${linkedCourse.course_uuid.replace('course_', '')}`)}
              className="group block"
            >
              <div className="flex items-center gap-3 p-2 -mx-2 rounded-lg hover:bg-gray-50 transition-colors">
                {courseThumbnailUrl ? (
                  <SafeImage
                    src={courseThumbnailUrl}
                    alt={linkedCourse.name}
                    className="w-12 h-12 rounded-lg object-cover flex-shrink-0"
                  />
                ) : (
                  <div className="w-12 h-12 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0">
                    <BookOpen size={20} className="text-gray-400" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <h4 className="text-sm font-medium text-gray-900 group-hover:text-indigo-600 transition-colors truncate">
                    {linkedCourse.name}
                  </h4>
                  {linkedCourse.description && (
                    <p className="text-xs text-gray-500 line-clamp-1 mt-0.5">
                      {linkedCourse.description}
                    </p>
                  )}
                </div>
                <ChevronRight size={16} className="text-gray-400 group-hover:text-indigo-600 transition-colors flex-shrink-0" />
              </div>
            </Link>
          </div>
        )}

        {/* Actions */}
        <div className="p-4 border-t border-gray-100 space-y-2">
          {canCreateDiscussion && onCreateDiscussion && (
            <button
              onClick={onCreateDiscussion}
              className="w-full py-2.5 rounded-lg font-medium transition-colors flex items-center justify-center gap-2 cursor-pointer bg-neutral-900 text-white hover:bg-neutral-800 text-sm"
            >
              <Plus className="w-4 h-4" />
              <span>New Discussion</span>
            </button>
          )}

          {canManageCommunity && (
            <Link
              href={getUriWithOrg(orgslug, '/dash/communities')}
              className="w-full bg-white text-neutral-600 border border-neutral-200 py-2.5 rounded-lg font-medium hover:bg-neutral-50 transition-colors flex items-center justify-center gap-2 text-sm"
            >
              <Settings className="w-4 h-4" />
              Manage
            </Link>
          )}
        </div>
      </div>

      {/* Quick Tips Card */}
      <div className="bg-white nice-shadow rounded-lg overflow-hidden p-4">
        <h3 className="font-medium text-gray-900 mb-2 text-sm">Community Guidelines</h3>
        <p className="text-xs text-gray-500 leading-relaxed">
          Be respectful and constructive. Help others and share your knowledge with the community.
        </p>
      </div>
    </div>
  )
}

export default CommunitySidebar
