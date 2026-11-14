'use client'
import React from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import {
  ArrowSquareOut,
  BookOpen,
  ChatCenteredText,
  Garage,
  DotsThree,
  Globe,
  Lock,
  PencilSimple,
  SlidersHorizontal,
  Trash,
} from '@phosphor-icons/react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@components/ui/dropdown-menu'
import AuthenticatedClientElement from '@components/Security/AuthenticatedClientElement'
import ThumbnailImage from '@components/Objects/Thumbnails/ThumbnailImage'
import { Chip, ConfirmDialog, buttonClass, formatRelative } from '@components/Dashboard/Shared/DashKit/DashKit'
import { getUriWithOrg } from '@services/config/config'
import { getCommunityThumbnailMediaDirectory } from '@services/media/media'
import type { Community } from '@services/communities/communities'
import type { CommunityActivity } from './communityActivity'

// Desktop table layout: the card is the grid and each row spans it through
// subgrid, so the columns line up across rows (same trick as the courses list).
export const COMMUNITY_TABLE_GRID =
  'lg:grid lg:grid-cols-[minmax(0,2.8fr)_minmax(0,0.9fr)_minmax(0,1fr)_minmax(0,0.9fr)_auto] lg:gap-x-4'
export const COMMUNITY_ROW_GRID = 'lg:col-span-full lg:grid lg:grid-cols-subgrid lg:items-center lg:gap-x-4'

export const cleanCommunityUuid = (uuid: string) => uuid.replace('community_', '')

// A community opens on its discussions; settings are the other tab.
export const communityDashHref = (orgslug: string, community: Community, tab: 'discussions' | 'settings' = 'discussions') =>
  getUriWithOrg(orgslug, `/dash/communities/${cleanCommunityUuid(community.community_uuid)}/${tab}`)

export const communityPublicHref = (orgslug: string, community: Community) =>
  getUriWithOrg(orgslug, `/community/${cleanCommunityUuid(community.community_uuid)}`)

export function communityThumbnail(orgUuid: string | undefined, community: Community) {
  return community.thumbnail_image && orgUuid
    ? getCommunityThumbnailMediaDirectory(orgUuid, community.community_uuid, community.thumbnail_image)
    : null
}

export function VisibilityChip({ isPublic }: { isPublic?: boolean }) {
  const { t } = useTranslation()
  return isPublic ? (
    <Chip tone="sky" icon={<Globe size={12} />}>{t('communities.public')}</Chip>
  ) : (
    <Chip tone="violet" icon={<Lock size={12} />}>{t('communities.private')}</Chip>
  )
}

export function LinkedCourseChip({ linked }: { linked: boolean }) {
  const { t } = useTranslation()
  if (!linked) return null
  return (
    <Chip tone="emerald" icon={<BookOpen size={12} />}>
      {t('communities.linked_course')}
    </Chip>
  )
}

function Thumb({ src, name, className }: { src: string | null; name: string; className: string }) {
  return src ? (
    <ThumbnailImage src={src} alt={name} loading="lazy" className={className} />
  ) : (
    <div className={`flex items-center justify-center bg-neutral-100 text-neutral-300 ${className}`}>
      <Garage size={32} weight="duotone" />
    </div>
  )
}

const ITEM = 'flex items-center gap-2 cursor-pointer'

// Row/card menu. The confirm dialog lives outside the dropdown so it survives
// the menu closing (see ConfirmDialog in DashKit).
export function CommunityActionsMenu({
  community,
  orgslug,
  orgId,
  onEdit,
  onDelete,
}: {
  community: Community
  orgslug: string
  orgId: number
  onEdit: () => void
  onDelete: () => Promise<unknown>
}) {
  const { t } = useTranslation()
  const [confirmDelete, setConfirmDelete] = React.useState(false)

  return (
    <AuthenticatedClientElement action="delete" ressourceType="communities" orgId={orgId} checkMethod="roles">
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={t('communities.actions.community_actions')}
            className="h-8 w-8 inline-flex items-center justify-center rounded-lg text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100 data-[state=open]:bg-neutral-100 data-[state=open]:text-neutral-900 transition-colors"
          >
            <DotsThree size={18} weight="bold" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52 rounded-xl p-1.5">
          <DropdownMenuItem asChild>
            <Link prefetch={false} href={communityDashHref(orgslug, community)} className={ITEM}>
              <ChatCenteredText size={15} /> {t('communities.dash.tabs.discussions')}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link prefetch={false} href={communityDashHref(orgslug, community, 'settings')} className={ITEM}>
              <SlidersHorizontal size={15} /> {t('dashboard.courses.communities.card.open_settings')}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onEdit} className={ITEM}>
            <PencilSimple size={15} /> {t('dashboard.courses.communities.card.quick_edit')}
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <a href={communityPublicHref(orgslug, community)} target="_blank" rel="noreferrer" className={ITEM}>
              <ArrowSquareOut size={15} /> {t('dashboard.courses.communities.card.view_community')}
            </a>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => setConfirmDelete(true)}
            className={`${ITEM} text-rose-600 focus:text-rose-700 focus:bg-rose-50`}
          >
            <Trash size={15} /> {t('dashboard.courses.communities.modals.delete.button')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t('dashboard.courses.communities.modals.delete.title', { name: community.name })}
        message={t('dashboard.courses.communities.modals.delete.message')}
        confirmLabel={t('dashboard.courses.communities.modals.delete.button')}
        onConfirm={onDelete}
      />
    </AuthenticatedClientElement>
  )
}

type ItemProps = {
  community: Community
  /** Thread stats; null when the API cannot provide them. */
  activity?: CommunityActivity | null
  orgslug: string
  orgId: number
  orgUuid?: string
  onEdit: () => void
  onDelete: () => Promise<unknown>
}

// "4 threads · 1 unanswered", or nothing when the API has no stats.
function ThreadStats({ activity, className = '' }: { activity?: CommunityActivity | null; className?: string }) {
  const { t } = useTranslation()
  if (!activity) return null
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs text-neutral-500 tabular-nums ${className}`}>
      <ChatCenteredText size={13} className="text-neutral-400" />
      {t('communities.dash.activity.threads', { count: activity.discussion_count })}
      {activity.unanswered_count > 0 && (
        <span className="text-amber-700">· {t('communities.dash.activity.unanswered', { count: activity.unanswered_count })}</span>
      )}
    </span>
  )
}

// Latest thread or reply when known, else the community's own update date.
function lastActivityOf(community: Community, activity?: CommunityActivity | null) {
  return activity ? activity.last_activity_date : community.update_date
}

export function CommunityCard({ community, activity, orgslug, orgId, orgUuid, onEdit, onDelete }: ItemProps) {
  const { t, i18n } = useTranslation()
  const href = communityDashHref(orgslug, community)
  const last = formatRelative(lastActivityOf(community, activity), i18n.language)

  return (
    <div
      data-kbd-item=""
      className="group relative flex flex-col bg-white rounded-2xl nice-shadow overflow-hidden transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg"
    >
      <Link prefetch={false} href={href} className="block relative aspect-video overflow-hidden bg-neutral-100">
        <Thumb
          src={communityThumbnail(orgUuid, community)}
          name={community.name}
          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
        />
        <div className="absolute bottom-2.5 start-2.5 flex items-center gap-1.5">
          <VisibilityChip isPublic={community.public} />
          <LinkedCourseChip linked={!!community.course_id} />
        </div>
      </Link>

      <div className="absolute top-2 end-2 z-10 opacity-0 group-hover:opacity-100 focus-within:opacity-100 has-[[data-state=open]]:opacity-100 transition-opacity">
        <div className="rounded-lg bg-white/95 backdrop-blur shadow-sm">
          <CommunityActionsMenu community={community} orgslug={orgslug} orgId={orgId} onEdit={onEdit} onDelete={onDelete} />
        </div>
      </div>

      <div className="flex flex-col flex-1 p-4 gap-1">
        <Link
          prefetch={false}
          href={href}
          dir="auto"
          className="text-[15px] font-semibold text-neutral-900 leading-snug line-clamp-1 hover:underline underline-offset-2"
        >
          {community.name}
        </Link>
        <p className="text-xs text-neutral-500 line-clamp-2 min-h-[2rem]" dir="auto">
          {community.description || t('communities.dash.no_description')}
        </p>
        <div className="mt-auto pt-3 flex flex-col gap-1.5">
          <ThreadStats activity={activity} />
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-neutral-400 truncate">
              {last
                ? t(activity ? 'communities.dash.activity.last' : 'communities.dash.updated', { time: last })
                : activity
                  ? t('communities.dash.activity.none')
                  : ''}
            </span>
            <Link prefetch={false} href={communityDashHref(orgslug, community, 'settings')} className={buttonClass('ghost', 'sm', 'shrink-0')}>
              <SlidersHorizontal size={13} />
              {t('common.settings')}
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}

export function CommunityRow({ community, activity, orgslug, orgId, orgUuid, onEdit, onDelete }: ItemProps) {
  const { t, i18n } = useTranslation()
  const href = communityDashHref(orgslug, community)
  const lastValue = lastActivityOf(community, activity)
  const last = formatRelative(lastValue, i18n.language)

  return (
    <li className={`group relative flex items-center gap-3 px-4 sm:px-5 py-3 transition-colors hover:bg-neutral-50/70 ${COMMUNITY_ROW_GRID}`}>
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <Link prefetch={false} href={href} className="shrink-0">
          <Thumb
            src={communityThumbnail(orgUuid, community)}
            name={community.name}
            className="w-16 sm:w-20 aspect-video rounded-lg ring-1 ring-black/5 object-cover"
          />
        </Link>
        <div className="min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <Link
              prefetch={false}
              href={href}
              dir="auto"
              className="block text-sm font-semibold text-neutral-900 truncate hover:underline underline-offset-2"
            >
              {community.name}
            </Link>
            <span className="hidden lg:inline-flex shrink-0">
              <LinkedCourseChip linked={!!community.course_id} />
            </span>
          </div>
          <p className="text-xs text-neutral-500 truncate" dir="auto">
            {community.description || t('communities.dash.no_description')}
          </p>
          <div className="lg:hidden mt-1.5 flex flex-wrap items-center gap-1.5">
            <VisibilityChip isPublic={community.public} />
            <LinkedCourseChip linked={!!community.course_id} />
            <ThreadStats activity={activity} />
          </div>
        </div>
      </div>

      <div className="hidden lg:block">
        <VisibilityChip isPublic={community.public} />
      </div>
      <div className="hidden lg:block">
        {activity ? <ThreadStats activity={activity} /> : <span className="text-sm text-neutral-300">—</span>}
      </div>
      <div className="hidden lg:block text-sm text-neutral-600 truncate" title={lastValue ?? undefined}>
        {last ?? '—'}
      </div>

      <div className="flex items-center gap-1 justify-end shrink-0">
        {/* buttonClass sets inline-flex, so the hiding lives on a wrapper. */}
        <span className="hidden sm:inline-flex">
          <Link prefetch={false} href={communityDashHref(orgslug, community, 'settings')} className={buttonClass('secondary', 'sm')}>
            <SlidersHorizontal size={13} />
            {t('common.settings')}
          </Link>
        </span>
        <CommunityActionsMenu community={community} orgslug={orgslug} orgId={orgId} onEdit={onEdit} onDelete={onDelete} />
      </div>
    </li>
  )
}

export function CommunityCardSkeleton() {
  return (
    <div className="bg-white rounded-2xl nice-shadow overflow-hidden animate-pulse">
      <div className="aspect-video bg-neutral-100" />
      <div className="p-4 space-y-2">
        <div className="h-4 bg-neutral-100 rounded w-3/4" />
        <div className="h-3 bg-neutral-100 rounded w-full" />
        <div className="h-3 bg-neutral-100 rounded w-1/2" />
      </div>
    </div>
  )
}

export function CommunityRowSkeleton() {
  return (
    <div className="flex items-center gap-3 px-5 py-3.5 animate-pulse lg:col-span-full">
      <div className="w-20 aspect-video rounded-lg bg-neutral-100" />
      <div className="flex-1 space-y-2">
        <div className="h-3.5 bg-neutral-100 rounded w-1/3" />
        <div className="h-3 bg-neutral-100 rounded w-1/2" />
      </div>
      <div className="hidden sm:block h-6 w-20 bg-neutral-100 rounded-full" />
    </div>
  )
}
