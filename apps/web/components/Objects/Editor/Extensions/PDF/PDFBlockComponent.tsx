import { NodeViewProps, NodeViewWrapper } from '@tiptap/react'
import React from 'react'
import { FileText, DownloadSimple, ArrowsOut, DotsSix, ArrowsClockwise, ArrowsVertical, Trash } from '@phosphor-icons/react'
import { getActivityBlockMediaDirectory } from '@services/media/media'
import { useOrg } from '@components/Contexts/OrgContext'
import { useCourse } from '@components/Contexts/CourseContext'
import { useEditorProvider } from '@components/Contexts/Editor/EditorContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import { useTranslation } from 'react-i18next'
import { BlockChrome, BlockPopover, BlockToolbarButton, BlockToolbarDivider, Segmented } from '../../Blocks/ui/BlockChrome'
import BlockCaption from '../../Blocks/ui/BlockCaption'
import MediaSourcePicker from '../../Blocks/ui/MediaSourcePicker'
import { useBlockUpload } from '../../Blocks/media/useBlockUpload'
import { acceptFor } from '../../Blocks/media/mediaKinds'
import { fetchRemoteFile, UrlImportError } from '../../Blocks/media/urlImport'
import { normalizeUserUrl } from '../../Blocks/embeds/embedProviders'
import { libraryMediaNodeAttrs } from '../../Blocks/media/librarySnapshot'
import { uploadErrorText } from '../../Blocks/media/uploadMessages'
import { deleteBlock, pickFile, replaceBlock } from '../../Blocks/nodeViewUtils'
import { PDF_HEIGHT_PRESETS } from '../../Blocks/schema/blockAttrs'

// Same reading size the PDF activity uses, capped to the viewport so the whole
// page fits on a laptop. Authors can drag it taller or shorter per block.
const DEFAULT_PDF_HEIGHT = 'min(80vh, 900px)'
const MIN_PDF_HEIGHT = 200
const MAX_PDF_HEIGHT = 2000

function PDFBlockComponent(props: NodeViewProps) {
  const { t } = useTranslation()
  const org = useOrg() as any
  const course = useCourse() as any
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const editorState = useEditorProvider() as any
  const isEditable = editorState.isEditable
  const activity = (props.extension.options as any).activity

  // Read from the node, not local state, so undo and collaborators' edits show.
  const blockObject = props.node.attrs.blockObject
  const pdfHeight: number | null = props.node.attrs.pdfHeight ?? null
  const caption: string = props.node.attrs.caption || ''
  const [isModalOpen, setIsModalOpen] = React.useState(false)
  const [heightOpen, setHeightOpen] = React.useState(false)
  const [isResizing, setIsResizing] = React.useState(false)
  const frameRef = React.useRef<HTMLDivElement>(null)

  const upload = useBlockUpload({
    kind: 'pdf',
    activityUuid: activity?.activity_uuid,
    accessToken: access_token,
    onUploaded: (object) => props.updateAttributes({ blockObject: object }),
  })

  const fileId = blockObject?.content ? `${blockObject.content.file_id}.${blockObject.content.file_format}` : null
  const pdfUrl = blockObject?.content
    ? getActivityBlockMediaDirectory(
        org?.org_uuid,
        course?.courseStructure?.course_uuid,
        blockObject.content.activity_uuid || activity?.activity_uuid,
        blockObject.block_uuid,
        fileId || '',
        'pdfBlock'
      )
    : null

  const handleDownload = () => {
    if (!pdfUrl) return
    const link = document.createElement('a')
    link.href = pdfUrl
    link.download = `document-${blockObject?.block_uuid || 'download'}.${blockObject?.content.file_format || 'pdf'}`
    link.setAttribute('download', '')
    link.setAttribute('target', '_blank')
    link.setAttribute('rel', 'noopener noreferrer')
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  // Pointer capture keeps the drag on the handle even when the cursor crosses
  // an iframe (this PDF or another block's), which would otherwise swallow
  // pointerup and leave the drag stuck.
  const handleResizeStart = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    const handle = event.currentTarget
    const pointerId = event.pointerId
    const startY = event.clientY
    const startHeight = frameRef.current?.offsetHeight || 0
    let height = startHeight
    handle.setPointerCapture(pointerId)
    setIsResizing(true)
    const handleMove = (e: PointerEvent) => {
      height = Math.min(MAX_PDF_HEIGHT, Math.max(MIN_PDF_HEIGHT, startHeight + e.clientY - startY))
      if (frameRef.current) frameRef.current.style.height = `${height}px`
    }
    const handleEnd = () => {
      handle.removeEventListener('pointermove', handleMove)
      handle.removeEventListener('pointerup', handleEnd)
      handle.removeEventListener('pointercancel', handleEnd)
      if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId)
      setIsResizing(false)
      if (height !== startHeight) props.updateAttributes({ pdfHeight: height })
    }
    handle.addEventListener('pointermove', handleMove)
    handle.addEventListener('pointerup', handleEnd)
    handle.addEventListener('pointercancel', handleEnd)
  }

  const frameStyle = { height: pdfHeight ? `${pdfHeight}px` : DEFAULT_PDF_HEIGHT }

  const documentModal = pdfUrl ? (
    <Modal
      isDialogOpen={isModalOpen}
      onOpenChange={setIsModalOpen}
      dialogTitle={caption || t('editor.blocks.pdf_block.document_title')}
      minWidth="xl"
      minHeight="xl"
      dialogContent={
        <div className="w-full h-[80vh]">
          <iframe
            className="w-full h-full rounded-lg shadow-lg border"
            src={pdfUrl}
            title={t('editor.blocks.pdf_block.document_title')}
          />
        </div>
      }
    />
  ) : null

  // ─── Learner view ───
  if (!isEditable && !blockObject) {
    return (
      <NodeViewWrapper className="block-pdf">
        <div data-lhb-panel="" className="bg-neutral-50 rounded-xl px-5 py-4 nice-shadow">
          <div className="flex items-center justify-center gap-3 py-8 bg-white rounded-lg nice-shadow">
            <FileText weight="duotone" className="text-neutral-300" size={32} />
            <p className="text-neutral-500">{t('editor.blocks.pdf_block.no_pdf')}</p>
          </div>
        </div>
      </NodeViewWrapper>
    )
  }

  if (!isEditable) {
    if (!pdfUrl) return null
    return (
      <>
        <NodeViewWrapper className="block-pdf">
          <div className="relative group">
            <iframe
              style={frameStyle}
              className="w-full rounded-lg nice-shadow bg-white"
              src={pdfUrl}
              title={caption || t('editor.blocks.pdf_block.document_title')}
            />
            <div className="absolute top-2 end-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={() => setIsModalOpen(true)}
                className="p-2 outline-none bg-black/50 hover:bg-black/70 rounded-lg transition-colors"
                title={t('editor.blocks.pdf_block.expand_pdf')}
              >
                <ArrowsOut weight="duotone" className="w-4 h-4 text-white" />
              </button>
              <button
                onClick={handleDownload}
                className="p-2 outline-none bg-black/50 hover:bg-black/70 rounded-lg transition-colors"
                title={t('editor.blocks.pdf_block.download_pdf')}
              >
                <DownloadSimple weight="duotone" className="w-4 h-4 text-white" />
              </button>
            </div>
          </div>
          <BlockCaption value={caption} editable={false} />
        </NodeViewWrapper>
        {documentModal}
      </>
    )
  }

  const label = <><FileText size={11} weight="bold" />{t('editor.blocks.pdf')}</>
  const deleteButton = (
    <BlockToolbarButton label={t('common.delete', 'Delete')} tone="danger" onClick={() => deleteBlock(props)}>
      <Trash size={14} />
    </BlockToolbarButton>
  )

  // ─── Editor: empty ───
  if (!blockObject || !pdfUrl) {
    const importFromUrl = async (input: string): Promise<string | void> => {
      const url = normalizeUserUrl(input)
      if (!url) return uploadErrorText(t, { code: 'url' })
      try {
        upload.start(await fetchRemoteFile(url, 'pdf'))
      } catch (err) {
        if (err instanceof UrlImportError) return uploadErrorText(t, { code: err.code, kind: 'pdf', error: err.message })
        return uploadErrorText(t, { code: 'server', error: (err as any)?.message })
      }
    }
    return (
      <NodeViewWrapper className="block-pdf">
        <BlockChrome tone="document" selected={props.selected} label={label} toolbar={deleteButton}>
          <MediaSourcePicker
            kind="pdf" tone="document"
            icon={<FileText size={20} weight="duotone" />}
            title={t('editor.blocks_v2.pdf_title', 'Add a PDF')}
            onFile={(f) => upload.start(f)}
            onUrl={importFromUrl}
            urlPlaceholder={t('editor.blocks_v2.pdf_link_placeholder', 'Paste a link to a PDF…')}
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

  // ─── Editor: document ───
  const heightPreset = PDF_HEIGHT_PRESETS.find((p) => p.height === pdfHeight)?.id ?? (pdfHeight ? null : 'auto')
  const toolbar = (
    <>
      <BlockPopover
        open={heightOpen}
        onOpenChange={setHeightOpen}
        title={t('editor.blocks_v2.preview_height', 'Preview height')}
        width={300}
        trigger={<BlockToolbarButton label={t('editor.blocks_v2.preview_height', 'Preview height')}><ArrowsVertical size={14} /></BlockToolbarButton>}
      >
        <Segmented
          ariaLabel={t('editor.blocks_v2.preview_height', 'Preview height')}
          value={heightPreset}
          onChange={(id) => props.updateAttributes({ pdfHeight: PDF_HEIGHT_PRESETS.find((p) => p.id === id)?.height ?? null })}
          options={[
            { value: 'auto', label: t('editor.blocks_v2.height_auto', 'Fit') },
            { value: 'short', label: t('editor.blocks_v2.height_short', 'Short') },
            { value: 'medium', label: t('editor.blocks.common.medium', 'Medium') },
            { value: 'tall', label: t('editor.blocks_v2.height_tall', 'Tall') },
          ]}
        />
        <p className="text-[11px] text-neutral-400">{t('editor.blocks_v2.pdf_drag_hint', 'Or drag the bar under the document.')}</p>
      </BlockPopover>
      <BlockToolbarDivider />
      <BlockToolbarButton label={t('editor.blocks_v2.replace', 'Replace')} onClick={() => pickFile(acceptFor('pdf'), (f) => upload.start(f))}>
        <ArrowsClockwise size={14} />
      </BlockToolbarButton>
      <BlockToolbarButton label={t('editor.blocks.pdf_block.expand_pdf')} onClick={() => setIsModalOpen(true)}>
        <ArrowsOut size={14} />
      </BlockToolbarButton>
      <BlockToolbarButton label={t('editor.blocks.pdf_block.download_pdf')} onClick={handleDownload}>
        <DownloadSimple size={14} />
      </BlockToolbarButton>
      {deleteButton}
    </>
  )

  return (
    <>
      <NodeViewWrapper className="block-pdf">
        <BlockChrome tone="document" selected={props.selected} forceToolbar={heightOpen} label={label} toolbar={toolbar} className="p-1">
          <div ref={frameRef} className="relative" style={frameStyle}>
            {/* Inline height: the editor's global `iframe { height: 440px }` outranks h-full. */}
            <iframe
              style={{ height: '100%' }}
              className={`w-full rounded-lg nice-shadow bg-white ${isResizing ? 'pointer-events-none' : ''}`}
              src={pdfUrl}
              title={t('editor.blocks.pdf_block.document_title')}
            />
            <div
              className="absolute start-0 end-0 bottom-0 h-4 cursor-ns-resize touch-none flex items-center justify-center bg-white/70 hover:bg-white/90 rounded-b-lg transition-opacity"
              onPointerDown={handleResizeStart}
              title={t('editor.blocks.pdf_block.resize_pdf')}
            >
              <DotsSix weight="duotone" size={16} className="text-neutral-500" />
            </div>
          </div>
          {upload.task && (
            <div className="mt-2">
              <MediaSourcePicker kind="pdf" tone="document" icon={<FileText size={18} />} title="" onFile={() => {}} task={upload.task} onCancel={upload.cancel} onRetry={upload.retry} onDismiss={upload.dismiss} />
            </div>
          )}
          {upload.rejection && (
            <p role="alert" className="mt-1 text-xs text-rose-600">
              {uploadErrorText(t, { code: upload.rejection.code, kind: 'pdf', fileSize: upload.rejection.fileSize })}
            </p>
          )}
          <BlockCaption value={caption} editable selected={props.selected} onCommit={(value) => props.updateAttributes({ caption: value })} />
        </BlockChrome>
      </NodeViewWrapper>
      {documentModal}
    </>
  )
}

export default PDFBlockComponent
