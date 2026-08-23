'use client'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import ConfirmationModal from '@components/Objects/StyledElements/ConfirmationModal/ConfirmationModal'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import ManageAccessPopover from '@components/Dashboard/Library/ManageAccessPopover'
import MediaPreview from '@components/Dashboard/Library/MediaPreview'
import MediaLightbox from '@components/Objects/Media/MediaLightbox'
import { resourceHref, safeExternalUrl } from '@components/Dashboard/Library/resourceLink'
import { shareMediaLink } from '@components/Dashboard/Library/shareFolder'
import { getMediaFileDirectory } from '@services/media/media-resource'
import { mediaKind } from '@/lib/media/mediaKind'
import Link from 'next/link'
import {
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
  DotsThreeVertical,
  ArrowSquareOut,
  DownloadSimple,
  Eye,
  Lock,
  FolderMinus,
} from '@phosphor-icons/react'
import React from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@components/ui/dropdown-menu'
import { useTranslation } from 'react-i18next'

// Soft tone for the preview header (bg + icon color).
const TYPE_TONE: Record<string, string> = {
  media: 'bg-amber-50 text-amber-500',
  podcasts: 'bg-rose-50 text-rose-500',
  communities: 'bg-emerald-50 text-emerald-500',
  boards: 'bg-indigo-50 text-indigo-500',
  playgrounds: 'bg-fuchsia-50 text-fuchsia-500',
}

function mediaIcon(resource: any) {
  switch (mediaKind(resource)) {
    case 'embed': return LinkSimple
    case 'pdf': return FilePdf
    case 'video': return VideoCamera
    case 'image': return ImageIcon
    case 'audio': return MusicNote
    default: return FileIcon
  }
}

function typeIcon(type: string, resource: any) {
  switch (type) {
    case 'media': return mediaIcon(resource)
    case 'podcasts': return MicrophoneStage
    case 'communities': return ChatsCircle
    case 'boards': return SquaresFour
    case 'playgrounds': return Cube
    default: return FileIcon
  }
}

type Props = {
  item: any
  orgslug: string
  org_id: number
  onRemove: () => void
}

export default function LibraryItemCard({ item, orgslug, onRemove }: Props) {
  const { t } = useTranslation()
  const org = useOrg() as any
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const [isMenuOpen, setIsMenuOpen] = React.useState(false)
  const [accessOpen, setAccessOpen] = React.useState(false)
  const [previewOpen, setPreviewOpen] = React.useState(false)

  const type: string = item.resource_type
  const resource = item.resource || {}
  const name = resource.name || resource.title || t('library.untitled')
  const tone = TYPE_TONE[type] || 'bg-gray-50 text-gray-400'
  const Icon = typeIcon(type, resource)
  const isUploadMedia = type === 'media' && resource.media_type !== 'EMBED'

  const mediaUuid = resource.media_uuid || item.resource_uuid
  let href: string | null = null          // external (media file / embed url)
  let internalHref: string | null = null  // resource detail page (same-tab)
  let downloadUrl: string | null = null
  if (type === 'media') {
    // file_id is no longer exposed; uploaded media is served via the authed
    // /media/{uuid}/file endpoint keyed only by media_uuid.
    if (isUploadMedia) {
      href = getMediaFileDirectory(org?.org_uuid, mediaUuid)
      // The `download` attribute is ignored cross-origin, so the attachment
      // disposition has to come from the API.
      downloadUrl = getMediaFileDirectory(org?.org_uuid, mediaUuid, undefined, { download: true })
    } else if (resource.url) {
      href = safeExternalUrl(resource.url)
    }
  } else {
    // Podcasts, communities, boards, playgrounds → their dashboard page.
    internalHref = resourceHref(type, resource, orgslug, 'dashboard')
  }
  const typeLabel = t(`library.tabs.${type}`)

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
          <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{typeLabel}</span>
          {(href || internalHref) && (
            <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 inline-flex items-center gap-1">
              {type === 'media' ? t('library.preview') : t('library.open_resource')}
              {type === 'media' ? <Eye size={11} /> : <ArrowSquareOut size={11} />}
            </span>
          )}
        </div>
      </div>
    </>
  )

  return (
    <div className="group relative flex flex-col bg-white rounded-xl nice-shadow overflow-hidden w-full transition-all hover:bg-gray-50/40">
      <div className={`absolute top-2 end-2 z-20 transition-opacity ${isMenuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
        <DropdownMenu open={isMenuOpen} onOpenChange={setIsMenuOpen}>
          <DropdownMenuTrigger asChild>
            <button aria-label="Item actions" className="p-1.5 bg-white/90 backdrop-blur-sm rounded-full hover:bg-white transition-all shadow-md">
              <DotsThreeVertical size={18} weight="bold" className="text-gray-700" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            {type === 'media' && (
              <DropdownMenuItem asChild>
                <button
                  onClick={() => setPreviewOpen(true)}
                  className="w-full text-start flex items-center px-2 py-1.5 text-sm text-gray-700 hover:bg-gray-50 rounded-md transition-colors"
                >
                  <Eye className="me-2 h-4 w-4" /> {t('library.preview')}
                </button>
              </DropdownMenuItem>
            )}
            {downloadUrl && (
              <DropdownMenuItem asChild>
                <a href={downloadUrl} className="flex items-center cursor-pointer">
                  <DownloadSimple className="me-2 h-4 w-4" /> {t('media.download')}
                </a>
              </DropdownMenuItem>
            )}
            {href && (
              <DropdownMenuItem asChild>
                <a href={href} target="_blank" rel="noopener noreferrer" className="flex items-center cursor-pointer">
                  <ArrowSquareOut className="me-2 h-4 w-4" /> {t('library.open')}
                </a>
              </DropdownMenuItem>
            )}
            {isUploadMedia && (
              <DropdownMenuItem asChild>
                <button
                  onClick={() =>
                    shareMediaLink(
                      resource.media_uuid || item.resource_uuid,
                      access_token,
                      t('library.link_copied'),
                      t('library.link_copy_error'),
                    )
                  }
                  className="w-full text-start flex items-center px-2 py-1.5 text-sm text-gray-700 hover:bg-gray-50 rounded-md transition-colors"
                >
                  <LinkSimple className="me-2 h-4 w-4" /> {t('library.copy_link')}
                </button>
              </DropdownMenuItem>
            )}
            {type === 'media' && (
              <DropdownMenuItem asChild>
                <button onClick={() => setAccessOpen(true)} className="w-full text-start flex items-center px-2 py-1.5 text-sm text-gray-700 hover:bg-gray-50 rounded-md transition-colors">
                  <Lock className="me-2 h-4 w-4" /> {t('library.manage_access')}
                </button>
              </DropdownMenuItem>
            )}
            <DropdownMenuItem asChild>
              <ConfirmationModal
                confirmationButtonText={t('library.remove_from_folder')}
                confirmationMessage={t('library.remove_from_folder_confirm')}
                dialogTitle={t('library.remove_from_folder')}
                dialogTrigger={
                  <button className="w-full text-start flex items-center px-2 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded-md transition-colors">
                    <FolderMinus className="me-2 h-4 w-4" /> {t('library.remove_from_folder')}
                  </button>
                }
                functionToExecute={onRemove}
                status="warning"
              />
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {type === 'media' ? (
        // Media opens in-app rather than dumping the raw file in a new tab.
        <button type="button" onClick={() => setPreviewOpen(true)} className="block w-full text-start">
          {body}
        </button>
      ) : internalHref ? (
        <Link href={internalHref} className="block">
          {body}
        </Link>
      ) : (
        <div>{body}</div>
      )}

      {type === 'media' && (
        <MediaLightbox
          resource={resource}
          mediaUuid={mediaUuid}
          isOpen={previewOpen}
          onOpenChange={setPreviewOpen}
        />
      )}

      {type === 'media' && (
        <Modal
          isDialogOpen={accessOpen}
          onOpenChange={setAccessOpen}
          minHeight="no-min"
          minWidth="md"
          dialogTitle={t('library.manage_access')}
          dialogContent={<ManageAccessPopover resource_uuid={resource.media_uuid || item.resource_uuid} resourceType="media" orgslug={orgslug} />}
        />
      )}
    </div>
  )
}
