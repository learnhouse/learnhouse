'use client'

import React from 'react'
import { Podcast } from '@services/podcasts/podcasts'
import { useOrg } from '@components/Contexts/OrgContext'
import { getPodcastThumbnailMediaDirectory, getUserAvatarMediaDirectory } from '@services/media/media'
import { getUriWithOrg } from '@services/config/config'
import { removePodcastPrefix } from '@services/podcasts/podcasts'
import UserAvatar from '@components/Objects/UserAvatar'
import AuthenticatedClientElement from '@components/Security/AuthenticatedClientElement'
import { Globe, Lock, Headphones, Settings } from 'lucide-react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'

interface PodcastSidebarProps {
  podcast: Podcast
  episodeCount: number
  orgslug: string
}

export function PodcastSidebar({ podcast, episodeCount, orgslug }: PodcastSidebarProps) {
  const { t } = useTranslation()
  const org = useOrg() as any

  const thumbnailUrl = podcast.thumbnail_image && org
    ? getPodcastThumbnailMediaDirectory(org.org_uuid, podcast.podcast_uuid, podcast.thumbnail_image)
    : '/empty_thumbnail.png'

  const activeAuthors = podcast.authors?.filter(author => author.authorship_status === 'ACTIVE') || []

  return (
    <div className="bg-white rounded-lg nice-shadow overflow-hidden">
      {/* Thumbnail */}
      <div className="aspect-square w-full overflow-hidden bg-gray-100">
        <img
          src={thumbnailUrl}
          alt={podcast.name}
          className="w-full h-full object-cover"
        />
      </div>

      {/* Content */}
      <div className="p-4 space-y-4">
        {/* Name and badges */}
        <div>
          <h1 className="text-xl font-bold text-gray-900">{podcast.name}</h1>
          <div className="flex items-center gap-2 mt-2">
            {podcast.public ? (
              <span className="flex items-center gap-1 px-2 py-0.5 bg-green-100 text-green-700 rounded-full text-xs font-medium">
                <Globe size={12} />
                {t('podcasts.public')}
              </span>
            ) : (
              <span className="flex items-center gap-1 px-2 py-0.5 bg-gray-100 text-gray-700 rounded-full text-xs font-medium">
                <Lock size={12} />
                {t('podcasts.private')}
              </span>
            )}
            {!podcast.published && (
              <span className="px-2 py-0.5 bg-yellow-100 text-yellow-700 rounded-full text-xs font-medium">
                {t('podcasts.unpublished')}
              </span>
            )}
          </div>
        </div>

        {/* Description */}
        {podcast.description && (
          <p className="text-sm text-gray-600 leading-relaxed">
            {podcast.description}
          </p>
        )}

        {/* Stats */}
        <div className="flex items-center gap-4 py-3 border-y border-gray-100">
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <Headphones size={16} />
            <span>
              {episodeCount} {episodeCount === 1 ? 'episode' : 'episodes'}
            </span>
          </div>
        </div>

        {/* Authors */}
        {activeAuthors.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
              {t('podcasts.hosted_by')}
            </h3>
            <div className="space-y-2">
              {activeAuthors.map((author) => (
                <div key={author.user.user_uuid} className="flex items-center gap-2">
                  <UserAvatar
                    border="border-2"
                    rounded="rounded-full"
                    avatar_url={
                      author.user.avatar_image
                        ? getUserAvatarMediaDirectory(author.user.user_uuid, author.user.avatar_image)
                        : ''
                    }
                    predefined_avatar={author.user.avatar_image ? undefined : 'empty'}
                    width={32}
                    showProfilePopup={true}
                    userId={author.user.id}
                  />
                  <div>
                    <span className="text-sm font-medium text-gray-900">
                      {author.user.first_name} {author.user.last_name}
                    </span>
                    <span className="text-xs text-gray-500 block">
                      @{author.user.username}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tags */}
        {podcast.tags && (
          <div>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
              {t('podcasts.tags')}
            </h3>
            <div className="flex flex-wrap gap-1">
              {podcast.tags.split(',').map((tag, index) => (
                <span
                  key={index}
                  className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-xs"
                >
                  {tag.trim()}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Admin actions */}
        <AuthenticatedClientElement
          action="update"
          ressourceType="podcasts"
          checkMethod="roles"
          orgId={podcast.org_id}
        >
          <div className="pt-2">
            <Link
              href={getUriWithOrg(orgslug, `/dash/podcasts/podcast/${removePodcastPrefix(podcast.podcast_uuid)}/general`)}
              className="flex items-center justify-center gap-2 w-full px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium transition-colors"
            >
              <Settings size={16} />
              {t('podcasts.manage_podcast')}
            </Link>
          </div>
        </AuthenticatedClientElement>
      </div>
    </div>
  )
}
