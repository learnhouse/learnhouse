'use client'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import AuthenticatedClientElement from '@components/Security/AuthenticatedClientElement'
import ConfirmationModal from '@components/Objects/StyledElements/ConfirmationModal/ConfirmationModal'
import { getUriWithOrg } from '@services/config/config'
import { getPathThumbnailMediaDirectory } from '@services/media/media'
import { deletePath, Path, removePathPrefix } from '@services/paths/paths'
import { getErrorMessage } from '@services/utils/ts/errorMessage'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { Award, BookCopy, FilePenLine, MoreVertical, Settings2, Trash2, Users } from 'lucide-react'
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
  path: Path
  orgslug: string
  isDashboard?: boolean
}

function PathThumbnail({ path, orgslug, isDashboard = false }: PropsType) {
  const { t } = useTranslation()
  const org = useOrg() as any
  const session = useLHSession() as any
  const queryClient = useQueryClient()

  const thumbnailImage = path.thumbnail_image
    ? getPathThumbnailMediaDirectory(org?.org_uuid, path.path_uuid, path.thumbnail_image)
    : '/empty_thumbnail.png'

  const shortUuid = removePathPrefix(path.path_uuid)
  const pathLink = isDashboard
    ? getUriWithOrg(orgslug, `/dash/paths/path/${shortUuid}/general`)
    : getUriWithOrg(orgslug, `/path/${shortUuid}`)

  const handleDelete = async () => {
    const toastId = toast.loading(t('paths.toasts.deleting'))
    try {
      await deletePath(path.path_uuid, session.data?.tokens?.access_token)
      queryClient.invalidateQueries({ queryKey: queryKeys.paths.list(path.org_id) })
      toast.success(t('paths.toasts.deleted'), { id: toastId })
    } catch (error: any) {
      toast.error(getErrorMessage(error?.detail, t('paths.toasts.delete_error')), { id: toastId })
    }
  }

  const progress = path.progress
  const showProgress = !isDashboard && progress?.enrolled

  return (
    <div data-kbd-item="" className="group relative flex flex-col bg-white rounded-xl nice-shadow overflow-hidden w-full transition-all duration-300 hover:scale-[1.01]">
      {isDashboard && (
        <AdminEditOptions path={path} orgslug={orgslug} onDelete={handleDelete} />
      )}

      <Link prefetch href={pathLink} className="block relative aspect-video overflow-hidden bg-gray-50">
        <div
          className="w-full h-full bg-cover bg-center transition-transform duration-500 group-hover:scale-105"
          style={{ backgroundImage: `url(${thumbnailImage})` }}
        />
        {isDashboard && (
          <div className="absolute bottom-2 start-2">
            {path.published ? (
              <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide bg-green-100 text-green-700 rounded-full">
                {t('paths.published')}
              </span>
            ) : (
              <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide bg-yellow-100 text-yellow-700 rounded-full">
                {t('paths.draft')}
              </span>
            )}
          </div>
        )}
        {!isDashboard && progress?.completed && (
          <div className="absolute bottom-2 start-2">
            <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide bg-green-100 text-green-700 rounded-full">
              {t('paths.completed')}
            </span>
          </div>
        )}
        <div className="absolute bottom-2 end-2 flex items-center gap-1">
          {path.certificate_enabled && (
            <span
              className="flex items-center bg-black/70 text-white px-1.5 py-0.5 rounded-full"
              title={t('paths.certificate_included')}
            >
              <Award size={12} />
            </span>
          )}
          <span className="flex items-center gap-1 bg-black/70 text-white px-2 py-0.5 rounded-full text-[10px] font-medium">
            <BookCopy size={12} />
            {t('paths.course_count', { count: path.course_count })}
          </span>
        </div>
      </Link>

      <div className="p-3 flex flex-col space-y-1.5">
        <Link
          href={pathLink}
          className="text-base font-bold text-gray-900 leading-tight hover:text-black transition-colors line-clamp-1"
          dir="auto"
        >
          {path.name}
        </Link>

        {path.description && (
          <p className="text-[11px] text-gray-500 line-clamp-2 min-h-[1.5rem]" dir="auto">
            {path.description}
          </p>
        )}

        {showProgress ? (
          <div className="pt-1.5 border-t border-gray-100 space-y-1">
            <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-gray-400">
              <span>{t('paths.progress_short', { done: progress!.courses_done, total: progress!.courses_needed })}</span>
              <span className="text-gray-600">{progress!.percent}%</span>
            </div>
            <div className="h-1 w-full bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-black rounded-full" style={{ width: `${progress!.percent}%` }} />
            </div>
          </div>
        ) : (
          <div className="pt-1.5 flex items-center justify-between border-t border-gray-100">
            <span className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">
              {path.level ? t(`paths.levels.${path.level}`) : t('paths.levels.all')}
            </span>
            {isDashboard ? (
              <span className="flex items-center gap-1 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                <Users size={11} />
                {t('paths.learner_count', { count: path.enrollment_count })}
              </span>
            ) : (
              <Link
                href={pathLink}
                className="text-[10px] font-bold text-gray-400 hover:text-gray-900 transition-colors uppercase tracking-wider"
              >
                {t('paths.view_path')}
              </Link>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function AdminEditOptions({
  path,
  orgslug,
  onDelete,
}: {
  path: Path
  orgslug: string
  onDelete: () => Promise<void>
}) {
  const { t } = useTranslation()
  const [isOpen, setIsOpen] = React.useState(false)
  const shortUuid = removePathPrefix(path.path_uuid)

  return (
    <AuthenticatedClientElement action="update" ressourceType="courses" checkMethod="roles" orgId={path.org_id}>
      <div className={`absolute top-2 end-2 z-20 transition-opacity ${!isOpen ? 'opacity-0 group-hover:opacity-100' : 'opacity-100'}`}>
        <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
          <DropdownMenuTrigger asChild>
            <button aria-label={t('paths.actions')} className="p-1.5 bg-white/90 backdrop-blur-sm rounded-full hover:bg-white transition-all shadow-md">
              <MoreVertical size={18} className="text-gray-700" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem asChild>
              <Link prefetch href={getUriWithOrg(orgslug, `/dash/paths/path/${shortUuid}/courses`)} className="flex items-center cursor-pointer">
                <FilePenLine className="me-2 h-4 w-4" /> {t('paths.edit_courses')}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link prefetch href={getUriWithOrg(orgslug, `/dash/paths/path/${shortUuid}/general`)} className="flex items-center cursor-pointer">
                <Settings2 className="me-2 h-4 w-4" /> {t('common.settings')}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <ConfirmationModal
                confirmationButtonText={t('paths.delete_path')}
                confirmationMessage={t('paths.delete_path_confirm')}
                dialogTitle={t('paths.delete_path_title', { name: path.name })}
                dialogTrigger={
                  <button className="w-full text-start flex items-center px-2 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded-md transition-colors">
                    <Trash2 className="me-2 h-4 w-4" /> {t('paths.delete_path')}
                  </button>
                }
                functionToExecute={onDelete}
                status="warning"
              />
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </AuthenticatedClientElement>
  )
}

export default PathThumbnail
