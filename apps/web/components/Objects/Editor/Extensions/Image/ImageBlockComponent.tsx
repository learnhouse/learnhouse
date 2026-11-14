import { NodeViewProps, NodeViewWrapper } from '@tiptap/react'
import React from 'react'
import { Resizable } from 're-resizable'
import {
  Image as ImageIcon,
  DownloadSimple,
  TextAlignLeft,
  TextAlignCenter,
  TextAlignRight,
  ArrowsOut,
  ArrowsClockwise,
  ArrowsHorizontal,
  LinkSimple,
  Trash,
  TextT,
} from '@phosphor-icons/react'
import toast from 'react-hot-toast'
import { getActivityBlockMediaDirectory } from '@services/media/media'
import { useOrg } from '@components/Contexts/OrgContext'
import { useCourse } from '@components/Contexts/CourseContext'
import { useEditorProvider } from '@components/Contexts/Editor/EditorContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import { useTranslation } from 'react-i18next'
import AIImageButton from '@components/Objects/AI/AIImageButton'
import {
  BlockChrome,
  BlockPopover,
  BlockToolbarButton,
  BlockToolbarDivider,
  CommitInput,
  Segmented,
  SettingsField,
} from '../../Blocks/ui/BlockChrome'
import BlockCaption from '../../Blocks/ui/BlockCaption'
import MediaSourcePicker from '../../Blocks/ui/MediaSourcePicker'
import { useBlockUpload } from '../../Blocks/media/useBlockUpload'
import { acceptFor } from '../../Blocks/media/mediaKinds'
import { fetchRemoteFile, UrlImportError } from '../../Blocks/media/urlImport'
import { normalizeUserUrl } from '../../Blocks/embeds/embedProviders'
import { libraryMediaNodeAttrs } from '../../Blocks/media/librarySnapshot'
import { uploadErrorText } from '../../Blocks/media/uploadMessages'
import { deleteBlock, pickFile, replaceBlock } from '../../Blocks/nodeViewUtils'
import {
  IMAGE_WIDTH_PRESETS,
  imageWidthPresetOf,
  resolveImageView,
  safeHref,
} from '../../Blocks/schema/blockAttrs'

const UNSPLASH_UTM = '?utm_source=LearnHouse&utm_medium=referral'
const withUtm = (url?: string | null) => (url ? `${url}${UNSPLASH_UTM}` : '')

const ALIGN_CLASS = { left: 'items-start', center: 'items-center', right: 'items-end' } as const

function ImageBlockComponent(props: NodeViewProps) {
  const { t } = useTranslation()
  const org = useOrg() as any
  const course = useCourse() as any
  const editorState = useEditorProvider() as any
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const isEditable = editorState.isEditable
  const attrs = props.node.attrs
  const activity = (props.extension.options as any).activity

  // Everything shown comes from the node attrs (the shared document), so undo
  // and collaborators' edits show up. Only transient UI lives in React state.
  const view = resolveImageView(attrs)
  const blockObject = attrs.blockObject
  const [isModalOpen, setIsModalOpen] = React.useState(false)
  const [linkOpen, setLinkOpen] = React.useState(false)
  const [altOpen, setAltOpen] = React.useState(false)
  const [widthOpen, setWidthOpen] = React.useState(false)

  const upload = useBlockUpload({
    kind: 'image',
    activityUuid: activity?.activity_uuid,
    accessToken: access_token,
    onUploaded: (object) => {
      // A fresh upload replaces any remote (Unsplash/AI/link) source.
      props.updateAttributes({
        blockObject: object,
        unsplash_url: null,
        unsplash_photographer_name: null,
        unsplash_photographer_url: null,
        unsplash_photo_url: null,
        size: attrs.size ?? { width: 560 },
      })
    },
  })

  const unsplashUrl: string | null = attrs.unsplash_url || null
  const unsplashPhotographerName: string | null = attrs.unsplash_photographer_name || null
  const unsplashPhotographerUrl: string | null = attrs.unsplash_photographer_url || null
  const unsplashPhotoUrl: string | null = attrs.unsplash_photo_url || null

  const fileId = blockObject?.content
    ? `${blockObject.content.file_id}.${blockObject.content.file_format}`
    : null

  const uploadedImageUrl = blockObject?.content
    ? getActivityBlockMediaDirectory(
        org?.org_uuid,
        course?.courseStructure?.course_uuid,
        blockObject.content.activity_uuid || activity?.activity_uuid,
        blockObject.block_uuid,
        fileId || '',
        'imageBlock'
      )
    : null

  const imageUrl = unsplashUrl || uploadedImageUrl

  const handleDownload = () => {
    if (!fileId || !uploadedImageUrl) return
    const link = document.createElement('a')
    link.href = uploadedImageUrl
    link.download = `image-${blockObject?.block_uuid || 'download'}.${blockObject?.content.file_format || 'jpg'}`
    link.setAttribute('download', '')
    link.setAttribute('target', '_blank')
    link.setAttribute('rel', 'noopener noreferrer')
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  // Remote (generated or linked) images are stored under the same
  // `unsplash_url` attr the renderer already reads; no photographer credit.
  const setRemoteImage = (url: string) => {
    props.updateAttributes({
      blockObject: null,
      unsplash_url: url,
      unsplash_photographer_name: '',
      unsplash_photographer_url: '',
      unsplash_photo_url: '',
      size: attrs.size ?? { width: 560 },
    })
  }

  const importFromUrl = async (input: string): Promise<string | void> => {
    const url = normalizeUserUrl(input)
    if (!url) return uploadErrorText(t, { code: 'url' })
    try {
      const file = await fetchRemoteFile(url, 'image')
      upload.start(file)
    } catch (err) {
      if (err instanceof UrlImportError && err.code === 'blocked') {
        // The site won't let us copy the file; show it from the link instead.
        setRemoteImage(url)
        toast(t('editor.blocks_v2.image_linked', 'This site blocks copying, so the image is shown from its link.'))
        return
      }
      if (err instanceof UrlImportError) return uploadErrorText(t, { code: err.code, kind: 'image', error: err.message })
      return uploadErrorText(t, { code: 'server', error: (err as any)?.message })
    }
  }

  const unsplashCredit = unsplashUrl && unsplashPhotographerName ? (
    <p className="mt-2 text-[11px] text-neutral-500">
      Photo by{' '}
      <a
        href={withUtm(unsplashPhotographerUrl) || withUtm(unsplashPhotoUrl)}
        target="_blank"
        rel="noopener noreferrer"
        className="underline hover:text-neutral-700"
      >
        {unsplashPhotographerName}
      </a>
      {' '}on{' '}
      <a
        href={`https://unsplash.com/${UNSPLASH_UTM}`}
        target="_blank"
        rel="noopener noreferrer"
        className="underline hover:text-neutral-700"
      >
        Unsplash
      </a>
    </p>
  ) : null

  const viewerModal = imageUrl ? (
    <Modal
      isDialogOpen={isModalOpen}
      onOpenChange={setIsModalOpen}
      dialogTitle={view.caption || t('editor.blocks.image_block.viewer_title')}
      minWidth="lg"
      minHeight="lg"
      dialogContent={
        <div className="w-full flex flex-col items-center justify-center">
          <img
            src={imageUrl}
            alt={view.alt}
            className="max-w-full max-h-[80vh] object-contain rounded-lg shadow-lg"
          />
          {unsplashCredit}
        </div>
      }
    />
  ) : null

  // ─── Learner view: the image only, as before, plus caption/link/alt ───
  if (!isEditable) {
    if (!imageUrl) return null
    const viewFrameStyle: React.CSSProperties = { width: view.width, maxWidth: '100%' }
    // On a phone, anything sized like a picture (not an icon or logo) spans the
    // column; a few pixels short of full width just reads as a mistake there.
    const phoneFullWidth = typeof view.width === 'number' && view.width >= 240 ? 'max-md:!w-full' : ''
    const img = (
      <img
        src={imageUrl}
        alt={view.alt}
        onClick={() => {
          // On touch screens tapping the picture opens the viewer, since the
          // hover controls never show there. A linked image follows its link.
          if (!view.href && view.lightbox && window.matchMedia('(hover: none)').matches) setIsModalOpen(true)
        }}
        className="rounded-lg max-md:rounded-xl max-w-full h-auto w-full"
      />
    )
    return (
      <>
        <NodeViewWrapper className="block-image w-full">
          <div className={`w-full flex flex-col ${ALIGN_CLASS[view.alignment]}`}>
            <div className={`relative group ${phoneFullWidth}`} style={viewFrameStyle}>
              {view.href ? (
                <a href={view.href} target="_blank" rel="noopener noreferrer" className="block">
                  {img}
                </a>
              ) : (
                img
              )}
              {view.lightbox && (
                <div className="absolute top-2 end-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => setIsModalOpen(true)}
                    className="p-2 outline-none bg-black/50 hover:bg-black/70 rounded-lg transition-colors"
                    title={t('editor.blocks.image_block.expand_image')}
                  >
                    <ArrowsOut weight="duotone" className="w-4 h-4 text-white" />
                  </button>
                  {blockObject && (
                    <button
                      onClick={handleDownload}
                      className="p-2 outline-none bg-black/50 hover:bg-black/70 rounded-lg transition-colors"
                      title={t('editor.blocks.image_block.download_image')}
                    >
                      <DownloadSimple weight="duotone" className="w-4 h-4 text-white" />
                    </button>
                  )}
                </div>
              )}
            </div>
            {unsplashCredit && (
              <div className={phoneFullWidth} style={viewFrameStyle}>
                {unsplashCredit}
              </div>
            )}
            <BlockCaption value={view.caption} editable={false} className={phoneFullWidth} style={viewFrameStyle} />
          </div>
        </NodeViewWrapper>
        {view.lightbox && viewerModal}
      </>
    )
  }

  // ─── Editor: empty ───
  if (!imageUrl) {
    return (
      <NodeViewWrapper className="block-image w-full">
        <BlockChrome tone="media"
          selected={props.selected}
          label={<><ImageIcon size={11} weight="bold" />{t('editor.blocks.image')}</>}
          toolbar={
            <BlockToolbarButton label={t('common.delete', 'Delete')} tone="danger" onClick={() => deleteBlock(props)}>
              <Trash size={14} />
            </BlockToolbarButton>
          }
        >
          <MediaSourcePicker
            kind="image"
            icon={<ImageIcon size={20} weight="duotone" />}
            title={t('editor.blocks_v2.image_title', 'Add an image')}
            onFile={(f) => upload.start(f)}
            onUrl={importFromUrl}
            urlPlaceholder={t('editor.blocks_v2.image_link_placeholder', 'Paste an image link…')}
            onLibrarySelect={(r) => replaceBlock(props as any, { type: 'blockLibrary', attrs: libraryMediaNodeAttrs(r) })}
            extra={
              <AIImageButton
                variant="chip"
                onSelect={setRemoteImage}
                onSelectFile={(file) => {
                  upload.start(file)
                }}
              />
            }
            task={upload.task}
            rejection={upload.rejection}
            onCancel={upload.cancel}
            onRetry={upload.retry}
            onDismiss={upload.dismiss}
          />
        </BlockChrome>
      </NodeViewWrapper>
    )
  }

  // ─── Editor: image ───
  const setAlignment = (alignment: 'left' | 'center' | 'right') => props.updateAttributes({ alignment })
  const widthPreset = imageWidthPresetOf(attrs)
  const replacing = upload.task

  const toolbar = (
    <>
      <BlockToolbarButton label={t('editor.blocks.common.align_left')} active={view.alignment === 'left'} onClick={() => setAlignment('left')}>
        <TextAlignLeft size={14} />
      </BlockToolbarButton>
      <BlockToolbarButton label={t('editor.blocks.common.align_center')} active={view.alignment === 'center'} onClick={() => setAlignment('center')}>
        <TextAlignCenter size={14} />
      </BlockToolbarButton>
      <BlockToolbarButton label={t('editor.blocks.common.align_right')} active={view.alignment === 'right'} onClick={() => setAlignment('right')}>
        <TextAlignRight size={14} />
      </BlockToolbarButton>
      <BlockToolbarDivider />
      <BlockPopover
        open={widthOpen}
        onOpenChange={setWidthOpen}
        title={t('editor.blocks.common.size', 'Size')}
        width={260}
        trigger={
          <BlockToolbarButton label={t('editor.blocks.common.size', 'Size')}>
            <ArrowsHorizontal size={14} />
          </BlockToolbarButton>
        }
      >
        <Segmented
          ariaLabel={t('editor.blocks.common.size', 'Size')}
          value={widthPreset}
          onChange={(id) => {
            const preset = IMAGE_WIDTH_PRESETS.find((p) => p.id === id)
            if (preset) props.updateAttributes({ size: { width: preset.width } })
          }}
          options={[
            { value: 'small', label: 'S', title: t('editor.blocks.common.small', 'Small') },
            { value: 'medium', label: 'M', title: t('editor.blocks.common.medium', 'Medium') },
            { value: 'large', label: 'L', title: t('editor.blocks.common.large', 'Large') },
            { value: 'full', label: t('editor.blocks_v2.full', 'Full'), title: t('editor.blocks.common.full_width', 'Full width') },
          ]}
        />
        <p className="text-[11px] text-neutral-400">{t('editor.blocks_v2.drag_to_resize', 'Or drag the handle on the image’s edge.')}</p>
      </BlockPopover>
      <BlockPopover
        open={altOpen}
        onOpenChange={setAltOpen}
        title={t('editor.blocks_v2.alt_text', 'Alt text')}
        trigger={
          <BlockToolbarButton label={t('editor.blocks_v2.alt_text', 'Alt text')} active={!!view.alt}>
            <TextT size={14} />
          </BlockToolbarButton>
        }
      >
        <SettingsField
          label={t('editor.blocks_v2.alt_text_label', 'Describe the image')}
          hint={t('editor.blocks_v2.alt_text_hint', 'Read aloud by screen readers. Leave empty for purely decorative images.')}
        >
          <CommitInput
            multiline
            value={view.alt}
            onCommit={(v) => props.updateAttributes({ alt: v.trim().slice(0, 500) })}
            placeholder={t('editor.blocks_v2.alt_text_placeholder', 'A bar chart showing…')}
            aria-label={t('editor.blocks_v2.alt_text', 'Alt text')}
          />
        </SettingsField>
      </BlockPopover>
      <BlockPopover
        open={linkOpen}
        onOpenChange={setLinkOpen}
        title={t('editor.blocks_v2.link', 'Link')}
        trigger={
          <BlockToolbarButton label={t('editor.blocks_v2.link', 'Link')} active={!!view.href}>
            <LinkSimple size={14} />
          </BlockToolbarButton>
        }
      >
        <SettingsField
          label={t('editor.blocks_v2.link_label', 'Open this link when clicked')}
          hint={t('editor.blocks_v2.link_hint', 'Opens in a new tab. Leave empty for no link.')}
        >
          <CommitInput
            value={attrs.href || ''}
            type="url"
            onCommit={(v) => {
              const href = v.trim() ? safeHref(normalizeUserUrl(v) || v) : null
              props.updateAttributes({ href })
              if (v.trim() && !href) toast.error(uploadErrorText(t, { code: 'url' }))
            }}
            placeholder="https://"
            aria-label={t('editor.blocks_v2.link', 'Link')}
          />
        </SettingsField>
        <label className="flex items-center justify-between gap-3 text-xs text-neutral-600">
          <span>{t('editor.blocks_v2.lightbox', 'Learners can expand the image')}</span>
          <input
            type="checkbox"
            className="h-4 w-4 accent-neutral-900"
            checked={view.lightbox}
            onChange={(e) => props.updateAttributes({ lightbox: e.target.checked })}
          />
        </label>
      </BlockPopover>
      <BlockToolbarDivider />
      <BlockToolbarButton label={t('editor.blocks_v2.replace', 'Replace')} onClick={() => pickFile(acceptFor('image'), (f) => upload.start(f))}>
        <ArrowsClockwise size={14} />
      </BlockToolbarButton>
      <BlockToolbarButton label={t('editor.blocks.image_block.expand_image')} onClick={() => setIsModalOpen(true)}>
        <ArrowsOut size={14} />
      </BlockToolbarButton>
      <BlockToolbarButton label={t('common.delete', 'Delete')} tone="danger" onClick={() => deleteBlock(props)}>
        <Trash size={14} />
      </BlockToolbarButton>
    </>
  )

  const frameWidth = view.width
  return (
    <>
      <NodeViewWrapper className="block-image w-full">
        <BlockChrome tone="media"
          selected={props.selected}
          forceToolbar={widthOpen || altOpen || linkOpen}
          label={<><ImageIcon size={11} weight="bold" />{t('editor.blocks.image')}</>}
          toolbar={toolbar}
          className="p-1"
        >
          <div className={`w-full flex flex-col ${ALIGN_CLASS[view.alignment]}`}>
            <Resizable
              key={String(frameWidth)}
              defaultSize={{ width: frameWidth, height: 'auto' }}
              handleStyles={{
                right: {
                  position: 'absolute',
                  width: 6,
                  height: 40,
                  top: 'calc(50% - 20px)',
                  right: -10,
                  borderRadius: 20,
                  cursor: 'col-resize',
                  backgroundColor: '#a3a3a3',
                },
              }}
              handleClasses={{ right: 'opacity-0 group-hover/block:opacity-100 transition-opacity' }}
              style={{ maxWidth: '100%', position: 'relative' }}
              maxWidth="100%"
              minWidth={120}
              enable={{ right: true }}
              onResizeStop={(_e, _direction, ref) => {
                const parentWidth = ref.parentElement?.clientWidth || 1000
                const width = Math.round(Math.min(ref.offsetWidth, parentWidth))
                props.updateAttributes({ size: { width: width >= parentWidth - 2 ? '100%' : width } })
              }}
            >
              <div className="relative">
                <img
                  src={imageUrl}
                  alt={view.alt}
                  className="rounded-lg max-w-full h-auto"
                  style={{ width: '100%' }}
                  draggable={false}
                />
                {replacing && (
                  <div className="absolute inset-x-2 bottom-2">
                    <MediaSourcePicker
                      kind="image"
                      icon={<ImageIcon size={18} />}
                      title=""
                      onFile={() => {}}
                      task={replacing}
                      onCancel={upload.cancel}
                      onRetry={upload.retry}
                      onDismiss={upload.dismiss}
                    />
                  </div>
                )}
                {view.href && (
                  <span className="absolute bottom-2 start-2 inline-flex items-center gap-1 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
                    <LinkSimple size={10} weight="bold" />
                    {(() => { try { return new URL(view.href).hostname } catch { return view.href } })()}
                  </span>
                )}
              </div>
            </Resizable>
            {unsplashCredit && <div style={{ width: frameWidth, maxWidth: '100%' }}>{unsplashCredit}</div>}
            <BlockCaption
              value={view.caption}
              editable
              selected={props.selected}
              onCommit={(caption) => props.updateAttributes({ caption })}
              style={{ width: frameWidth, maxWidth: '100%' }}
            />
            {upload.rejection && (
              <p role="alert" className="mt-1 text-xs text-rose-600">
                {uploadErrorText(t, { code: upload.rejection.code, kind: 'image', fileSize: upload.rejection.fileSize })}
              </p>
            )}
          </div>
        </BlockChrome>
      </NodeViewWrapper>
      {viewerModal}
    </>
  )
}

export default ImageBlockComponent
