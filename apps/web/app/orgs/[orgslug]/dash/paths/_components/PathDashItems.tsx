'use client'
import React from 'react'
import Link from 'next/link'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { Medal, CheckCircle, ArrowSquareOut, EyeSlash, PencilSimpleLine, DotsThree, SlidersHorizontal, Trash, Users } from '@phosphor-icons/react'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import AuthenticatedClientElement from '@components/Security/AuthenticatedClientElement'
import ConfirmationModal from '@components/Objects/StyledElements/ConfirmationModal/ConfirmationModal'
import ThumbnailImage from '@components/Objects/Thumbnails/ThumbnailImage'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@components/ui/dropdown-menu'
import { BTN_SECONDARY_SM, Chip, formatRelative } from '@components/Dashboard/Shared/DashKit/DashKit'
import { getUriWithOrg } from '@services/config/config'
import { getPathThumbnailMediaDirectory } from '@services/media/media'
import { deletePath, Path, removePathPrefix } from '@services/paths/paths'
import { getErrorMessage } from '@services/utils/ts/errorMessage'
import { queryKeys } from '@/lib/query/keys'
import {
  PathLevelChip,
  PathRuleChips,
  PathTrack,
  TRACK_STRIP,
  pathShape,
  usePathCourses,
  useSeen,
} from '@components/Objects/Paths/PathTrack'

// Desktop table layout for the list view, same subgrid trick as assignments:
// the card is the grid, header + rows span it so columns line up.
export const PATH_TABLE_GRID =
  'xl:grid xl:grid-cols-[minmax(0,2.2fr)_minmax(0,1.9fr)_minmax(0,0.7fr)_minmax(0,0.8fr)_minmax(0,0.8fr)_auto] xl:gap-x-5'
export const PATH_ROW_GRID = 'xl:col-span-full xl:grid xl:grid-cols-subgrid xl:items-center xl:gap-x-5'

function pathLinks(orgslug: string, path: Path) {
  const short = removePathPrefix(path.path_uuid)
  return {
    general: getUriWithOrg(orgslug, `/dash/paths/path/${short}/general`),
    courses: getUriWithOrg(orgslug, `/dash/paths/path/${short}/courses`),
    view: getUriWithOrg(orgslug, `/path/${short}`),
  }
}

function useThumbnail(path: Path) {
  const org = useOrg() as any
  return path.thumbnail_image
    ? getPathThumbnailMediaDirectory(org?.org_uuid, path.path_uuid, path.thumbnail_image)
    : null
}

export function PathStatusChip({ published }: { published: boolean }) {
  const { t } = useTranslation()
  return published ? (
    <Chip tone="emerald" icon={<CheckCircle size={12} />}>
      {t('paths.published')}
    </Chip>
  ) : (
    <Chip tone="neutral" icon={<EyeSlash size={12} />}>
      {t('paths.draft')}
    </Chip>
  )
}

// Edit / view / delete. Delete opens the confirmation through a window event
// so the dropdown can close first instead of unmounting the dialog with it.
function PathActionsMenu({ path, orgslug, overlay }: { path: Path; orgslug: string; overlay?: boolean }) {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const queryClient = useQueryClient()
  const links = pathLinks(orgslug, path)
  const deleteEvent = `lh-path-delete:${path.path_uuid}`

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

  return (
    <AuthenticatedClientElement action="update" ressourceType="courses" checkMethod="roles" orgId={path.org_id}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={t('paths.actions')}
            className={
              overlay
                ? 'h-8 w-8 inline-flex items-center justify-center rounded-lg bg-white/90 backdrop-blur-sm text-neutral-700 shadow-sm hover:bg-white transition-colors'
                : 'h-8 w-8 inline-flex items-center justify-center rounded-lg text-neutral-400 hover:text-neutral-800 hover:bg-neutral-100 transition-colors'
            }
          >
            <DotsThree size={16} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52 rounded-xl">
          <DropdownMenuItem asChild>
            <Link prefetch href={links.courses} className="flex items-center gap-2 cursor-pointer">
              <PencilSimpleLine size={15} /> {t('paths.edit_courses')}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link prefetch href={links.general} className="flex items-center gap-2 cursor-pointer">
              <SlidersHorizontal size={15} /> {t('common.settings')}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href={links.view} target="_blank" className="flex items-center gap-2 cursor-pointer">
              <ArrowSquareOut size={15} /> {t('paths.view_path')}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => window.dispatchEvent(new Event(deleteEvent))}
            className="flex items-center gap-2 cursor-pointer text-rose-600 focus:text-rose-700 focus:bg-rose-50"
          >
            <Trash size={15} /> {t('paths.delete_path')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmationModal
        confirmationButtonText={t('paths.delete_path')}
        confirmationMessage={t('paths.delete_path_confirm')}
        dialogTitle={t('paths.delete_path_title', { name: path.name })}
        functionToExecute={handleDelete}
        openOnEvent={deleteEvent}
        status="warning"
      />
    </AuthenticatedClientElement>
  )
}

/** Course and requirement count under a track: "4 courses · 2 required". */
function JourneyCaption({ path, total, required, electives }: { path: Path; total: number; required: number; electives: number }) {
  const { t } = useTranslation()
  return (
    <span className="text-[11px] text-neutral-500 tabular-nums truncate">
      {t('paths.course_count', { count: total })}
      {electives > 0 && required > 0 && <> · {t('paths.dashboard.journey.required_count', { count: required })}</>}
      {path.certificate_enabled && (
        <Medal size={11} weight="fill" className="inline ms-1 -mt-0.5 text-amber-500" aria-label={t('paths.certificate_included')} />
      )}
    </span>
  )
}

function MiniStat({ value, label }: { value: React.ReactNode; label: string }) {
  return (
    <div className="min-w-0 px-3 py-2 [&:not(:first-child)]:border-s border-neutral-200/70">
      <p className="text-sm font-bold text-neutral-900 tabular-nums leading-tight">{value}</p>
      <p className="text-[11px] text-neutral-500 truncate">{label}</p>
    </div>
  )
}

export function PathGridCard({ path, orgslug }: { path: Path; orgslug: string }) {
  const { t, i18n } = useTranslation()
  const [ref, seen] = useSeen<HTMLDivElement>()
  const courses = usePathCourses(path, seen)
  const shape = pathShape(path, courses)
  const thumbnail = useThumbnail(path)
  const links = pathLinks(orgslug, path)
  const updated = formatRelative(path.update_date, i18n.language)

  return (
    <div
      ref={ref}
      data-kbd-item=""
      className="group relative flex flex-col bg-white rounded-2xl nice-shadow overflow-hidden transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg"
    >
      <Link prefetch href={links.general} className="block relative aspect-[2/1] overflow-hidden bg-neutral-100">
        <ThumbnailImage
          src={thumbnail}
          className="w-full h-full transition-transform duration-500 group-hover:scale-[1.03]"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-transparent" />
        <div className="absolute top-2.5 start-2.5">
          <PathStatusChip published={path.published} />
        </div>
        <div className="absolute bottom-2.5 inset-x-2.5 flex items-end justify-between gap-2">
          <PathLevelChip path={path} />
          {path.certificate_enabled && (
            <span
              title={t('paths.certificate_included')}
              className="inline-flex items-center gap-1 rounded-full bg-amber-400 text-amber-950 px-2 py-1 text-[11px] font-bold shadow-sm"
            >
              <Medal size={12} weight="fill" />
              {t('paths.cards.certificate')}
            </span>
          )}
        </div>
      </Link>
      <div className="absolute top-2.5 end-2.5 z-10">
        <PathActionsMenu path={path} orgslug={orgslug} overlay />
      </div>

      <Link
        prefetch
        href={links.courses}
        title={t('paths.edit_courses')}
        className={`block px-4 py-3.5 border-b border-neutral-100 ${TRACK_STRIP}`}
      >
        <PathTrack path={path} courses={courses} showProgress={false} />
      </Link>

      <div className="flex flex-col gap-1.5 p-4 flex-1">
        <Link
          prefetch
          href={links.general}
          className="text-[15px] font-semibold text-neutral-900 leading-snug line-clamp-1 hover:underline underline-offset-2"
          dir="auto"
        >
          {path.name}
        </Link>
        <p className="text-xs text-neutral-500 line-clamp-2 min-h-[2rem]" dir="auto">
          {path.description}
        </p>
        <PathRuleChips path={path} electives={shape.electives} electivesNeeded={shape.electivesNeeded} />
        <div className="mt-auto pt-2">
          <div className="grid grid-cols-3 rounded-xl bg-neutral-50 ring-1 ring-inset ring-neutral-200/60">
            <MiniStat value={shape.total} label={t('paths.cards.stat_courses')} />
            <MiniStat value={shape.needed} label={t('paths.cards.stat_to_finish')} />
            <MiniStat value={path.enrollment_count} label={t('paths.dashboard.columns.learners')} />
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-t border-neutral-100 text-xs text-neutral-500">
        <span className="tabular-nums truncate">{updated ? t('paths.dashboard.updated', { time: updated }) : null}</span>
        <Link prefetch href={links.courses} className={`${BTN_SECONDARY_SM} shrink-0`}>
          <PencilSimpleLine size={13} />
          {t('paths.cards.edit_journey')}
        </Link>
      </div>
    </div>
  )
}

export function PathGridCardSkeleton() {
  return (
    <div className="bg-white rounded-2xl nice-shadow overflow-hidden animate-pulse">
      <div className="aspect-[2/1] bg-neutral-100" />
      <div className="flex items-center gap-2 px-4 py-4 border-b border-neutral-100">
        {[0, 1, 2, 3, 4].map((i) => (
          <React.Fragment key={i}>
            <span className="w-7 h-7 rounded-full bg-neutral-100 shrink-0" />
            {i < 4 && <span className="flex-1 h-0.5 bg-neutral-100" />}
          </React.Fragment>
        ))}
      </div>
      <div className="p-4 space-y-2.5">
        <div className="h-4 w-2/3 bg-neutral-100 rounded" />
        <div className="h-3 w-full bg-neutral-100 rounded" />
        <div className="h-12 w-full bg-neutral-100 rounded-xl" />
      </div>
    </div>
  )
}

export function PathListRow({ path, orgslug }: { path: Path; orgslug: string }) {
  const { t, i18n } = useTranslation()
  const [ref, seen] = useSeen<HTMLLIElement>()
  const courses = usePathCourses(path, seen)
  const shape = pathShape(path, courses)
  const thumbnail = useThumbnail(path)
  const links = pathLinks(orgslug, path)
  const updated = formatRelative(path.update_date, i18n.language)

  const journey = (
    <Link prefetch href={links.courses} title={t('paths.edit_courses')} className="flex flex-col gap-1 min-w-0">
      <PathTrack path={path} courses={courses} size="sm" maxNodes={7} showProgress={false} />
      <JourneyCaption path={path} total={shape.total} required={shape.required} electives={shape.electives} />
    </Link>
  )

  return (
    <li ref={ref} data-kbd-item="" className={`group relative px-4 sm:px-5 py-4 hover:bg-neutral-50/70 transition-colors ${PATH_ROW_GRID}`}>
      {/* Path */}
      <div className="flex items-start gap-3 min-w-0">
        <Link prefetch href={links.general} className="shrink-0">
          <ThumbnailImage src={thumbnail} className="w-16 aspect-video rounded-lg ring-1 ring-black/5" />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <Link
              prefetch
              href={links.general}
              className="text-sm font-semibold text-neutral-900 leading-snug hover:underline underline-offset-2 line-clamp-1 break-words"
              dir="auto"
            >
              {path.name}
            </Link>
            <span className="xl:hidden shrink-0">
              <PathStatusChip published={path.published} />
            </span>
          </div>
          <p className="mt-0.5 text-xs text-neutral-500 line-clamp-1 break-words" dir="auto">
            {path.description || (path.level ? t(`paths.levels.${path.level}`) : t('paths.levels.all'))}
          </p>
          {/* Below xl the columns collapse: the track sits under the name */}
          <div className="xl:hidden mt-2.5 max-w-sm">{journey}</div>
          <div className="xl:hidden mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-500">
            <span className="inline-flex items-center gap-1">
              <Users size={12} />
              {t('paths.learner_count', { count: path.enrollment_count })}
            </span>
            {updated && <span className="tabular-nums">{updated}</span>}
          </div>
        </div>
      </div>

      {/* Journey */}
      <div className="hidden xl:block min-w-0 pe-2">{journey}</div>

      {/* Learners */}
      <div className="hidden xl:flex items-center gap-1.5 text-sm text-neutral-700 tabular-nums">
        <Users size={14} className="text-neutral-400" />
        {path.enrollment_count}
      </div>

      {/* Updated */}
      <div className="hidden xl:block text-sm text-neutral-500 tabular-nums truncate">{updated ?? '—'}</div>

      {/* Status */}
      <div className="hidden xl:block">
        <PathStatusChip published={path.published} />
      </div>

      {/* Actions */}
      <div className="mt-3 xl:mt-0 flex items-center gap-1 xl:justify-end">
        <Link prefetch href={links.courses} className={`${BTN_SECONDARY_SM} flex-1 xl:flex-none`}>
          <PencilSimpleLine size={14} />
          {t('paths.cards.edit_journey')}
        </Link>
        <PathActionsMenu path={path} orgslug={orgslug} />
      </div>
    </li>
  )
}

export function PathListRowSkeleton() {
  return (
    <div className="flex items-center gap-3 px-5 py-4">
      <div className="w-16 aspect-video rounded-lg bg-neutral-100 shrink-0" />
      <div className="flex-1 space-y-2">
        <div className="h-3.5 bg-neutral-100 rounded w-1/3" />
        <div className="h-3 bg-neutral-100 rounded w-1/2" />
      </div>
      <div className="hidden sm:flex items-center gap-1 w-48">
        {[0, 1, 2, 3].map((i) => (
          <React.Fragment key={i}>
            <span className="w-5 h-5 rounded-full bg-neutral-100 shrink-0" />
            {i < 3 && <span className="flex-1 h-0.5 bg-neutral-100" />}
          </React.Fragment>
        ))}
      </div>
    </div>
  )
}
