'use client'
import React from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import {
  ArrowSquareOut,
  Books,
  Cube,
  DotsThree,
  DownloadSimple,
  Eye,
  EyeSlash,
  File as FileIcon,
  FilePdf,
  FolderMinus,
  FolderSimple,
  Lightning,
  Globe,
  Image as ImageIcon,
  LinkSimple,
  Lock,
  MicrophoneStage,
  MusicNote,
  PencilSimple,
  PencilSimpleLine,
  SlidersHorizontal,
  SquaresFour,
  Trash,
  VideoCamera,
  CheckCircle,
  Garage,
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
import MediaLightbox from '@components/Objects/Media/MediaLightbox'
import { Chip, ConfirmDialog, formatRelative } from '@components/Dashboard/Shared/DashKit/DashKit'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import EditFolderModal from '@components/Dashboard/Library/EditFolderModal'
import ManageAccessModal from '@components/Dashboard/Library/ManageAccessModal'
import MediaPreview from '@components/Dashboard/Library/MediaPreview'
import { folderTone } from '@components/Dashboard/Library/LibraryToolbar'
import { resourceHref, safeExternalUrl } from '@components/Dashboard/Library/resourceLink'
import { shareFolderLink, shareMediaLink } from '@components/Dashboard/Library/shareFolder'
import { getUriWithOrg } from '@services/config/config'
import { removeFolderPrefix } from '@services/folders/folders'
import { getCourseThumbnailMediaDirectory, getFolderThumbnailMediaDirectory } from '@services/media/media'
import { getMediaFileDirectory } from '@services/media/media-resource'
import { mediaKind } from '@/lib/media/mediaKind'

// Desktop list layout: the same subgrid trick as the courses list, so the
// columns line up across folder and item rows.
export const LIB_TABLE_GRID =
  'lg:grid lg:grid-cols-[minmax(0,3fr)_minmax(0,0.9fr)_minmax(0,0.9fr)_minmax(0,0.9fr)_auto] lg:gap-x-4'
export const LIB_ROW_GRID = 'lg:col-span-full lg:grid lg:grid-cols-subgrid lg:items-center lg:gap-x-4'

const ITEM = 'flex items-center gap-2 cursor-pointer'
const MENU_TRIGGER =
  'h-7 w-7 inline-flex items-center justify-center rounded-md text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100 data-[state=open]:bg-neutral-100 data-[state=open]:text-neutral-900 transition-colors'

// ---------- type helpers ----------

const TYPE_TONE: Record<string, string> = {
  courses: 'bg-sky-50 text-sky-600',
  media: 'bg-amber-50 text-amber-500',
  podcasts: 'bg-rose-50 text-rose-500',
  communities: 'bg-emerald-50 text-emerald-500',
  boards: 'bg-indigo-50 text-indigo-500',
  playgrounds: 'bg-fuchsia-50 text-fuchsia-500',
}

export function typeTone(type: string) {
  return TYPE_TONE[type] || 'bg-neutral-100 text-neutral-400'
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

export function typeIcon(type: string, resource?: any) {
  switch (type) {
    case 'courses': return Books
    case 'media': return mediaIcon(resource)
    case 'podcasts': return MicrophoneStage
    case 'communities': return Garage
    case 'boards': return SquaresFour
    case 'playgrounds': return Lightning
    default: return Cube
  }
}

function TypeTile({ type, resource, size = 'md' }: { type: string; resource?: any; size?: 'md' | 'lg' }) {
  const Icon = typeIcon(type, resource)
  return (
    <span
      className={`${size === 'lg' ? 'w-full h-full' : 'w-10 h-10 rounded-lg'} flex items-center justify-center shrink-0 ${typeTone(type)}`}
    >
      {/* eslint-disable-next-line react-hooks/static-components */}
      <Icon size={size === 'lg' ? 40 : 20} weight="fill" />
    </span>
  )
}

export const itemName = (item: any, fallback: string) =>
  item?.resource?.name || item?.resource?.title || fallback

const cleanCourseUuid = (uuid?: string) => (uuid || '').replace('course_', '')

function VisibilityChip({ isPublic }: { isPublic?: boolean }) {
  const { t } = useTranslation()
  if (typeof isPublic !== 'boolean') return <span className="text-sm text-neutral-300">—</span>
  return isPublic ? (
    <Chip tone="sky" icon={<Globe size={12} />}>{t('library.public')}</Chip>
  ) : (
    <Chip tone="violet" icon={<Lock size={12} />}>{t('library.private')}</Chip>
  )
}

function PrivateBadge() {
  const { t } = useTranslation()
  return (
    <span
      title={t('library.private')}
      className="w-6 h-6 rounded-full bg-white/90 backdrop-blur text-violet-600 flex items-center justify-center shadow-sm"
    >
      <Lock size={12} />
    </span>
  )
}

// ---------- folders ----------

type FolderProps = {
  folder: any
  orgslug: string
  org_id: number
  onChanged: () => void
  onDelete: (_folder: any) => void | Promise<void>
  dragHandle?: React.ReactNode
  context?: React.ReactNode
}

const folderHref = (orgslug: string, folder: any) =>
  getUriWithOrg(orgslug, `/dash/library/folder/${removeFolderPrefix(folder.folder_uuid)}`)

function folderCount(folder: any) {
  return folder.total_items ?? (folder.items?.length || 0) + (folder.subfolders?.length || 0)
}

function FolderTile({ folder, className = 'w-10 h-10' }: { folder: any; className?: string }) {
  const org = useOrg() as any
  const thumb = folder.thumbnail_image
    ? getFolderThumbnailMediaDirectory(org?.org_uuid, folder.folder_uuid, folder.thumbnail_image)
    : null
  return thumb ? (
    <span
      className={`${className} rounded-lg bg-cover bg-center shrink-0 ring-1 ring-inset ring-black/5`}
      style={{ backgroundImage: `url(${thumb})` }}
    />
  ) : (
    <span className={`${className} rounded-lg flex items-center justify-center shrink-0 ${folderTone(folder.color)}`}>
      <FolderSimple size={20} weight="fill" />
    </span>
  )
}

export function FolderActionsMenu({ folder, orgslug, org_id, onChanged, onDelete }: Omit<FolderProps, 'dragHandle' | 'context'>) {
  const { t } = useTranslation()
  const [dialog, setDialog] = React.useState<'edit' | 'access' | 'delete' | null>(null)
  return (
    <AuthenticatedClientElement action="update" ressourceType={'folders' as any} checkMethod="roles" orgId={org_id}>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label={t('library.folder_actions')} className={MENU_TRIGGER}>
            <DotsThree size={16} weight="bold" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52 rounded-xl p-1.5">
          <DropdownMenuItem asChild>
            <Link prefetch={false} href={folderHref(orgslug, folder)} className={ITEM}>
              <ArrowSquareOut size={15} /> {t('library.open')}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => shareFolderLink(orgslug, folder.folder_uuid, folder.name, t('library.link_copied'), t('library.link_copy_error'))}
            className={ITEM}
          >
            <LinkSimple size={15} /> {t('library.copy_link')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setDialog('edit')} className={ITEM}>
            <PencilSimple size={15} /> {t('library.edit')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setDialog('access')} className={ITEM}>
            <Lock size={15} /> {t('library.manage_access')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => setDialog('delete')}
            className={`${ITEM} text-rose-600 focus:text-rose-700 focus:bg-rose-50`}
          >
            <Trash size={15} /> {t('library.delete_folder')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <EditFolderModal
        open={dialog === 'edit'}
        onOpenChange={(open) => !open && setDialog(null)}
        folder={folder}
        orgslug={orgslug}
        onChanged={onChanged}
      />
      <ManageAccessModal
        open={dialog === 'access'}
        onOpenChange={(open) => !open && setDialog(null)}
        resource_uuid={folder.folder_uuid}
        resourceType="folders"
        orgslug={orgslug}
        name={folder.name}
      />
      <ConfirmDialog
        open={dialog === 'delete'}
        onOpenChange={(open) => !open && setDialog(null)}
        title={t('library.delete_folder_title', { name: folder.name })}
        message={t('library.delete_folder_confirm')}
        confirmLabel={t('library.delete_folder')}
        onConfirm={() => onDelete(folder)}
      />
    </AuthenticatedClientElement>
  )
}

export function FolderCard(props: FolderProps) {
  const { t } = useTranslation()
  const { folder, orgslug, dragHandle, context } = props
  const count = folderCount(folder)
  return (
    <div className="flex flex-col min-w-0">
      <div
        data-kbd-item=""
        className="group relative flex items-center gap-3 bg-white nice-shadow rounded-2xl p-3 transition-shadow hover:shadow-md has-[[data-state=open]]:shadow-md"
      >
        {dragHandle}
        <Link prefetch={false} href={folderHref(orgslug, folder)} className="flex items-center gap-3 min-w-0 flex-1">
          <FolderTile folder={folder} />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5 min-w-0">
              <span className="text-sm font-semibold text-neutral-900 truncate" dir="auto">
                {folder.name}
              </span>
              {folder.public === false && <Lock size={12} className="text-violet-500 shrink-0" aria-label={t('library.private')} />}
            </span>
            <span className="block text-xs text-neutral-400 tabular-nums">{t('library.dash.item_count', { count })}</span>
          </span>
        </Link>
        <div className="shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100 has-[[data-state=open]]:opacity-100 transition-opacity">
          <FolderActionsMenu {...props} />
        </div>
      </div>
      {context}
    </div>
  )
}

export function FolderRow(props: FolderProps) {
  const { t, i18n } = useTranslation()
  const { folder, orgslug, context } = props
  const count = folderCount(folder)
  const updated = formatRelative(folder.update_date, i18n.language)
  return (
    <li className={`group flex items-center gap-3 px-4 sm:px-5 py-3 hover:bg-neutral-50/70 transition-colors ${LIB_ROW_GRID}`}>
      <Link prefetch={false} href={folderHref(orgslug, folder)} className="flex items-center gap-3 min-w-0 flex-1">
        <FolderTile folder={folder} />
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-neutral-900 truncate hover:underline underline-offset-2" dir="auto">
            {folder.name}
          </span>
          {context ?? (
            <span className="block text-xs text-neutral-500 truncate" dir="auto">
              {folder.description || t('library.dash.item_count', { count })}
            </span>
          )}
        </span>
      </Link>
      <div className="hidden lg:block">
        <Chip tone="neutral" icon={<FolderSimple size={12} />}>{t('library.folder')}</Chip>
      </div>
      <div className="hidden lg:block">
        <VisibilityChip isPublic={folder.public} />
      </div>
      <div className="hidden lg:block text-sm text-neutral-600 truncate tabular-nums">
        {t('library.dash.item_count', { count })}
        {updated && <span className="block text-xs text-neutral-400">{updated}</span>}
      </div>
      <div className="flex items-center justify-end shrink-0">
        <FolderActionsMenu {...props} />
      </div>
    </li>
  )
}

// ---------- items (courses, media, other resources) ----------

type ItemProps = {
  item: any
  orgslug: string
  org_id: number
  onRemove: (_item: any) => void | Promise<void>
  dragHandle?: React.ReactNode
  context?: React.ReactNode
}

// Where an item opens and what it can do, worked out once for card and row.
function useItemModel(item: any, orgslug: string) {
  const { t } = useTranslation()
  const org = useOrg() as any
  const type: string = item.resource_type
  const resource = item.resource || {}
  const name = itemName(item, t('library.untitled'))
  const mediaUuid = resource.media_uuid || item.resource_uuid
  const isUploadMedia = type === 'media' && resource.media_type !== 'EMBED'

  let href: string | null = null // internal page
  let externalHref: string | null = null // media file / embed url
  let downloadUrl: string | null = null
  let publicHref: string | null = null
  let editContentHref: string | null = null
  let thumb: string | null = null
  if (type === 'courses') {
    const uuid = cleanCourseUuid(resource.course_uuid || item.resource_uuid)
    href = getUriWithOrg(orgslug, `/dash/courses/course/${uuid}/general`)
    editContentHref = getUriWithOrg(orgslug, `/dash/courses/course/${uuid}/content`)
    publicHref = getUriWithOrg(orgslug, `/course/${uuid}`)
    thumb = resource.thumbnail_image
      ? getCourseThumbnailMediaDirectory(org?.org_uuid, resource.course_uuid || item.resource_uuid, resource.thumbnail_image)
      : null
  } else if (type === 'media') {
    // Uploaded media is served via the authed /media/{uuid}/file endpoint.
    if (isUploadMedia) {
      externalHref = getMediaFileDirectory(org?.org_uuid, mediaUuid)
      // The `download` attribute is ignored cross-origin, so the attachment
      // disposition has to come from the API.
      downloadUrl = getMediaFileDirectory(org?.org_uuid, mediaUuid, undefined, { download: true })
    } else if (resource.url) {
      externalHref = safeExternalUrl(resource.url)
    }
  } else {
    href = resourceHref(type, resource, orgslug, 'dashboard')
  }
  return { type, resource, name, mediaUuid, isUploadMedia, href, externalHref, downloadUrl, publicHref, editContentHref, thumb }
}

type ItemModel = ReturnType<typeof useItemModel>

function ItemActionsMenu({
  model,
  item,
  orgslug,
  onRemove,
  onPreview,
}: {
  model: ItemModel
  item: any
  orgslug: string
  onRemove: (_item: any) => void | Promise<void>
  onPreview: () => void
}) {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const [dialog, setDialog] = React.useState<'access' | 'remove' | null>(null)
  const { type } = model

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label={t('library.item_actions')} className={MENU_TRIGGER}>
            <DotsThree size={16} weight="bold" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52 rounded-xl p-1.5">
          {type === 'courses' && model.editContentHref && (
            <DropdownMenuItem asChild>
              <Link prefetch={false} href={model.editContentHref} className={ITEM}>
                <PencilSimpleLine size={15} /> {t('courses.edit_content')}
              </Link>
            </DropdownMenuItem>
          )}
          {type === 'courses' && model.href && (
            <DropdownMenuItem asChild>
              <Link prefetch={false} href={model.href} className={ITEM}>
                <SlidersHorizontal size={15} /> {t('common.settings')}
              </Link>
            </DropdownMenuItem>
          )}
          {type === 'courses' && model.publicHref && (
            <DropdownMenuItem asChild>
              <a href={model.publicHref} target="_blank" rel="noreferrer" className={ITEM}>
                <ArrowSquareOut size={15} /> {t('library.dash.view_course')}
              </a>
            </DropdownMenuItem>
          )}
          {type !== 'courses' && type !== 'media' && model.href && (
            <DropdownMenuItem asChild>
              <Link prefetch={false} href={model.href} className={ITEM}>
                <ArrowSquareOut size={15} /> {t('library.open')}
              </Link>
            </DropdownMenuItem>
          )}
          {type === 'media' && (
            <DropdownMenuItem onSelect={onPreview} className={ITEM}>
              <Eye size={15} /> {t('library.preview')}
            </DropdownMenuItem>
          )}
          {model.downloadUrl && (
            <DropdownMenuItem asChild>
              <a href={model.downloadUrl} className={ITEM}>
                <DownloadSimple size={15} /> {t('media.download')}
              </a>
            </DropdownMenuItem>
          )}
          {type === 'media' && model.externalHref && (
            <DropdownMenuItem asChild>
              <a href={model.externalHref} target="_blank" rel="noopener noreferrer" className={ITEM}>
                <ArrowSquareOut size={15} /> {t('library.open')}
              </a>
            </DropdownMenuItem>
          )}
          {model.isUploadMedia && (
            <DropdownMenuItem
              onSelect={() => shareMediaLink(model.mediaUuid, access_token, t('library.link_copied'), t('library.link_copy_error'))}
              className={ITEM}
            >
              <LinkSimple size={15} /> {t('library.copy_link')}
            </DropdownMenuItem>
          )}
          {(type === 'media' || type === 'courses') && (
            <DropdownMenuItem onSelect={() => setDialog('access')} className={ITEM}>
              <Lock size={15} /> {t('library.manage_access')}
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => setDialog('remove')}
            className={`${ITEM} text-rose-600 focus:text-rose-700 focus:bg-rose-50`}
          >
            <FolderMinus size={15} /> {t('library.remove_from_folder')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {(type === 'media' || type === 'courses') && (
        <ManageAccessModal
          open={dialog === 'access'}
          onOpenChange={(open) => !open && setDialog(null)}
          resource_uuid={type === 'media' ? model.mediaUuid : model.resource.course_uuid || item.resource_uuid}
          resourceType={type === 'media' ? 'media' : 'courses'}
          orgslug={orgslug}
          name={model.name}
        />
      )}
      <ConfirmDialog
        open={dialog === 'remove'}
        onOpenChange={(open) => !open && setDialog(null)}
        title={t('library.remove_from_folder')}
        message={t('library.remove_from_folder_confirm')}
        confirmLabel={t('library.remove_from_folder')}
        onConfirm={() => onRemove(item)}
      />
    </>
  )
}

function CourseStatusChip({ published }: { published?: boolean }) {
  const { t } = useTranslation()
  return published ? (
    <Chip tone="emerald" icon={<CheckCircle size={12} />}>{t('courses.published')}</Chip>
  ) : (
    <Chip tone="neutral" icon={<EyeSlash size={12} />}>{t('library.dash.draft')}</Chip>
  )
}

// Opens the item: media in the in-app lightbox, everything else by link.
function ItemOpener({
  model,
  onPreview,
  className,
  children,
}: {
  model: ItemModel
  onPreview: () => void
  className?: string
  children: React.ReactNode
}) {
  if (model.type === 'media') {
    return (
      <button type="button" onClick={onPreview} className={`text-start ${className || ''}`}>
        {children}
      </button>
    )
  }
  if (model.href) {
    return (
      <Link prefetch={false} href={model.href} className={className}>
        {children}
      </Link>
    )
  }
  return <div className={className}>{children}</div>
}

function ItemMeta({ model }: { model: ItemModel }) {
  const { t, i18n } = useTranslation()
  const updated = formatRelative(model.resource.update_date || model.resource.creation_date, i18n.language)
  return (
    <span className="truncate">
      {t(`library.tabs.${model.type}`)}
      {updated ? ` · ${updated}` : ''}
    </span>
  )
}

export function ItemCard({ item, orgslug, org_id, onRemove, dragHandle, context }: ItemProps) {
  const model = useItemModel(item, orgslug)
  const [previewOpen, setPreviewOpen] = React.useState(false)
  const onPreview = () => setPreviewOpen(true)

  return (
    <div className="flex flex-col min-w-0">
      <div
        data-kbd-item=""
        className="group relative flex flex-col bg-white rounded-2xl nice-shadow overflow-hidden transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg"
      >
        <ItemOpener model={model} onPreview={onPreview} className="block relative">
          <div className="relative aspect-video overflow-hidden bg-neutral-100">
            {model.type === 'media' ? (
              <MediaPreview resource={model.resource} resourceUuid={item.resource_uuid} />
            ) : model.type === 'courses' ? (
              <ThumbnailImage
                src={model.thumb || '/empty_thumbnail.png'}
                loading="lazy"
                alt=""
                className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
              />
            ) : (
              <TypeTile type={model.type} resource={model.resource} size="lg" />
            )}
            <div className="absolute bottom-2.5 start-2.5 flex items-center gap-1.5">
              {model.type === 'courses' && <CourseStatusChip published={model.resource.published} />}
              {model.resource.public === false && <PrivateBadge />}
            </div>
          </div>
          <div className="px-3.5 py-3">
            <p className="text-sm font-semibold text-neutral-900 leading-snug truncate" dir="auto">
              {model.name}
            </p>
            <p className="mt-0.5 flex items-center gap-1.5 text-xs text-neutral-400 min-w-0">
              <ItemMeta model={model} />
            </p>
          </div>
        </ItemOpener>

        {dragHandle}

        <AuthenticatedClientElement action="update" ressourceType={'folders' as any} checkMethod="roles" orgId={org_id}>
          <div className="absolute top-2 end-2 z-10 opacity-0 group-hover:opacity-100 focus-within:opacity-100 has-[[data-state=open]]:opacity-100 transition-opacity">
            <div className="rounded-lg bg-white/95 backdrop-blur shadow-sm">
              <ItemActionsMenu model={model} item={item} orgslug={orgslug} onRemove={onRemove} onPreview={onPreview} />
            </div>
          </div>
        </AuthenticatedClientElement>

        {model.type === 'media' && (
          <MediaLightbox resource={model.resource} mediaUuid={model.mediaUuid} isOpen={previewOpen} onOpenChange={setPreviewOpen} />
        )}
      </div>
      {context}
    </div>
  )
}

export function ItemRow({ item, orgslug, org_id, onRemove, context }: ItemProps) {
  const model = useItemModel(item, orgslug)
  const [previewOpen, setPreviewOpen] = React.useState(false)
  const onPreview = () => setPreviewOpen(true)
  const { t, i18n } = useTranslation()
  const updated = formatRelative(model.resource.update_date || model.resource.creation_date, i18n.language)
  const Icon = typeIcon(model.type, model.resource)

  return (
    <li className={`group flex items-center gap-3 px-4 sm:px-5 py-3 hover:bg-neutral-50/70 transition-colors ${LIB_ROW_GRID}`}>
      <ItemOpener model={model} onPreview={onPreview} className="flex items-center gap-3 min-w-0 flex-1">
        {model.type === 'courses' ? (
          <ThumbnailImage
            src={model.thumb || '/empty_thumbnail.png'}
            loading="lazy"
            alt=""
            className="w-16 aspect-video rounded-lg object-cover ring-1 ring-black/5 shrink-0"
          />
        ) : (
          <TypeTile type={model.type} resource={model.resource} />
        )}
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-neutral-900 truncate hover:underline underline-offset-2" dir="auto">
            {model.name}
          </span>
          {context ?? (
            <span className="flex text-xs text-neutral-500 min-w-0 lg:hidden">
              <ItemMeta model={model} />
            </span>
          )}
        </span>
      </ItemOpener>
      <div className="hidden lg:flex items-center gap-1.5 flex-wrap">
        {/* eslint-disable-next-line react-hooks/static-components */}
        <Chip tone="neutral" icon={<Icon size={12} />}>{t(`library.tabs.${model.type}`)}</Chip>
        {model.type === 'courses' && !model.resource.published && <CourseStatusChip published={false} />}
      </div>
      <div className="hidden lg:block">
        <VisibilityChip isPublic={model.resource.public} />
      </div>
      <div className="hidden lg:block text-sm text-neutral-600 truncate">{updated ?? '—'}</div>
      <div className="flex items-center justify-end shrink-0">
        <AuthenticatedClientElement action="update" ressourceType={'folders' as any} checkMethod="roles" orgId={org_id}>
          <ItemActionsMenu model={model} item={item} orgslug={orgslug} onRemove={onRemove} onPreview={onPreview} />
        </AuthenticatedClientElement>
      </div>
      {model.type === 'media' && (
        <MediaLightbox resource={model.resource} mediaUuid={model.mediaUuid} isOpen={previewOpen} onOpenChange={setPreviewOpen} />
      )}
    </li>
  )
}

// ---------- skeletons ----------

export function LibraryGridSkeleton() {
  return (
    <div className="flex flex-col gap-6 animate-pulse">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 bg-white nice-shadow rounded-2xl p-3">
            <div className="w-10 h-10 rounded-lg bg-neutral-100" />
            <div className="flex-1 space-y-2">
              <div className="h-3.5 w-2/3 rounded bg-neutral-100" />
              <div className="h-3 w-1/3 rounded bg-neutral-100" />
            </div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-white rounded-2xl nice-shadow overflow-hidden">
            <div className="aspect-video bg-neutral-100" />
            <div className="p-3.5 space-y-2">
              <div className="h-3.5 w-3/4 rounded bg-neutral-100" />
              <div className="h-3 w-1/3 rounded bg-neutral-100" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function LibraryListSkeleton() {
  return (
    <div className="bg-white rounded-2xl nice-shadow overflow-hidden divide-y divide-neutral-100 animate-pulse">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-5 py-3.5">
          <div className="w-10 h-10 rounded-lg bg-neutral-100" />
          <div className="flex-1 space-y-2">
            <div className="h-3.5 w-1/3 rounded bg-neutral-100" />
            <div className="h-3 w-1/4 rounded bg-neutral-100" />
          </div>
          <div className="hidden sm:block h-6 w-20 rounded-full bg-neutral-100" />
        </div>
      ))}
    </div>
  )
}
