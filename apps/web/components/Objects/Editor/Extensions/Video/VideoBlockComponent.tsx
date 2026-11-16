import { NodeViewProps, NodeViewWrapper } from '@tiptap/react'
import { Node } from '@tiptap/core'
import {
  VideoCamera, ArrowsOut, ArrowsClockwise, ArrowsHorizontal, Trash, Timer, ListNumbers, Plus, X,
} from '@phosphor-icons/react'
import React from 'react'
import { useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { getVideoBlock } from '../../../../../services/blocks/Video/video'
import { getVideoBlockStreamUrl, getVideoBlockHlsMasterUrl, getVideoBlockHlsThumbnailsUrl } from '@services/media/media'
import { useOrg } from '@components/Contexts/OrgContext'
import { useCourse } from '@components/Contexts/CourseContext'
import { useEditorProvider } from '@components/Contexts/Editor/EditorContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import LearnHousePlayer from '@components/Objects/Activities/Video/LearnHousePlayer'
import { useTranslation } from 'react-i18next'
import { buttonClass } from '@components/Dashboard/Shared/DashKit/buttons'
import {
  BlockChrome, BlockPopover, BlockToolbarButton, BlockToolbarDivider, CommitInput, FIELD_CLASS, Segmented, SettingsField,
} from '../../Blocks/ui/BlockChrome'
import BlockCaption from '../../Blocks/ui/BlockCaption'
import MediaSourcePicker from '../../Blocks/ui/MediaSourcePicker'
import { useBlockUpload } from '../../Blocks/media/useBlockUpload'
import { acceptFor } from '../../Blocks/media/mediaKinds'
import { fetchRemoteFile, looksLikeFileUrl, UrlImportError } from '../../Blocks/media/urlImport'
import { embedAttrsFor, normalizeUserUrl, parseEmbedUrl } from '../../Blocks/embeds/embedProviders'
import { libraryMediaNodeAttrs } from '../../Blocks/media/librarySnapshot'
import { uploadErrorText } from '../../Blocks/media/uploadMessages'
import { deleteBlock, pickFile, replaceBlock } from '../../Blocks/nodeViewUtils'
import { formatTimecode, normalizeChapters, parseTimecode, resolveVideoBlockObject, VIDEO_SIZES, type VideoSize } from '../../Blocks/schema/blockAttrs'

interface ExtendedNodeViewProps extends Omit<NodeViewProps, 'extension'> {
  extension: Node & {
    options: {
      activity: { activity_uuid: string }
      // Passed at configure() time so playback ids resolve reliably even where
      // the Org/Course React contexts aren't populated (e.g. the student page).
      orgUuid?: string
      courseUuid?: string
    }
  }
}

function ChaptersEditor({ value, onCommit }: { value: { start: number; title: string }[]; onCommit: (_v: { start: number; title: string }[]) => void }) {
  const { t } = useTranslation()
  const [rows, setRows] = React.useState(() => value.map((c) => ({ time: formatTimecode(c.start), title: c.title })))
  const commit = (next = rows) => {
    const cleaned = normalizeChapters(next.map((r) => ({ start: parseTimecode(r.time), title: r.title })))
    if (JSON.stringify(cleaned) !== JSON.stringify(value)) onCommit(cleaned)
  }
  return (
    <div className="flex flex-col gap-2">
      {rows.map((row, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <input
            value={row.time}
            onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, time: e.target.value } : r)))}
            onBlur={() => commit()}
            onKeyDown={(e) => e.stopPropagation()}
            placeholder="0:00"
            aria-label={t('editor.blocks_v2.chapter_time', 'Chapter start')}
            className={`${FIELD_CLASS} w-16 flex-none tabular-nums ${parseTimecode(row.time) == null && row.time ? 'text-rose-600' : ''}`}
          />
          <input
            value={row.title}
            onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, title: e.target.value } : r)))}
            onBlur={() => commit()}
            onKeyDown={(e) => e.stopPropagation()}
            placeholder={t('editor.blocks_v2.chapter_title', 'Chapter title')}
            aria-label={t('editor.blocks_v2.chapter_title', 'Chapter title')}
            className={FIELD_CLASS}
          />
          <button
            type="button"
            aria-label={t('common.delete', 'Delete')}
            className="flex h-7 w-7 flex-none items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-100 hover:text-rose-600"
            onClick={() => {
              const next = rows.filter((_, j) => j !== i)
              setRows(next)
              commit(next)
            }}
          >
            <X size={12} />
          </button>
        </div>
      ))}
      <button
        type="button"
        className={buttonClass('secondary', 'sm', 'self-start')}
        onClick={() => setRows([...rows, { time: '', title: '' }])}
      >
        <Plus size={12} /> {t('editor.blocks_v2.add_chapter', 'Add chapter')}
      </button>
    </div>
  )
}

function VideoBlockComponent(props: ExtendedNodeViewProps) {
  const { t } = useTranslation()
  const { node, extension, updateAttributes } = props
  const org = useOrg() as any
  const course = useCourse() as any
  const editorState = useEditorProvider() as any
  const session = useLHSession() as any
  const isEditable = editorState?.isEditable
  const access_token = session?.data?.tokens?.access_token

  // Read from the node (the shared document) so undo and collaborators show.
  const blockObject = React.useMemo(() => resolveVideoBlockObject(node.attrs.blockObject), [node.attrs.blockObject])
  const selectedSize: VideoSize = blockObject?.size || 'medium'
  const caption: string = node.attrs.caption || ''
  const startTime: number | null = parseTimecode(node.attrs.startTime) || null
  const chapters = React.useMemo(() => normalizeChapters(node.attrs.chapters), [node.attrs.chapters])

  const [isModalOpen, setIsModalOpen] = React.useState(false)
  const [openPopover, setOpenPopover] = React.useState<null | 'size' | 'start' | 'chapters'>(null)
  const [hlsMeta, setHlsMeta] = React.useState<any>(blockObject?.content?.hls ?? null)

  const upload = useBlockUpload({
    kind: 'video',
    activityUuid: extension.options.activity?.activity_uuid,
    accessToken: access_token,
    onUploaded: (object) => updateAttributes({ blockObject: { ...object, size: selectedSize } }),
  })

  const fileId = blockObject?.content?.file_id ? `${blockObject.content.file_id}.${blockObject.content.file_format}` : null
  const orgUuid = extension.options.orgUuid || org?.org_uuid
  const courseUuid = extension.options.courseUuid || course?.courseStructure?.course_uuid
  const activityUuid = blockObject?.content?.activity_uuid || extension.options.activity?.activity_uuid

  const mp4Url = blockObject && orgUuid && courseUuid && activityUuid && fileId
    ? getVideoBlockStreamUrl(orgUuid, courseUuid, activityUuid, blockObject.block_uuid, fileId)
    : null

  // Fetch the fresh block once we have its uuid, to learn whether HLS is ready.
  // Cached per block: the node view remounts whenever the editor or the lesson
  // re-renders its document, and each mount used to ask again.
  const blockUuid = blockObject?.block_uuid
  const { data: freshHls } = useQuery({
    queryKey: ['video-block', blockUuid],
    queryFn: async () => (await getVideoBlock(blockUuid as string, access_token))?.content?.hls ?? null,
    enabled: !!blockUuid && !!access_token,
    staleTime: 60_000,
  })
  React.useEffect(() => {
    if (freshHls) setHlsMeta(freshHls)
  }, [freshHls])

  const hlsReady = hlsMeta?.status === 'ready'
  const hlsMasterUrl = hlsReady && blockObject && orgUuid && courseUuid && activityUuid
    ? getVideoBlockHlsMasterUrl(orgUuid, courseUuid, activityUuid, blockObject.block_uuid)
    : null

  // Adaptive HLS when ready (with the MP4 as fallback), else the progressive MP4.
  const videoUrl = hlsMasterUrl || mp4Url
  const playerProps = {
    src: videoUrl || '',
    // No media bytes until the block scrolls into view (a lesson can hold
    // several); the storyboard frame, when there is one, is the poster.
    preload: 'none' as const,
    isHls: !!hlsMasterUrl,
    fallbackSrc: hlsMasterUrl && mp4Url ? mp4Url : undefined,
    details: startTime ? { startTime } : undefined,
    chapters: chapters.length ? chapters : undefined,
    thumbnails:
      hlsReady && hlsMeta?.thumbnails?.url && blockObject && orgUuid && courseUuid && activityUuid
        ? {
            url: getVideoBlockHlsThumbnailsUrl(orgUuid, courseUuid, activityUuid, blockObject.block_uuid, hlsMeta.thumbnails.url),
            interval: hlsMeta.thumbnails.interval,
            width: hlsMeta.thumbnails.width,
            height: hlsMeta.thumbnails.height,
            columns: hlsMeta.thumbnails.columns,
            rows: hlsMeta.thumbnails.rows ?? 1,
          }
        : null,
  }

  const playerModal = blockObject && videoUrl ? (
    <Modal
      isDialogOpen={isModalOpen}
      onOpenChange={setIsModalOpen}
      dialogTitle={caption || t('editor.blocks.video_block.player_title')}
      minWidth="lg"
      minHeight="lg"
      dialogContent={
        <div className="w-full aspect-video overflow-hidden rounded-[20px]">
          <LearnHousePlayer
            key={isModalOpen ? videoUrl : undefined}
            {...playerProps}
            details={{ ...(playerProps.details || {}), autoplay: true }}
          />
        </div>
      }
    />
  ) : null

  // ─── Learner view ───
  if (!isEditable) {
    if (!blockObject || !videoUrl) return null
    const width = VIDEO_SIZES[selectedSize].width
    return (
      <>
        <NodeViewWrapper className="block-video w-full">
          <div className="w-full flex justify-center relative">
            <div style={{ maxWidth: width, width: '100%' }}>
              <div className="relative group w-full aspect-video overflow-hidden rounded-[20px]">
                <LearnHousePlayer {...playerProps} />
                <div className="absolute top-2 end-2 z-40 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => setIsModalOpen(true)}
                    className="p-2 outline-none bg-black/50 hover:bg-black/70 rounded-lg transition-colors"
                    title={t('editor.blocks.video_block.expand_video')}
                  >
                    <ArrowsOut weight="duotone" className="w-4 h-4 text-white" />
                  </button>
                </div>
              </div>
              <BlockCaption value={caption} editable={false} />
            </div>
          </div>
        </NodeViewWrapper>
        {playerModal}
      </>
    )
  }

  const importFromUrl = async (input: string): Promise<string | void> => {
    const url = normalizeUserUrl(input)
    if (!url) return uploadErrorText(t, { code: 'url' })
    const parsed = parseEmbedUrl(url)
    if (parsed) {
      // A YouTube/Vimeo/Loom link plays from its own service.
      replaceBlock(props as any, { type: 'blockEmbed', attrs: { ...embedAttrsFor(parsed), caption } })
      return
    }
    if (!looksLikeFileUrl(url, 'video')) {
      return t('editor.blocks_v2.video_link_hint', 'Paste a YouTube, Vimeo or Loom link, or a direct link to an MP4 or WebM file.')
    }
    try {
      upload.start(await fetchRemoteFile(url, 'video'))
    } catch (err) {
      if (err instanceof UrlImportError) return uploadErrorText(t, { code: err.code, kind: 'video', error: err.message })
      return uploadErrorText(t, { code: 'server', error: (err as any)?.message })
    }
  }

  const label = <><VideoCamera size={11} weight="bold" />{t('editor.blocks.video')}</>
  const deleteButton = (
    <BlockToolbarButton label={t('common.delete', 'Delete')} tone="danger" onClick={() => deleteBlock(props as any)}>
      <Trash size={14} />
    </BlockToolbarButton>
  )

  // ─── Editor: empty (or the stored file can't be resolved) ───
  if (!blockObject || !videoUrl) {
    return (
      <NodeViewWrapper className="block-video w-full">
        <BlockChrome tone="media" selected={props.selected} label={label} toolbar={deleteButton}>
          <MediaSourcePicker
            kind="video"
            icon={<VideoCamera size={20} weight="duotone" />}
            title={t('editor.blocks_v2.video_title', 'Add a video')}
            onFile={(f) => upload.start(f)}
            onUrl={importFromUrl}
            urlPlaceholder={t('editor.blocks_v2.video_link_placeholder', 'YouTube, Vimeo, Loom or an .mp4 link…')}
            onLibrarySelect={(r) => replaceBlock(props as any, { type: 'blockLibrary', attrs: libraryMediaNodeAttrs(r) })}
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

  // ─── Editor: video ───
  const toggle = (which: 'size' | 'start' | 'chapters') => (open: boolean) => setOpenPopover(open ? which : null)
  const toolbar = (
    <>
      <BlockPopover
        open={openPopover === 'size'}
        onOpenChange={toggle('size')}
        title={t('editor.blocks.common.size', 'Size')}
        width={240}
        trigger={<BlockToolbarButton label={t('editor.blocks.common.size', 'Size')}><ArrowsHorizontal size={14} /></BlockToolbarButton>}
      >
        <Segmented
          ariaLabel={t('editor.blocks.common.size', 'Size')}
          value={selectedSize}
          onChange={(size) => updateAttributes({ blockObject: { ...blockObject, size } })}
          options={[
            { value: 'small', label: t('editor.blocks.common.small', 'Small') },
            { value: 'medium', label: t('editor.blocks.common.medium', 'Medium') },
            { value: 'large', label: t('editor.blocks.common.large', 'Large') },
          ]}
        />
      </BlockPopover>
      <BlockPopover
        open={openPopover === 'start'}
        onOpenChange={toggle('start')}
        title={t('editor.blocks_v2.start_time', 'Start time')}
        width={240}
        trigger={
          <BlockToolbarButton label={t('editor.blocks_v2.start_time', 'Start time')} active={!!startTime}>
            <Timer size={14} />
            {startTime ? <span className="tabular-nums">{formatTimecode(startTime)}</span> : null}
          </BlockToolbarButton>
        }
      >
        <SettingsField
          label={t('editor.blocks_v2.start_at', 'Start playing at')}
          hint={t('editor.blocks_v2.start_hint', 'For example 1:30. Leave empty to start at the beginning.')}
        >
          <CommitInput
            value={startTime ? formatTimecode(startTime) : ''}
            placeholder="0:00"
            aria-label={t('editor.blocks_v2.start_time', 'Start time')}
            onCommit={(v) => {
              const seconds = parseTimecode(v)
              if (v.trim() && seconds == null) {
                toast.error(t('editor.blocks_v2.bad_time', 'Use a time like 1:30 or 1:02:03.'))
                return
              }
              updateAttributes({ startTime: seconds || null })
            }}
          />
        </SettingsField>
      </BlockPopover>
      <BlockPopover
        open={openPopover === 'chapters'}
        onOpenChange={toggle('chapters')}
        title={t('editor.blocks_v2.chapters', 'Chapters')}
        width={340}
        trigger={
          <BlockToolbarButton label={t('editor.blocks_v2.chapters', 'Chapters')} active={chapters.length > 0}>
            <ListNumbers size={14} />
            {chapters.length ? <span className="tabular-nums">{chapters.length}</span> : null}
          </BlockToolbarButton>
        }
      >
        <p className="text-[11px] leading-snug text-neutral-400">
          {t('editor.blocks_v2.chapters_hint', 'Shown as segments on the player’s timeline.')}
        </p>
        <ChaptersEditor value={chapters} onCommit={(next) => updateAttributes({ chapters: next.length ? next : null })} />
      </BlockPopover>
      <BlockToolbarDivider />
      <BlockToolbarButton label={t('editor.blocks_v2.replace', 'Replace')} onClick={() => pickFile(acceptFor('video'), (f) => upload.start(f))}>
        <ArrowsClockwise size={14} />
      </BlockToolbarButton>
      <BlockToolbarButton label={t('editor.blocks.video_block.expand_video')} onClick={() => setIsModalOpen(true)}>
        <ArrowsOut size={14} />
      </BlockToolbarButton>
      {deleteButton}
    </>
  )

  return (
    <NodeViewWrapper className="block-video w-full">
      <BlockChrome tone="media" selected={props.selected} forceToolbar={!!openPopover} label={label} toolbar={toolbar} className="p-1">
        <div className="flex justify-center">
          <div style={{ maxWidth: VIDEO_SIZES[selectedSize].width, width: '100%' }}>
            <div className="relative w-full aspect-video rounded-xl overflow-hidden bg-black">
              <LearnHousePlayer {...playerProps} />
            </div>
            {upload.task && (
              <div className="mt-2">
                <MediaSourcePicker
                  kind="video"
                  icon={<VideoCamera size={18} />}
                  title=""
                  onFile={() => {}}
                  task={upload.task}
                  onCancel={upload.cancel}
                  onRetry={upload.retry}
                  onDismiss={upload.dismiss}
                />
              </div>
            )}
            {upload.rejection && (
              <p role="alert" className="mt-1 text-xs text-rose-600">
                {uploadErrorText(t, { code: upload.rejection.code, kind: 'video', fileSize: upload.rejection.fileSize })}
              </p>
            )}
            <BlockCaption
              value={caption}
              editable
              selected={props.selected}
              onCommit={(value) => updateAttributes({ caption: value })}
            />
          </div>
        </div>
      </BlockChrome>
      {playerModal}
    </NodeViewWrapper>
  )
}

export default VideoBlockComponent
