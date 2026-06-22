'use client'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import AuthenticatedClientElement from '@components/Security/AuthenticatedClientElement'
import ConfirmationModal from '@components/Objects/StyledElements/ConfirmationModal/ConfirmationModal'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import EditFolderModal from '@components/Dashboard/Library/EditFolderModal'
import ManageAccessPopover from '@components/Dashboard/Library/ManageAccessPopover'
import { getUriWithOrg } from '@services/config/config'
import { deleteFolder, removeFolderPrefix } from '@services/folders/folders'
import { getFolderThumbnailMediaDirectory } from '@services/media/media'
import { folderTone } from '@components/Dashboard/Library/LibraryToolbar'
import { shareFolderLink } from '@components/Dashboard/Library/shareFolder'
import { FolderSimple, DotsThreeVertical, ArrowSquareOut, PencilSimple, Trash, Lock, LinkSimple } from '@phosphor-icons/react'
import Link from 'next/link'
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
  folder: any
  orgslug: string
  org_id?: string | number
  isDashboard?: boolean
  onChanged?: () => void
}

function FolderThumbnail({ folder, orgslug, org_id, isDashboard = false, onChanged }: PropsType) {
  const { t } = useTranslation()
  const org = useOrg() as any
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token

  const [isMenuOpen, setIsMenuOpen] = React.useState(false)
  const [editOpen, setEditOpen] = React.useState(false)
  const [accessOpen, setAccessOpen] = React.useState(false)

  const cleanUuid = removeFolderPrefix(folder.folder_uuid)
  const itemCount =
    folder.total_items ?? ((folder.items?.length || 0) + (folder.subfolders?.length || 0))
  const thumb = folder.thumbnail_image
    ? getFolderThumbnailMediaDirectory(org?.org_uuid, folder.folder_uuid, folder.thumbnail_image)
    : null

  const folderLink = isDashboard
    ? getUriWithOrg(orgslug, `/dash/library/folder/${cleanUuid}`)
    : getUriWithOrg(orgslug, `/library/folder/${cleanUuid}`)

  const handleDelete = async () => {
    const toastId = toast.loading(t('library.deleting_folder'))
    try {
      await deleteFolder(folder.folder_uuid, access_token)
      toast.success(t('library.folder_deleted_success'))
      onChanged?.()
    } catch (_error) {
      toast.error(t('library.folder_deleted_error'))
    } finally {
      toast.dismiss(toastId)
    }
  }

  return (
    <div className="group relative bg-white nice-shadow rounded-xl p-3 hover:bg-gray-50/50 transition-colors">
      {isDashboard && (
        <AuthenticatedClientElement action="update" ressourceType={'folders' as any} checkMethod="roles" orgId={org_id ?? org?.id}>
          <div className={`absolute top-2 right-2 z-20 transition-opacity ${isMenuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
            <DropdownMenu open={isMenuOpen} onOpenChange={setIsMenuOpen}>
              <DropdownMenuTrigger asChild>
                <button aria-label="Folder actions" className="p-1 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors">
                  <DotsThreeVertical size={18} weight="bold" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem asChild>
                  <Link prefetch={false} href={folderLink} className="flex items-center cursor-pointer">
                    <ArrowSquareOut className="mr-2 h-4 w-4" /> {t('library.open')}
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <button
                    onClick={() => shareFolderLink(orgslug, folder.folder_uuid, folder.name, t('library.link_copied'), t('library.link_copy_error'))}
                    className="w-full text-left flex items-center px-2 py-1.5 text-sm text-gray-700 hover:bg-gray-50 rounded-md transition-colors"
                  >
                    <LinkSimple className="mr-2 h-4 w-4" /> {t('library.copy_link')}
                  </button>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <button onClick={() => setEditOpen(true)} className="w-full text-left flex items-center px-2 py-1.5 text-sm text-gray-700 hover:bg-gray-50 rounded-md transition-colors">
                    <PencilSimple className="mr-2 h-4 w-4" /> {t('library.edit')}
                  </button>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <button onClick={() => setAccessOpen(true)} className="w-full text-left flex items-center px-2 py-1.5 text-sm text-gray-700 hover:bg-gray-50 rounded-md transition-colors">
                    <Lock className="mr-2 h-4 w-4" /> {t('library.manage_access')}
                  </button>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <ConfirmationModal
                    confirmationButtonText={t('library.delete_folder')}
                    confirmationMessage={t('library.delete_folder_confirm')}
                    dialogTitle={t('library.delete_folder_title', { name: folder.name })}
                    dialogTrigger={
                      <button className="w-full text-left flex items-center px-2 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded-md transition-colors">
                        <Trash className="mr-2 h-4 w-4" /> {t('library.delete_folder')}
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

      <Link prefetch={false} href={folderLink} className="flex items-center gap-3 pr-6">
        {thumb ? (
          <div
            className="w-10 h-10 rounded-lg bg-cover bg-center flex-shrink-0 ring-1 ring-inset ring-black/5"
            style={{ backgroundImage: `url(${thumb})` }}
          />
        ) : (
          <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${folderTone(folder.color)}`}>
            <FolderSimple size={22} weight="fill" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] font-bold text-gray-900 leading-tight truncate">{folder.name}</h3>
          <span className="text-xs text-gray-400">
            {itemCount} {t('library.items')}
          </span>
        </div>
      </Link>

      <Modal
        isDialogOpen={editOpen}
        onOpenChange={setEditOpen}
        minHeight="no-min"
        minWidth="md"
        dialogTitle={t('library.edit_folder')}
        dialogContent={<EditFolderModal folder={folder} orgslug={orgslug} closeModal={() => setEditOpen(false)} onChanged={onChanged} />}
      />
      <Modal
        isDialogOpen={accessOpen}
        onOpenChange={setAccessOpen}
        minHeight="no-min"
        minWidth="lg"
        dialogTitle={t('library.manage_access')}
        dialogContent={<ManageAccessPopover resource_uuid={folder.folder_uuid} resourceType="folders" orgslug={orgslug} />}
      />
    </div>
  )
}

export default FolderThumbnail
