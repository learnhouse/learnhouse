'use client'
import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'

dayjs.extend(relativeTime)
import { Users, MessageCircle, ArrowRight, ChevronUp } from 'lucide-react'
import { getUriWithOrg } from '@services/config/config'
import { getCommunityByCourse, Community } from '@services/communities/communities'
import { getDiscussions, DiscussionWithAuthor } from '@services/communities/discussions'
import { useLHSession } from '@components/Contexts/LHSessionContext'

interface CourseCommunitySection {
  courseUuid: string
  orgslug: string
}

export function CourseCommunitySection({ courseUuid, orgslug }: CourseCommunitySection) {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token
  const [community, setCommunity] = useState<Community | null>(null)
  const [discussions, setDiscussions] = useState<DiscussionWithAuthor[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const fetchCommunity = async () => {
      setIsLoading(true)
      try {
        const communityData = await getCommunityByCourse(courseUuid, null, accessToken)
        if (communityData) {
          setCommunity(communityData)

          // Fetch recent discussions
          const discussionsData = await getDiscussions(
            communityData.community_uuid,
            'recent',
            1,
            3,
            null,
            accessToken
          )
          setDiscussions(discussionsData || [])
        }
      } catch (error) {
        console.error('Failed to fetch community:', error)
      } finally {
        setIsLoading(false)
      }
    }

    if (courseUuid) {
      fetchCommunity()
    }
  }, [courseUuid, accessToken])

  if (isLoading || !community) {
    return null
  }

  const communityId = community.community_uuid.replace('community_', '')

  return (
    <div className="w-full my-5">
      <h2 className="py-5 text-xl md:text-2xl font-bold flex items-center gap-2">
        <Users size={24} className="text-blue-600" />
        {t('communities.course_section.title')}
      </h2>
      <div className="bg-white shadow-md shadow-gray-300/25 outline outline-1 outline-neutral-200/40 rounded-lg overflow-hidden">
        {/* Header */}
        <div className="p-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-gray-900">{community.name}</h3>
            {community.description && (
              <p className="text-sm text-gray-500 mt-0.5">{community.description}</p>
            )}
          </div>
          <Link
            href={getUriWithOrg(orgslug, `/community/${communityId}`)}
            className="flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-700 transition-colors"
          >
            {t('communities.course_section.view_all')}
            <ArrowRight size={14} />
          </Link>
        </div>

        {/* Recent Discussions */}
        <div className="divide-y divide-gray-50">
          {discussions.length === 0 ? (
            <div className="p-6 text-center">
              <MessageCircle size={32} className="mx-auto text-gray-300 mb-2" />
              <p className="text-sm text-gray-500">{t('communities.course_section.no_discussions')}</p>
              <Link
                href={getUriWithOrg(orgslug, `/community/${communityId}`)}
                className="inline-block mt-3 text-sm font-medium text-blue-600 hover:text-blue-700"
              >
                {t('communities.course_section.start_first')}
              </Link>
            </div>
          ) : (
            discussions.map((discussion) => {
              const discussionId = discussion.discussion_uuid.replace('discussion_', '')
              const timeAgo = dayjs(discussion.creation_date).fromNow()
              const authorName = discussion.author
                ? `${discussion.author.first_name} ${discussion.author.last_name}`.trim() || discussion.author.username
                : t('common.unknown')

              return (
                <Link
                  key={discussion.discussion_uuid}
                  href={getUriWithOrg(orgslug, `/community/${communityId}/discussion/${discussionId}`)}
                  className="block p-4 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex flex-col items-center gap-0.5 bg-gray-100 px-2 py-1 rounded-lg">
                      <ChevronUp size={14} className="text-gray-500" />
                      <span className="text-xs font-semibold text-gray-600">
                        {discussion.upvote_count}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="font-medium text-gray-900 line-clamp-1">
                        {discussion.title}
                      </h4>
                      <p className="text-xs text-gray-400 mt-1">
                        {authorName} · {timeAgo}
                      </p>
                    </div>
                  </div>
                </Link>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}

export default CourseCommunitySection
