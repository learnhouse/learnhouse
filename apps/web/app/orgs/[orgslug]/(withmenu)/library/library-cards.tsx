'use client'

import React from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { useOrg } from '@components/Contexts/OrgContext'
import { getUriWithOrg } from '@services/config/config'
import CourseThumbnail from '@components/Objects/Thumbnails/CourseThumbnail'
import { Chip } from '@components/Dashboard/Shared/DashKit/DashKit'
import { getFolderThumbnailMediaDirectory } from '@services/media/media'
import { folderTone } from '@components/Dashboard/Library/LibraryToolbar'
import { shareFolderLink } from '@components/Dashboard/Library/shareFolder'
import { resourceHref } from '@components/Dashboard/Library/resourceLink'
import MediaPreview from '@components/Dashboard/Library/MediaPreview'
import MediaLightbox from '@components/Objects/Media/MediaLightbox'
import { mediaKind } from '@/lib/media/mediaKind'
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics'
import { resourcePath } from '@/lib/seo/paths'
import {
  FolderSimple,
  GraduationCap,
  MicrophoneStage,
  SquaresFour,
  Lightning,
  LinkSimple,
  FilePdf,
  VideoCamera,
  Image as ImageIcon,
  MusicNote,
  File as FileIcon,
  ArrowSquareOut,
  Eye,
  type IconProps,
  Garage,
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
  switch (mediaKind(resource)) {
    case 'embed': return LinkSimple
    case 'pdf': return FilePdf
    case 'video': return VideoCamera
    case 'image': return ImageIcon
    case 'audio': return MusicNote
    default: return FileIcon
  }
}

function typeIcon(type: string, resource: any): React.ComponentType<IconProps> {
  switch (type) {
    case 'courses': return GraduationCap
    case 'media': return mediaIcon(resource)
    case 'podcasts': return MicrophoneStage
    case 'communities': return Garage
    case 'boards': return SquaresFour
    case 'playgrounds': return Lightning
    default: return FileIcon
  }
}

const CARD = 'group relative bg-white nice-shadow rounded-2xl p-3 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg'

export function FolderCard({ folder, orgslug }: { folder: any; orgslug: string }) {
  const { t } = useTranslation()
  const org = useOrg() as any
  const count = folder.total_items ?? ((folder.items?.length || 0) + (folder.subfolders?.length || 0))
  const thumb = folder.thumbnail_image
    ? getFolderThumbnailMediaDirectory(org?.org_uuid, folder.folder_uuid, folder.thumbnail_image)
    : null
  return (
    <Link data-kbd-item="" href={getUriWithOrg(orgslug, resourcePath('folder', folder))} className={CARD}>
      <button
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          shareFolderLink(orgslug, folder.folder_uuid, folder.name, t('library.link_copied'), t('library.link_copy_error'))
        }}
        aria-label={t('library.share')}
        title={t('library.share')}
        className="absolute top-2 end-2 z-10 p-1 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <LinkSimple size={16} />
      </button>
      <div className="flex items-center gap-3 pe-6">
        {thumb ? (
          <div className="w-10 h-10 rounded-lg bg-cover bg-center flex-shrink-0 ring-1 ring-inset ring-black/5" style={{ backgroundImage: `url(${thumb})` }} />
        ) : (
          <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${folderTone(folder.color)}`}>
            <FolderSimple size={22} weight="fill" />
          </div>
        )}
        <div className="flex flex-col min-w-0">
          <h3 className="text-[15px] font-semibold text-neutral-900 truncate leading-tight">{folder.name}</h3>
          <span className="text-xs text-neutral-400">{count} {t('library.items')}</span>
        </div>
      </div>
    </Link>
  )
}

export function LibraryItemCard({ item, orgslug }: { item: any; orgslug: string }) {
  const { t } = useTranslation()
  const org = useOrg() as any
  const [previewOpen, setPreviewOpen] = React.useState(false)
  const { track } = useLHAnalytics('learner')
  const type = item.resource_type as ResourceType
  const resource = item.resource || {}
  const trackOpened = () =>
    track(AnalyticsEvent.LibraryResourceOpened, { resource_uuid: item.resource_uuid, resource_type: type })

  // Courses keep their full rich thumbnail card. `contents` keeps the wrapper
  // out of the grid layout; it only listens for a click on a link that opens
  // the course (not the card's menu, nor its link into the dashboard).
  if (type === 'courses' && resource?.course_uuid) {
    const onCardClick = (e: React.MouseEvent) => {
      const link = (e.target as HTMLElement).closest('a')
      if (link && !link.getAttribute('href')?.includes('/dash/')) trackOpened()
    }
    return (
      <div className="contents" onClickCapture={onCardClick}>
        <CourseThumbnail course={resource} orgslug={orgslug} />
      </div>
    )
  }

  const name = resource?.name || resource?.title || t('library.untitled')
  const tone = TYPE_TONE[type] || 'bg-gray-50 text-gray-400'
  const Icon = typeIcon(type, resource)

  const mediaUuid = resource.media_uuid || item.resource_uuid
  // Media previews in-app (see below); everything else links to its own page.
  const href = type === 'media' ? null : resourceHref(type, resource, orgslug, 'public')

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
      <div className="flex flex-col flex-1 p-4 gap-1">
        <h3 className="text-[15px] font-semibold text-neutral-900 leading-snug line-clamp-1" dir="auto">{name}</h3>
        <p className="text-xs text-neutral-500 line-clamp-2 min-h-[2rem]" dir="auto">
          {resource?.description || '\u00a0'}
        </p>
        <div className="mt-auto pt-3 flex items-center justify-between gap-2">
          {/* eslint-disable-next-line react-hooks/static-components */}
          <Chip icon={<Icon size={12} weight="fill" />}>{t(`library.tabs.${type}`)}</Chip>
          {(href || type === 'media') && (
            <span className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-xs font-semibold text-neutral-500 group-hover:text-neutral-900 group-hover:bg-neutral-100 transition-colors">
              {type === 'media' ? t('library.preview') : t('library.open_resource')}
              {type === 'media' ? <Eye size={12} /> : <ArrowSquareOut size={12} />}
            </span>
          )}
        </div>
      </div>
    </>
  )

  // Same tile look as the shared course card, so the library reads as one grid.
  const BIG = 'group relative flex flex-col bg-white rounded-2xl nice-shadow overflow-hidden w-full transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg'
  // Media opens in-app rather than sending the learner off to the raw file.
  if (type === 'media') {
    return (
      <>
        <button
          type="button"
          onClick={() => {
            trackOpened()
            setPreviewOpen(true)
          }}
          className={`${BIG} text-start`}
        >
          {body}
        </button>
        <MediaLightbox
          resource={resource}
          mediaUuid={mediaUuid}
          isOpen={previewOpen}
          onOpenChange={setPreviewOpen}
        />
      </>
    )
  }
  if (href) return <Link data-kbd-item="" href={href} onClick={trackOpened} className={BIG}>{body}</Link>
  return <div className={BIG}>{body}</div>
}
