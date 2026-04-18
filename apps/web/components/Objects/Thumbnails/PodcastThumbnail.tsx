'use client'
import { useOrg } from '@components/Contexts/OrgContext'
import AuthenticatedClientElement from '@components/Security/AuthenticatedClientElement'
import ConfirmationModal from '@components/Objects/StyledElements/ConfirmationModal/ConfirmationModal'
import { getUriWithOrg } from '@services/config/config'
import { deletePodcast, removePodcastPrefix } from '@services/podcasts/podcasts'
import { getPodcastThumbnailMediaDirectory, getUserAvatarMediaDirectory } from '@services/media/media'
import { mutate } from 'swr'
import { Trash2, FilePenLine, Settings2, MoreVertical, Play, Headphones } from 'lucide-react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import Link from 'next/link'
import React from 'react'
import toast from 'react-hot-toast'
import UserAvatar from '@components/Objects/UserAvatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@components/ui/dropdown-menu"
import { useTranslation } from 'react-i18next'

type Podcast = {
  podcast_uuid: string
  name: string
  description: string
  thumbnail_image: string
  org_id: string | number
  update_date: string
  public?: boolean
  published?: boolean
  episode_count?: number
  authors?: Array<{
    user: {
      id: string
      user_uuid: string
      avatar_image: string
      first_name: string
      last_name: string
      username: string
    }
    authorship: 'CREATOR' | 'CONTRIBUTOR' | 'MAINTAINER' | 'REPORTER'
    authorship_status: 'ACTIVE' | 'INACTIVE' | 'PENDING'
  }>
}

type PropsType = {
  podcast: Podcast
  orgslug: string
  customLink?: string
  isDashboard?: boolean
}

function PodcastThumbnail({ podcast, orgslug, customLink, isDashboard = false }: PropsType) {
  const { t, i18n } = useTranslation()
  const org = useOrg() as any
  const session = useLHSession() as any

  const activeAuthors = podcast.authors?.filter(author => author.authorship_status === 'ACTIVE') || []
  const displayedAuthors = activeAuthors.slice(0, 3)
  const hasMoreAuthors = activeAuthors.length > 3
  const remainingAuthorsCount = activeAuthors.length - 3

  const handleDeletePodcast = async () => {
    const toastId = toast.loading(t('podcasts.deleting_podcast'))
    try {
      await deletePodcast(podcast.podcast_uuid, session.data?.tokens?.access_token)
      mutate((key) => typeof key === 'string' && key.includes('/podcasts/'), undefined, { revalidate: true })
      toast.success(t('podcasts.podcast_deleted_success'))
    } catch (error) {
      toast.error(t('podcasts.podcast_deleted_error'))
    } finally {
      toast.dismiss(toastId)
    }
  }

  const thumbnailImage = podcast.thumbnail_image
    ? getPodcastThumbnailMediaDirectory(org?.org_uuid, podcast.podcast_uuid, podcast.thumbnail_image)
    : '/empty_thumbnail.png'

  const podcastLink = customLink
    ? customLink
    : isDashboard
      ? getUriWithOrg(orgslug, `/dash/podcasts/podcast/${removePodcastPrefix(podcast.podcast_uuid)}/general`)
      : getUriWithOrg(orgslug, `/podcast/${removePodcastPrefix(podcast.podcast_uuid)}`)

  return (
    <div className="group relative flex flex-col bg-white rounded-xl nice-shadow overflow-hidden w-full transition-all duration-300 hover:scale-[1.01]">
      {/* Options menu */}
      <AdminEditOptions
        podcast={podcast}
        orgSlug={orgslug}
        deletePodcast={handleDeletePodcast}
        isDashboard={isDashboard}
      />

      <Link prefetch href={podcastLink} className="block relative aspect-video overflow-hidden bg-gray-50">
        <div
          className="w-full h-full bg-cover bg-center transition-transform duration-500 group-hover:scale-105"
          style={{ backgroundImage: `url(${thumbnailImage})` }}
        />
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors duration-300 flex items-center justify-center">
          <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-300 bg-white/90 rounded-full p-3 shadow-lg">
            <Play className="w-6 h-6 text-gray-900 fill-current" />
          </div>
        </div>
        {isDashboard && (
          <div className="absolute bottom-2 start-2">
            {podcast.published ? (
              <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide bg-green-100 text-green-700 rounded-full">
                {t('podcasts.published')}
              </span>
            ) : (
              <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide bg-yellow-100 text-yellow-700 rounded-full">
                {t('podcasts.unpublished')}
              </span>
            )}
          </div>
        )}
        {podcast.episode_count !== undefined && (
          <div className="absolute bottom-2 end-2 flex items-center gap-1 bg-black/70 text-white px-2 py-0.5 rounded-full text-[10px] font-medium">
            <Headphones size={12} />
            {podcast.episode_count} {podcast.episode_count === 1 ? 'episode' : 'episodes'}
          </div>
        )}
      </Link>

      <div className="p-3 flex flex-col space-y-1.5">
        <div className="flex items-start justify-between">
          <Link
            href={podcastLink}
            className="text-base font-bold text-gray-900 leading-tight hover:text-black transition-colors line-clamp-1"
          >
            {podcast.name}
          </Link>
        </div>

        {podcast.description && (
          <p className="text-[11px] text-gray-500 line-clamp-2 min-h-[1.5rem]">
            {podcast.description}
          </p>
        )}

        <div className="pt-1.5 flex items-center justify-between border-t border-gray-100">
          <div className="flex items-center gap-2">
            {displayedAuthors.length > 0 && (
              <div className="flex -space-x-2 items-center">
                {displayedAuthors.map((author, index) => (
                  <div
                    key={author.user.user_uuid}
                    className="relative"
                    style={{ zIndex: displayedAuthors.length - index }}
                  >
                    <UserAvatar
                      border="border-2"
                      rounded="rounded-full"
                      avatar_url={author.user.avatar_image ? getUserAvatarMediaDirectory(author.user.user_uuid, author.user.avatar_image) : ''}
                      predefined_avatar={author.user.avatar_image ? undefined : 'empty'}
                      width={20}
                      showProfilePopup={true}
                      userId={author.user.id}
                    />
                  </div>
                ))}
                {hasMoreAuthors && (
                  <div className="relative z-0">
                    <div className="flex items-center justify-center w-[20px] h-[20px] text-[8px] font-bold text-gray-600 bg-gray-100 border-2 border-white rounded-full">
                      +{remainingAuthorsCount}
                    </div>
                  </div>
                )}
              </div>
            )}

            {podcast.update_date && (
              <span className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">
                {new Date(podcast.update_date).toLocaleDateString(i18n.language === 'fr' ? 'fr-FR' : 'en-US', { month: 'short', day: 'numeric' })}
              </span>
            )}
          </div>

          <Link
            href={podcastLink}
            className="text-[10px] font-bold text-gray-400 hover:text-gray-900 transition-colors uppercase tracking-wider"
          >
            {t('podcasts.listen_now')}
          </Link>
        </div>
      </div>
    </div>
  )
}

const AdminEditOptions = ({ podcast, orgSlug, deletePodcast, isDashboard = false }: {
  podcast: Podcast
  orgSlug: string
  deletePodcast: () => Promise<void>
  isDashboard?: boolean
}) => {
  const { t } = useTranslation()
  const [isOpen, setIsOpen] = React.useState(false)

  return (
    <AuthenticatedClientElement
      action="update"
      ressourceType="podcasts"
      checkMethod="roles"
      orgId={podcast.org_id}
    >
      <div className={`absolute top-2 end-2 z-20 transition-opacity ${
        isDashboard && !isOpen ? 'opacity-0 group-hover:opacity-100' : 'opacity-100'
      }`}>
        <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
          <DropdownMenuTrigger asChild>
            <button aria-label="Podcast actions" className="p-1.5 bg-white/90 backdrop-blur-sm rounded-full hover:bg-white transition-all shadow-md">
              <MoreVertical size={18} className="text-gray-700" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem asChild>
              <Link prefetch href={getUriWithOrg(orgSlug, `/dash/podcasts/podcast/${removePodcastPrefix(podcast.podcast_uuid)}/content`)} className="flex items-center cursor-pointer">
                <FilePenLine className="me-2 h-4 w-4" /> {t('podcasts.edit_content')}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link prefetch href={getUriWithOrg(orgSlug, `/dash/podcasts/podcast/${removePodcastPrefix(podcast.podcast_uuid)}/general`)} className="flex items-center cursor-pointer">
                <Settings2 className="me-2 h-4 w-4" /> {t('common.settings')}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <ConfirmationModal
                confirmationButtonText={t('podcasts.delete_podcast')}
                confirmationMessage={t('podcasts.delete_podcast_confirm')}
                dialogTitle={t('podcasts.delete_podcast_title', { name: podcast.name })}
                dialogTrigger={
                  <button className="w-full text-start flex items-center px-2 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded-md transition-colors">
                    <Trash2 className="me-2 h-4 w-4" /> {t('podcasts.delete_podcast')}
                  </button>
                }
                functionToExecute={deletePodcast}
                status="warning"
              />
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </AuthenticatedClientElement>
  )
}

export default PodcastThumbnail
