'use client'

import React from 'react'
import { ArrowSquareOut, DownloadSimple, LinkSimple } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import MediaViewer from '@components/Objects/Media/MediaViewer'
import { shareMediaLink } from '@components/Dashboard/Library/shareFolder'
import { safeExternalUrl } from '@components/Dashboard/Library/resourceLink'
import { getMediaFileDirectory } from '@services/media/media-resource'
import { formatFileSize, mediaKind, type MediaLike } from '@/lib/media/mediaKind'

/*
 Full-screen preview for a Library media asset: the viewer plus the actions that
 used to be the only thing a click could do (download / open elsewhere). Shared
 by the dashboard and public library cards and by the Library editor block.
*/

type Props = {
  resource: MediaLike & { name?: string; file_size?: number | null; media_uuid?: string }
  /** Falls back to the folder item's resource_uuid when the row lacks media_uuid. */
  mediaUuid?: string
  isOpen: boolean
  onOpenChange: (_open: boolean) => void
}

export default function MediaLightbox({ resource, mediaUuid, isOpen, onOpenChange }: Props) {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token

  const uuid = resource?.media_uuid || mediaUuid
  const kind = mediaKind(resource)
  const isUpload = kind !== 'embed'
  const name = resource?.name || t('library.untitled')
  const size = formatFileSize(resource?.file_size)
  const externalUrl = isUpload
    ? uuid
      ? getMediaFileDirectory(undefined, uuid)
      : null
    : safeExternalUrl(resource?.url)
  const downloadUrl =
    isUpload && uuid
      ? getMediaFileDirectory(undefined, uuid, undefined, { download: true })
      : null

  const subtitle = [
    (resource?.file_format || '').replace(/^\./, '').toUpperCase(),
    size,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <Modal
      isDialogOpen={isOpen}
      onOpenChange={onOpenChange}
      minWidth="lg"
      minHeight="no-min"
      dialogTitle={
        <span className="flex flex-col">
          <span className="truncate">{name}</span>
          {subtitle && (
            <span className="text-[11px] font-medium uppercase tracking-wider text-gray-400">
              {subtitle}
            </span>
          )}
        </span>
      }
      dialogContent={
        <div className="space-y-4">
          <MediaViewer resource={resource} mediaUuid={uuid} />

          <div className="flex flex-wrap items-center gap-2">
            {downloadUrl && (
              <a
                href={downloadUrl}
                className="inline-flex items-center gap-1.5 rounded-lg bg-black px-3 py-2 text-xs font-semibold text-white nice-shadow hover:bg-neutral-800 transition-colors"
              >
                <DownloadSimple size={14} /> {t('media.download')}
              </a>
            )}
            {isUpload && uuid && access_token && (
              <button
                type="button"
                onClick={() =>
                  shareMediaLink(
                    uuid,
                    access_token,
                    t('library.link_copied'),
                    t('library.link_copy_error')
                  )
                }
                className="inline-flex items-center gap-1.5 rounded-lg bg-gray-100 px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-200 transition-colors"
              >
                <LinkSimple size={14} /> {t('library.copy_link')}
              </button>
            )}
            {externalUrl && (
              <a
                href={externalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg bg-gray-100 px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-200 transition-colors"
              >
                <ArrowSquareOut size={14} /> {t('library.open')}
              </a>
            )}
          </div>
        </div>
      }
    />
  )
}
