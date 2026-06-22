'use client'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import AuthenticatedClientElement from '@components/Security/AuthenticatedClientElement'
import ConfirmationModal from '@components/Objects/StyledElements/ConfirmationModal/ConfirmationModal'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import ManageAccessPopover from '@components/Dashboard/Library/ManageAccessPopover'
import { deleteMedia, getMediaFileDirectory } from '@services/media/media-resource'
import { FileText, Video, Image as ImageIcon, Music, Link as LinkIcon, MoreVertical, Trash2, Lock, Download, ExternalLink } from 'lucide-react'
import React from 'react'
import toast from 'react-hot-toast'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@components/ui/dropdown-menu'
import { useTranslation } from 'react-i18next'

type PropsType = {
  media: any
  orgslug: string
  org_id?: string | number
  isDashboard?: boolean
  onChanged?: () => void
}

function iconForMedia(media: any) {
  if (media.media_type === 'EMBED') return LinkIcon
  const fmt = (media.file_format || media.file_mime || '').toLowerCase()
  if (fmt.includes('video') || /mp4|mov|webm|avi|mkv/.test(fmt)) return Video
  if (fmt.includes('image') || /png|jpg|jpeg|gif|webp|svg/.test(fmt)) return ImageIcon
  if (fmt.includes('audio') || /mp3|wav|ogg|m4a|flac/.test(fmt)) return Music
  return FileText
}

function MediaThumbnail({ media, orgslug, org_id, isDashboard = false, onChanged }: PropsType) {
  const { t } = useTranslation()
  const org = useOrg() as any
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token

  const [isMenuOpen, setIsMenuOpen] = React.useState(false)
  const [accessOpen, setAccessOpen] = React.useState(false)

  const Icon = iconForMedia(media)

  const fileLink =
    media.media_type === 'EMBED'
      ? media.url
      : getMediaFileDirectory(org?.org_uuid, media.media_uuid, media.file_id)

  const typeLabel = media.media_type === 'EMBED' ? t('media.embed') : (media.file_format || t('media.file'))

  const handleDelete = async () => {
    const toastId = toast.loading(t('media.deleting_media'))
    try {
      await deleteMedia(media.media_uuid, access_token)
      toast.success(t('media.media_deleted_success'))
      onChanged?.()
    } catch (_error) {
      toast.error(t('media.media_deleted_error'))
    } finally {
      toast.dismiss(toastId)
    }
  }

  return (
    <div className="group relative flex flex-col bg-white rounded-xl nice-shadow overflow-hidden w-full transition-all duration-300 hover:scale-[1.01]">
      {isDashboard && (
        <AuthenticatedClientElement
          action="update"
          ressourceType={'media' as any}
          checkMethod="roles"
          orgId={org_id ?? org?.id}
        >
          <div className={`absolute top-2 right-2 z-20 transition-opacity ${isMenuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
            <DropdownMenu open={isMenuOpen} onOpenChange={setIsMenuOpen}>
              <DropdownMenuTrigger asChild>
                <button aria-label="Media actions" className="p-1.5 bg-white/90 backdrop-blur-sm rounded-full hover:bg-white transition-all shadow-md">
                  <MoreVertical size={18} className="text-gray-700" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem asChild>
                  <button
                    onClick={() => setAccessOpen(true)}
                    className="w-full text-left flex items-center px-2 py-1.5 text-sm text-gray-700 hover:bg-gray-50 rounded-md transition-colors"
                  >
                    <Lock className="mr-2 h-4 w-4" /> {t('library.manage_access')}
                  </button>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <ConfirmationModal
                    confirmationButtonText={t('media.delete_media')}
                    confirmationMessage={t('media.delete_media_confirm')}
                    dialogTitle={t('media.delete_media_title', { name: media.name })}
                    dialogTrigger={
                      <button className="w-full text-left flex items-center px-2 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded-md transition-colors">
                        <Trash2 className="mr-2 h-4 w-4" /> {t('media.delete_media')}
                      </button>
                    }
                    functionToExecute={handleDelete}
                    status="warning"
                  />
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </AuthenticatedClientElement>
      )}

      <a
        href={fileLink || '#'}
        target="_blank"
        rel="noopener noreferrer"
        className="block p-5"
      >
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-gray-100 text-gray-500 flex items-center justify-center flex-shrink-0">
            <Icon className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-bold text-gray-900 leading-tight truncate">{media.name}</h3>
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{typeLabel}</span>
          </div>
          {media.media_type === 'EMBED' ? (
            <ExternalLink className="w-4 h-4 text-gray-300 flex-shrink-0" />
          ) : (
            <Download className="w-4 h-4 text-gray-300 flex-shrink-0" />
          )}
        </div>
        {media.description && (
          <p className="mt-3 text-[11px] text-gray-500 line-clamp-2 min-h-[1.5rem]">{media.description}</p>
        )}
      </a>

      <Modal
        isDialogOpen={accessOpen}
        onOpenChange={setAccessOpen}
        minHeight="no-min"
        minWidth="md"
        dialogTitle={t('library.manage_access')}
        dialogContent={
          <ManageAccessPopover
            resource_uuid={media.media_uuid}
            resourceType="media"
            orgslug={orgslug}
          />
        }
      />
    </div>
  )
}

export default MediaThumbnail
