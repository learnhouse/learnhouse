'use client'
import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { toast } from 'react-hot-toast'
import { useQueryClient } from '@tanstack/react-query'
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd'
import { DotsSixVertical, Images, ImageSquare, Info, Plus, UploadSimple, X } from '@phosphor-icons/react'
import { SiLoom, SiYoutube } from '@icons-pack/react-simple-icons'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { constructAcceptValue } from '@/lib/constants'
import { cn } from '@/lib/utils'
import { getOrgPreviewMediaDirectory, getOrgThumbnailMediaDirectory } from '@services/media/media'
import { updateOrganization, uploadOrganizationPreview, uploadOrganizationThumbnail } from '@services/settings/org'
import { queryKeys } from '@/lib/query/keys'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import { Button, INPUT, OptionCard, SectionCard } from '@components/Dashboard/Shared/DashKit/DashKit'
import { ImageDropzone, SpecList, WhereItAppears, useAssetUpload } from './BrandingShared'
import { ExploreCardVignette, GalleryVignette, LinkPreviewVignette } from './BrandingVignettes'

const ACCEPT = constructAcceptValue(['png', 'jpg'])
const MAX_PREVIEWS = 4

type Preview = {
  id: string
  url: string
  type: 'image' | 'youtube' | 'loom'
  filename?: string
  thumbnailUrl?: string
  order: number
}

type VideoService = 'youtube' | 'loom' | null

function toPayload(previews: Preview[]) {
  return {
    previews: {
      images: previews
        .filter((p) => p.type === 'image')
        .map((p) => ({ filename: p.filename, order: p.order })),
      videos: previews
        .filter((p) => p.type === 'youtube' || p.type === 'loom')
        .map((p) => ({ type: p.type, url: p.url, id: p.id, order: p.order })),
    },
  }
}

function extractVideoId(url: string, type: 'youtube' | 'loom'): string | null {
  const regex =
    type === 'youtube'
      ? /(?:youtube\.com\/(?:[^/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?/\s]{11})/
      : /(?:loom\.com\/(?:share|embed)\/)([a-zA-Z0-9]+)/
  const match = url.match(regex)
  return match ? match[1] : null
}

export default function PreviewsTab() {
  const { t } = useTranslation()
  const router = useRouter()
  const queryClient = useQueryClient()
  const org = useOrg() as any
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token

  const thumbnail = useAssetUpload({
    upload: uploadOrganizationThumbnail,
    loading: t('dashboard.organization.images.uploading_thumbnail'),
    success: t('dashboard.organization.images.toasts.thumbnail_success'),
    error: t('dashboard.organization.images.toasts.thumbnail_error'),
  })
  const thumbnailUrl =
    thumbnail.localUrl ||
    (org?.thumbnail_image ? getOrgThumbnailMediaDirectory(org.org_uuid, org.thumbnail_image) : null)

  const [previews, setPreviews] = useState<Preview[]>(() => {
    const images = (org?.previews?.images || [])
      .filter((item: any) => item?.filename)
      .map((item: any, index: number) => ({
        id: item.filename,
        url: getOrgPreviewMediaDirectory(org?.org_uuid, item.filename),
        filename: item.filename,
        type: 'image' as const,
        order: item.order ?? index,
      }))
    const videos = (org?.previews?.videos || [])
      .filter((video: any) => video && video.id)
      .map((video: any, index: number) => ({
        id: video.id,
        url: video.url,
        type: video.type as 'youtube' | 'loom',
        thumbnailUrl: video.type === 'youtube' ? `https://img.youtube.com/vi/${video.id}/maxresdefault.jpg` : '',
        filename: '',
        order: video.order ?? images.length + index,
      }))
    return [...images, ...videos].sort((a, b) => a.order - b.order)
  })
  const [isPreviewUploading, setIsPreviewUploading] = useState(false)
  const [videoUrl, setVideoUrl] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [selectedService, setSelectedService] = useState<VideoService>(null)

  const persist = async (next: Preview[]) => {
    await updateOrganization(org.id, toPayload(next), accessToken)
    setPreviews(next)
    queryClient.invalidateQueries({ queryKey: queryKeys.org.detail(org.slug) })
    router.refresh()
  }

  const handlePreviewUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || [])
    event.target.value = ''
    if (files.length === 0) return
    const remaining = MAX_PREVIEWS - previews.length
    if (files.length > remaining) {
      toast.error(
        t('dashboard.organization.images.toasts.max_previews', { count: remaining })
      )
      return
    }
    setIsPreviewUploading(true)
    const toastId = toast.loading(
      t('dashboard.organization.images.uploading_previews', { count: files.length })
    )
    try {
      const uploaded = await Promise.all(
        files.map(async (file, i) => {
          const response = await uploadOrganizationPreview(org.id, file, accessToken)
          return {
            id: response.name_in_disk,
            url: URL.createObjectURL(file),
            filename: response.name_in_disk,
            type: 'image' as const,
            order: previews.length + i,
          }
        })
      )
      await persist([...previews, ...uploaded])
      setDialogOpen(false)
      toast.success(
        t('dashboard.organization.images.toasts.preview_added', { count: files.length }),
        { id: toastId }
      )
    } catch (_err) {
      toast.error(t('dashboard.organization.images.toasts.preview_error'), { id: toastId })
    } finally {
      setIsPreviewUploading(false)
    }
  }

  const removePreview = async (id: string) => {
    const toastId = toast.loading(t('dashboard.organization.images.toasts.preview_removed'))
    try {
      await persist(previews.filter((p) => p.id !== id).map((p, i) => ({ ...p, order: i })))
      toast.success(t('dashboard.organization.images.toasts.preview_removed'), { id: toastId })
    } catch (_err) {
      toast.error(t('dashboard.organization.images.toasts.preview_remove_error'), { id: toastId })
    }
  }

  const handleVideoSubmit = async (type: 'youtube' | 'loom') => {
    const videoId = extractVideoId(videoUrl, type)
    if (!videoId) {
      toast.error(t('dashboard.organization.images.toasts.invalid_url', { type }))
      return
    }
    if (previews.some((p) => p.id === videoId)) {
      toast.error(t('dashboard.organization.images.toasts.video_exists'))
      return
    }
    const toastId = toast.loading(t('dashboard.organization.images.toasts.adding_video'))
    try {
      await persist([
        ...previews,
        {
          id: videoId,
          url: videoUrl,
          type,
          thumbnailUrl: type === 'youtube' ? `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg` : '',
          filename: '',
          order: previews.length,
        },
      ])
      setVideoUrl('')
      setSelectedService(null)
      setDialogOpen(false)
      toast.success(t('dashboard.organization.images.toasts.video_preview_added'), { id: toastId })
    } catch (_err) {
      toast.error(t('dashboard.organization.images.toasts.video_preview_error'), { id: toastId })
    }
  }

  const handleDragEnd = async (result: DropResult) => {
    if (!result.destination) return
    const items = Array.from(previews)
    const [moved] = items.splice(result.source.index, 1)
    items.splice(result.destination.index, 0, moved)
    const reordered = items.map((item, index) => ({ ...item, order: index }))
    const before = previews
    setPreviews(reordered)
    const toastId = toast.loading(t('dashboard.organization.images.toasts.updating_order'))
    try {
      await persist(reordered)
      toast.success(t('dashboard.organization.images.toasts.order_updated'), { id: toastId })
    } catch (_err) {
      toast.error(t('dashboard.organization.images.toasts.order_update_error'), { id: toastId })
      setPreviews(before)
    }
  }

  const galleryItems = previews.map((p) => ({
    id: p.id,
    kind: p.type,
    url: p.type === 'image' ? getOrgPreviewMediaDirectory(org?.org_uuid, p.id) : p.thumbnailUrl || '',
  }))

  const addOptions = [
    {
      id: 'image',
      title: t('dashboard.organization.images.video_modal.images'),
      description: t('dashboard.organization.images.accepted_files'),
      icon: <UploadSimple size={20} />,
      iconClass: 'bg-neutral-100 text-neutral-700',
      onClick: () => document.getElementById('previewInput')?.click(),
    },
    {
      id: 'youtube',
      title: t('dashboard.organization.images.video_modal.youtube'),
      description: t('dashboard.organization.images.video_modal.youtube_desc'),
      icon: <SiYoutube className="h-5 w-5 text-[#FF0000]" />,
      iconClass: 'bg-red-50',
      onClick: () => setSelectedService('youtube'),
    },
    {
      id: 'loom',
      title: t('dashboard.organization.images.video_modal.loom'),
      description: t('dashboard.organization.images.video_modal.loom_desc'),
      icon: <SiLoom className="h-5 w-5 text-[#625DF5]" />,
      iconClass: 'bg-indigo-50',
      onClick: () => setSelectedService('loom'),
    },
  ]

  const closeDialog = (open: boolean) => {
    setDialogOpen(open)
    if (!open) {
      setSelectedService(null)
      setVideoUrl('')
    }
  }

  return (
    <SectionCard
      icon={<Images size={18} />}
      title={t('dashboard.organization.branding.tabs.previews')}
      description={t('dashboard.organization.settings_ui.branding.previews_desc')}
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-neutral-900">
            <ImageSquare size={16} className="text-neutral-400" />
            {t('dashboard.organization.branding.previews.thumbnail_title')}
          </div>
          <p className="mt-1 mb-4 text-xs leading-relaxed text-neutral-500">
            {t('dashboard.organization.branding.previews.thumbnail_desc')}
          </p>
          <ImageDropzone
            id="thumbnailInput"
            shape="wide"
            currentUrl={thumbnailUrl}
            accept={ACCEPT}
            uploading={thumbnail.uploading}
            onFile={thumbnail.handleFile}
            emptyLabel={t('dashboard.organization.branding.previews.thumbnail_add')}
            replaceLabel={t('dashboard.organization.branding.previews.thumbnail_replace')}
          />
          <SpecList
            items={[
              t('dashboard.organization.branding.specs.formats'),
              t('dashboard.organization.branding.specs.thumbnail_size'),
              t('dashboard.organization.branding.specs.max_size'),
            ]}
          />
        </div>

        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-neutral-900">
            <Images size={16} className="text-neutral-400" />
            {t('dashboard.organization.branding.previews.gallery_title')}
            <span className="text-xs font-normal text-neutral-400 tabular-nums">
              {previews.length}/{MAX_PREVIEWS}
            </span>
          </div>
          <p className="mt-1 mb-4 text-xs leading-relaxed text-neutral-500">
            {t('dashboard.organization.branding.previews.gallery_desc')}
          </p>
          <DragDropContext onDragEnd={handleDragEnd}>
            <Droppable droppableId="previews" direction="horizontal">
              {(provided) => (
                <div className="flex flex-wrap gap-3" {...provided.droppableProps} ref={provided.innerRef}>
                  {previews.map((preview, index) => (
                    <Draggable key={preview.id} draggableId={preview.id} index={index}>
                      {(dragProvided, snapshot) => (
                        <div
                          ref={dragProvided.innerRef}
                          {...dragProvided.draggableProps}
                          className={cn('group relative h-[84px] w-[140px] shrink-0', snapshot.isDragging && 'z-drag-overlay')}
                        >
                          <div
                            className={cn(
                              'relative h-full w-full overflow-hidden rounded-lg bg-neutral-100 ring-1 ring-inset ring-black/[0.07]',
                              snapshot.isDragging ? 'shadow-lg' : ''
                            )}
                          >
                            {preview.type === 'image' ? (
                              <img
                                src={getOrgPreviewMediaDirectory(org?.org_uuid, preview.id)}
                                alt=""
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <>
                                <img src={preview.thumbnailUrl} alt="" className="h-full w-full object-cover" />
                                <span className="absolute inset-0 flex items-center justify-center bg-black/40">
                                  {preview.type === 'youtube' ? (
                                    <SiYoutube className="h-6 w-6 text-white" />
                                  ) : (
                                    <SiLoom className="h-6 w-6 text-white" />
                                  )}
                                </span>
                              </>
                            )}
                          </div>
                          <span
                            {...dragProvided.dragHandleProps}
                            aria-label={t('dashboard.organization.images.drag_to_reorder')}
                            className="absolute -start-1.5 -top-1.5 flex h-6 w-6 cursor-grab items-center justify-center rounded-full bg-white text-neutral-500 opacity-0 shadow ring-1 ring-black/10 transition-opacity group-hover:opacity-100 active:cursor-grabbing"
                          >
                            <DotsSixVertical size={14} weight="bold" />
                          </span>
                          <button
                            type="button"
                            onClick={() => removePreview(preview.id)}
                            aria-label={t('common.remove', { defaultValue: 'Remove' })}
                            className="absolute -end-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-white text-neutral-500 opacity-0 shadow ring-1 ring-black/10 transition-opacity hover:text-rose-600 group-hover:opacity-100"
                          >
                            <X size={12} weight="bold" />
                          </button>
                        </div>
                      )}
                    </Draggable>
                  ))}
                  {provided.placeholder}
                  {previews.length < MAX_PREVIEWS && (
                    <button
                      type="button"
                      onClick={() => setDialogOpen(true)}
                      className="flex h-[84px] w-[140px] shrink-0 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-neutral-300 bg-neutral-50 text-neutral-500 transition-colors hover:bg-neutral-100"
                    >
                      <Plus size={16} />
                      <span className="text-[11px] font-medium">{t('dashboard.organization.images.add_preview')}</span>
                    </button>
                  )}
                </div>
              )}
            </Droppable>
          </DragDropContext>
          <p className="mt-3 flex items-center gap-1.5 text-xs text-neutral-400">
            <Info size={13} />
            {t('dashboard.organization.images.drag_to_reorder')}
          </p>
        </div>
      </div>

      <WhereItAppears>
        <ExploreCardVignette
          thumbnailUrl={thumbnailUrl}
          name={org?.name}
          description={org?.description}
          label={t('dashboard.organization.branding.vignettes.explore_card')}
        />
        <LinkPreviewVignette
          thumbnailUrl={thumbnailUrl}
          name={org?.name}
          host={org?.slug ? `${org.slug}.learnhouse.io` : undefined}
          label={t('dashboard.organization.branding.vignettes.link_preview')}
        />
        <GalleryVignette items={galleryItems} label={t('dashboard.organization.branding.vignettes.gallery')} />
      </WhereItAppears>

      <input type="file" id="previewInput" accept={ACCEPT} className="hidden" onChange={handlePreviewUpload} multiple />

      <Modal
        isDialogOpen={dialogOpen}
        onOpenChange={closeDialog}
        size="sm"
        icon={<Images size={16} />}
        onBack={selectedService ? () => setSelectedService(null) : undefined}
        dialogTitle={t('dashboard.organization.images.video_modal.title')}
        dialogContent={
          !selectedService ? (
            <div className="flex flex-col gap-2">
              {addOptions.map((option) => (
                <OptionCard
                  key={option.id}
                  icon={option.icon}
                  iconClass={option.iconClass}
                  title={option.title}
                  description={option.description}
                  onClick={option.onClick}
                  disabled={option.id === 'image' && isPreviewUploading}
                />
              ))}
            </div>
          ) : (
            <form
              className="flex flex-col gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                if (videoUrl) handleVideoSubmit(selectedService)
              }}
            >
              <p className="text-sm text-neutral-600">
                {t('dashboard.organization.images.video_modal.url_placeholder', {
                  service: selectedService === 'youtube' ? 'YouTube' : 'Loom',
                })}
              </p>
              <input
                placeholder={
                  selectedService === 'youtube' ? 'https://youtube.com/watch?v=...' : 'https://www.loom.com/share/...'
                }
                value={videoUrl}
                onChange={(e) => setVideoUrl(e.target.value)}
                autoFocus
                className={INPUT}
              />
            </form>
          )
        }
        footer={
          selectedService ? (
            <>
              <Button onClick={() => setSelectedService(null)}>{t('common.back')}</Button>
              <Button variant="primary" onClick={() => handleVideoSubmit(selectedService)} disabled={!videoUrl}>
                {t('dashboard.organization.images.video_modal.add_button')}
              </Button>
            </>
          ) : undefined
        }
      />
    </SectionCard>
  )
}
