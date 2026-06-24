'use client'

import React from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { useOrg } from '@components/Contexts/OrgContext'
import { getUriWithOrg } from '@services/config/config'
import { removeFolderPrefix } from '@services/folders/folders'
import CourseThumbnail from '@components/Objects/Thumbnails/CourseThumbnail'
import { getFolderThumbnailMediaDirectory } from '@services/media/media'
import { getMediaFileDirectory } from '@services/media/media-resource'
import { folderTone } from '@components/Dashboard/Library/LibraryToolbar'
import { shareFolderLink } from '@components/Dashboard/Library/shareFolder'
import { resourceHref, safeExternalUrl } from '@components/Dashboard/Library/resourceLink'
import MediaPreview from '@components/Dashboard/Library/MediaPreview'
import {
  FolderSimple,
  GraduationCap,
  MicrophoneStage,
  ChatsCircle,
  SquaresFour,
  Cube,
  LinkSimple,
  FilePdf,
  VideoCamera,
  Image as ImageIcon,
  MusicNote,
  File as FileIcon,
  ArrowSquareOut,
  type IconProps,
} from '@phosphor-icons/react'

type ResourceType = 'courses' | 'podcasts' | 'communities' | 'boards' | 'playgrounds' | 'media'

const TYPE_TONE: Record<string, string> = {
  courses: 'bg-blue-50 text-blue-500',
  media: 'bg-amber-50 text-amber-500',
  podcasts: 'bg-rose-50 text-rose-500',
  communities: 'bg-emerald-50 text-emerald-500',
  boards: 'bg-indigo-50 text-indigo-500',
  playgrounds: 'bg-fuchsia-50 text-fuchsia-500',
}

function mediaIcon(resource: any): React.ComponentType<IconProps> {
  if (resource?.media_type === 'EMBED') return LinkSimple
  const f = (resource?.file_format || '').toLowerCase()
  if (f === 'pdf') return FilePdf
  if (['mp4', 'webm', 'mov'].includes(f)) return VideoCamera
  if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(f)) return ImageIcon
  if (['mp3', 'wav', 'ogg', 'm4a'].includes(f)) return MusicNote
  return FileIcon
}

function typeIcon(type: string, resource: any): React.ComponentType<IconProps> {
  switch (type) {
    case 'courses': return GraduationCap
    case 'media': return mediaIcon(resource)
    case 'podcasts': return MicrophoneStage
    case 'communities': return ChatsCircle
    case 'boards': return SquaresFour
    case 'playgrounds': return Cube
    default: return FileIcon
  }
}

const CARD = 'group relative bg-white nice-shadow rounded-xl p-3 hover:bg-gray-50/50 transition-colors'

export function FolderCard({ folder, orgslug }: { folder: any; orgslug: string }) {
  const { t } = useTranslation()
  const org = useOrg() as any
  const count = folder.total_items ?? ((folder.items?.length || 0) + (folder.subfolders?.length || 0))
  const thumb = folder.thumbnail_image
    ? getFolderThumbnailMediaDirectory(org?.org_uuid, folder.folder_uuid, folder.thumbnail_image)
    : null
  return (
    <Link href={getUriWithOrg(orgslug, `/library/folder/${removeFolderPrefix(folder.folder_uuid)}`)} className={CARD}>
      <button
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          shareFolderLink(orgslug, folder.folder_uuid, folder.name, t('library.link_copied'), t('library.link_copy_error'))
        }}
        aria-label={t('library.share')}
        title={t('library.share')}
        className="absolute top-2 right-2 z-10 p-1 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <LinkSimple size={16} />
      </button>
      <div className="flex items-center gap-3 pr-6">
        {thumb ? (
          <div className="w-10 h-10 rounded-lg bg-cover bg-center flex-shrink-0 ring-1 ring-inset ring-black/5" style={{ backgroundImage: `url(${thumb})` }} />
        ) : (
          <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${folderTone(folder.color)}`}>
            <FolderSimple size={22} weight="fill" />
          </div>
        )}
        <div className="flex flex-col min-w-0">
          <h3 className="text-[15px] font-bold text-gray-900 truncate leading-tight">{folder.name}</h3>
          <span className="text-xs text-gray-400">{count} {t('library.items')}</span>
        </div>
      </div>
    </Link>
  )
}

export function LibraryItemCard({ item, orgslug }: { item: any; orgslug: string }) {
  const { t } = useTranslation()
  const org = useOrg() as any
  const type = item.resource_type as ResourceType
  const resource = item.resource || {}

  // Courses keep their full rich thumbnail card.
  if (type === 'courses' && resource?.course_uuid) {
    return <CourseThumbnail course={resource} orgslug={orgslug} />
  }

  const name = resource?.name || resource?.title || t('library.untitled')
  const tone = TYPE_TONE[type] || 'bg-gray-50 text-gray-400'
  const Icon = typeIcon(type, resource)

  let href: string | null = null
  let external = false
  let fileUrl: string | null = null
  if (type === 'media') {
    // file_id is no longer exposed; uploaded media is served via the authed
    // /media/{uuid}/file endpoint keyed only by media_uuid.
    if (resource.media_type !== 'EMBED') fileUrl = getMediaFileDirectory(org?.org_uuid, resource.media_uuid || item.resource_uuid)
    if (resource.media_type === 'EMBED' && resource.url) { href = safeExternalUrl(resource.url); external = !!href }
    else if (fileUrl) { href = fileUrl; external = true }
  } else {
    // Podcasts, communities, boards, playgrounds → their own resource page.
    href = resourceHref(type, resource, orgslug, 'public')
  }
  const isUpload = type === 'media' && resource.media_type !== 'EMBED'

  const body = (
    <>
      {type === 'media' ? (
        <MediaPreview resource={resource} orgUuid={org?.org_uuid} resourceUuid={item.resource_uuid} />
      ) : (
        <div className={`relative aspect-video flex items-center justify-center ${tone}`}>
          {/* eslint-disable-next-line react-hooks/static-components */}
          <Icon size={46} weight="fill" />
        </div>
      )}
      <div className="p-3 flex flex-col space-y-1.5">
        <h3 className="text-base font-bold text-gray-900 leading-tight line-clamp-1">{name}</h3>
        <div className="pt-1.5 flex items-center justify-between border-t border-gray-100">
          <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{t(`library.tabs.${type}`)}</span>
          {href && (
            <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 inline-flex items-center gap-1">
              {isUpload ? t('media.download') : t('library.open_resource')}
              {external && <ArrowSquareOut size={11} />}
            </span>
          )}
        </div>
      </div>
    </>
  )

  const BIG = 'group relative flex flex-col bg-white rounded-xl nice-shadow overflow-hidden w-full transition-all hover:bg-gray-50/40'
  if (href && external) return <a href={href} target="_blank" rel="noopener noreferrer" className={BIG}>{body}</a>
  if (href) return <Link href={href} className={BIG}>{body}</Link>
  return <div className={BIG}>{body}</div>
}
