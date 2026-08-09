import { NodeViewProps, NodeViewWrapper } from '@tiptap/react'
import React from 'react'
import toast from 'react-hot-toast'
import {
  ArrowLeftRight,
  BookCopy,
  Download,
  ExternalLink,
  Expand,
  Gamepad2,
  LayoutGrid,
  Library,
  Loader2,
  Podcast,
  Trash2,
  Upload,
  Users,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useOrg } from '@components/Contexts/OrgContext'
import { useEditorProvider } from '@components/Contexts/Editor/EditorContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import MediaViewer from '@components/Objects/Media/MediaViewer'
import MediaLightbox from '@components/Objects/Media/MediaLightbox'
import ResourcePicker, {
  type SelectedResource,
} from '@components/Dashboard/Library/ResourcePicker'
import { createMedia, getMediaById, getMediaFileDirectory } from '@services/media/media-resource'
import { buildEmbedUrl, buildResourceUrl, type ResourceKind } from '@/lib/library/resourceEmbed'

const UPLOAD_ACCEPT =
  'image/*,video/*,audio/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip'

const RESOURCE_ICONS: Partial<Record<ResourceKind, any>> = {
  course: BookCopy,
  podcast: Podcast,
  community: Users,
  board: LayoutGrid,
  playground: Gamepad2,
}

/** The subset of a Media row the block caches so it can paint before refetching. */
function snapshotOf(resource: any) {
  if (!resource) return null
  return {
    name: resource.name ?? '',
    media_type: resource.media_type ?? null,
    file_format: resource.file_format ?? null,
    file_mime: resource.file_mime ?? null,
    file_size: resource.file_size ?? null,
    url: resource.url ?? null,
    thumbnail_image: resource.thumbnail_image ?? null,
  }
}

function LibraryBlockComponent(props: NodeViewProps) {
  const { t } = useTranslation()
  const org = useOrg() as any
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const editorState = useEditorProvider() as any
  const isEditable = editorState.isEditable

  const resourceUuid: string | null = props.node.attrs.resourceUuid
  const resourceType: ResourceKind | null = props.node.attrs.resourceType
  const snapshot = props.node.attrs.snapshot
  const display: string = props.node.attrs.display || 'inline'

  const [pickerOpen, setPickerOpen] = React.useState(false)
  const [lightboxOpen, setLightboxOpen] = React.useState(false)
  const [uploading, setUploading] = React.useState(false)
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  const isMedia = resourceType === 'media'

  // The snapshot is a point-in-time copy; refresh it so a renamed or replaced
  // asset doesn't keep showing stale metadata (same approach as the video block).
  React.useEffect(() => {
    if (!isMedia || !resourceUuid || !access_token) return
    let cancelled = false
    getMediaById(resourceUuid, access_token)
      .then((fresh: any) => {
        if (cancelled || !fresh?.media_uuid) return
        const next = snapshotOf(fresh)
        if (JSON.stringify(next) !== JSON.stringify(snapshot)) {
          props.updateAttributes({ snapshot: next })
        }
      })
      .catch(() => {
        /* no access or deleted — the viewer renders its own fallback */
      })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMedia, resourceUuid, access_token])

  const applySelection = (selected: SelectedResource) => {
    props.updateAttributes({
      resourceUuid: selected.resource_uuid,
      resourceType: selected.resource_type,
      snapshot: selected.resource_type === 'media' ? snapshotOf(selected.resource) : {
        name: selected.name ?? '',
      },
    })
    setPickerOpen(false)
  }

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !org?.id) return
    setUploading(true)
    const toastId = toast.loading(t('media.uploading_media'))
    try {
      const formData = new FormData()
      formData.append('org_id', String(org.id))
      formData.append('name', file.name.replace(/\.[^.]+$/, ''))
      formData.append('media_type', 'UPLOAD')
      formData.append('public', 'true')
      formData.append('file', file)
      // Uploading here creates a real Library asset, so the file stays reusable
      // instead of being buried under this one activity.
      const created = await createMedia(formData, access_token)
      props.updateAttributes({
        resourceUuid: created.media_uuid,
        resourceType: 'media',
        snapshot: snapshotOf(created),
      })
      toast.success(t('media.media_uploaded_success'))
    } catch (error: any) {
      toast.error(error?.message || t('media.media_uploaded_error'))
    } finally {
      toast.dismiss(toastId)
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const clearSelection = () => {
    props.updateAttributes({ resourceUuid: null, resourceType: null, snapshot: null })
  }

  const picker = (
    <Modal
      isDialogOpen={pickerOpen}
      onOpenChange={setPickerOpen}
      minWidth="md"
      minHeight="no-min"
      dialogTitle={t('library.choose_from_library')}
      dialogContent={
        <ResourcePicker
          orgslug={org?.slug}
          mode="select"
          tabs={['media', 'courses', 'podcasts', 'communities', 'boards', 'playgrounds']}
          onSelect={applySelection}
          selectedUuid={resourceUuid || undefined}
        />
      }
    />
  )

  // ─── Empty ───
  if (!resourceUuid) {
    if (!isEditable) {
      return (
        <NodeViewWrapper className="my-4">
          <div className="flex items-center justify-center gap-3 py-8 bg-white rounded-lg nice-shadow">
            <Library className="text-slate-300" size={32} />
            <p className="text-slate-500">{t('library.no_resource_selected')}</p>
          </div>
        </NodeViewWrapper>
      )
    }
    return (
      <NodeViewWrapper className="my-4">
        <div
          className="flex flex-col items-center justify-center gap-4 py-8 bg-white rounded-lg text-slate-700 px-4 border-2 border-dashed border-slate-200 text-sm"
          contentEditable={false}
        >
          {uploading ? (
            <Loader2 className="animate-spin text-slate-400" size={32} />
          ) : (
            <>
              <Library className="text-slate-300" size={40} />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPickerOpen(true)}
                  className="p-2 px-4 bg-slate-700 hover:bg-slate-800 rounded-lg text-white transition-colors gap-2 items-center flex text-sm font-medium"
                >
                  <Library size={16} />
                  <span>{t('library.choose_from_library')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="p-2 px-4 bg-slate-100 hover:bg-slate-200 rounded-lg text-slate-700 transition-colors gap-2 items-center flex text-sm font-medium"
                >
                  <Upload size={16} />
                  <span>{t('library.upload_to_library')}</span>
                </button>
              </div>
              <p className="text-xs text-slate-400">{t('library.upload_to_library_hint')}</p>
            </>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept={UPLOAD_ACCEPT}
            className="hidden"
            onChange={handleUpload}
          />
        </div>
        {picker}
      </NodeViewWrapper>
    )
  }

  // ─── Filled ───
  const name = snapshot?.name || t('library.untitled')
  const downloadUrl =
    isMedia && snapshot?.media_type !== 'EMBED'
      ? getMediaFileDirectory(org?.org_uuid, resourceUuid, undefined, { download: true })
      : null

  const toolbar = (
    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
      {isMedia && (
        <button
          type="button"
          onClick={() => setLightboxOpen(true)}
          title={t('library.preview')}
          className="p-1.5 rounded-md bg-white/90 backdrop-blur-sm hover:bg-white nice-shadow text-slate-600"
        >
          <Expand size={14} />
        </button>
      )}
      {downloadUrl && (
        <a
          href={downloadUrl}
          title={t('media.download')}
          className="p-1.5 rounded-md bg-white/90 backdrop-blur-sm hover:bg-white nice-shadow text-slate-600"
        >
          <Download size={14} />
        </a>
      )}
      {isEditable && (
        <>
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            title={t('library.replace_resource')}
            className="p-1.5 rounded-md bg-white/90 backdrop-blur-sm hover:bg-white nice-shadow text-slate-600"
          >
            <ArrowLeftRight size={14} />
          </button>
          <button
            type="button"
            onClick={clearSelection}
            title={t('library.remove_resource')}
            className="p-1.5 rounded-md bg-white/90 backdrop-blur-sm hover:bg-white nice-shadow text-rose-600"
          >
            <Trash2 size={14} />
          </button>
        </>
      )}
    </div>
  )

  if (isMedia) {
    return (
      <NodeViewWrapper className="my-4">
        <div className="group relative" contentEditable={false}>
          <div className="absolute top-2 end-2 z-10">{toolbar}</div>
          <MediaViewer
            resource={{ ...snapshot, name }}
            mediaUuid={resourceUuid}
            maxHeightClass="max-h-[60vh]"
          />
        </div>
        <MediaLightbox
          resource={{ ...snapshot, name }}
          mediaUuid={resourceUuid}
          isOpen={lightboxOpen}
          onOpenChange={setLightboxOpen}
        />
        {picker}
      </NodeViewWrapper>
    )
  }

  // Other library resources (course, podcast, community, board, playground).
  const kind = (resourceType || 'course') as ResourceKind
  const Icon = RESOURCE_ICONS[kind] || Library
  const baseUrl = org?.slug ? buildResourceUrl(kind, resourceUuid, org.slug) : null

  return (
    <NodeViewWrapper className="my-4">
      <div className="group relative" contentEditable={false}>
        <div className="absolute top-2 end-2 z-10">{toolbar}</div>

        {display === 'embed' && baseUrl ? (
          <div className="w-full rounded-xl overflow-hidden nice-shadow bg-white" style={{ height: '70vh', minHeight: 420 }}>
            <iframe
              src={buildEmbedUrl(kind, baseUrl)}
              title={name}
              className="w-full h-full border-0"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
              allowFullScreen
            />
          </div>
        ) : (
          <div className="flex items-center gap-3 bg-white rounded-xl nice-shadow px-4 py-3">
            <Icon size={22} className="text-slate-400 flex-shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-gray-900 truncate">{name}</p>
              <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                {t(`library.tabs.${kind}s`)}
              </p>
            </div>
            {baseUrl && (
              <a
                href={baseUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-800 transition-colors"
              >
                <ExternalLink size={14} /> {t('library.open')}
              </a>
            )}
          </div>
        )}

        {isEditable && baseUrl && (
          <button
            type="button"
            onClick={() =>
              props.updateAttributes({ display: display === 'embed' ? 'card' : 'embed' })
            }
            className="mt-2 text-xs font-medium text-gray-400 hover:text-gray-700 transition-colors"
          >
            {display === 'embed' ? t('library.show_as_card') : t('library.show_inline')}
          </button>
        )}
      </div>
      {picker}
    </NodeViewWrapper>
  )
}

export default LibraryBlockComponent
