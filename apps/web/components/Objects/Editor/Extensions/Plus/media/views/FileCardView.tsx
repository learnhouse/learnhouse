'use client'
/*
 File card: a download card with an icon per file type, the name, type and
 size, and an optional line of description. Files go through the existing
 block upload endpoints (PDF, image, audio, video, same storage as those
 blocks); any other file is linked by URL.
*/
import React from 'react'
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import {
  ArrowsClockwise,
  DownloadSimple,
  File as FileIcon,
  FileAudio,
  FileCode,
  FileDoc,
  FileImage,
  FilePdf,
  FilePpt,
  FileText,
  FileVideo,
  FileXls,
  FileZip,
  LinkSimple,
  Paperclip,
} from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import EditorBlockFrame from '../../../../Blocks/ui/EditorBlockFrame'
import { BlockPopover, BlockToolbarButton, CommitInput, SettingsField } from '../../../../Blocks/ui/BlockChrome'
import MediaSourcePicker from '../../../../Blocks/ui/MediaSourcePicker'
import { acceptFor, kindForFile } from '../../../../Blocks/media/mediaKinds'
import { uploadErrorText } from '../../../../Blocks/media/uploadMessages'
import { normalizeUserUrl } from '../../../../Blocks/embeds/embedProviders'
import { cn } from '@/lib/utils'
import { blockObjectOf, fileNameFromUrl, fileTypeOf, fileTypeValue, formatFileSize, safeUrl, type FileType } from '../mediaModel'
import { activityOf, commitAttrs, DropZone, InlineInput, pickFiles, useAccessToken, useIsEditable, useMediaUrl, useUploads } from './shared'

const ICONS: Record<FileType, React.ElementType> = {
  pdf: FilePdf,
  doc: FileDoc,
  sheet: FileXls,
  slides: FilePpt,
  archive: FileZip,
  image: FileImage,
  audio: FileAudio,
  video: FileVideo,
  text: FileText,
  code: FileCode,
  file: FileIcon,
}

const TILE: Record<FileType, string> = {
  pdf: 'bg-rose-50 text-rose-600',
  doc: 'bg-blue-50 text-blue-600',
  sheet: 'bg-green-50 text-green-700',
  slides: 'bg-orange-50 text-orange-600',
  archive: 'bg-amber-50 text-amber-700',
  image: 'bg-violet-50 text-violet-600',
  audio: 'bg-fuchsia-50 text-fuchsia-600',
  video: 'bg-sky-50 text-sky-600',
  text: 'bg-neutral-100 text-neutral-600',
  code: 'bg-slate-100 text-slate-700',
  file: 'bg-neutral-100 text-neutral-600',
}

const ACCEPT = ['pdf', 'image', 'audio', 'video'].map((k) => acceptFor(k as any)).join(',')

export default function FileCardView(props: NodeViewProps) {
  const { t, i18n } = useTranslation()
  const isEditable = useIsEditable()
  const { node } = props
  const activity = activityOf(props)
  const mediaUrl = useMediaUrl(activity)
  const uploads = useUploads({ activityUuid: activity?.activity_uuid, accessToken: useAccessToken() })
  const [linkOpen, setLinkOpen] = React.useState(false)
  const [typeError, setTypeError] = React.useState<string | null>(null)

  const attrs = node.attrs
  const href = mediaUrl({ blockObject: attrs.blockObject, url: attrs.url })
  const hasFile = !!(blockObjectOf(attrs.blockObject) || safeUrl(attrs.url))
  const name = String(attrs.name || '').trim()
  const type = fileTypeValue(attrs.fileType) ?? fileTypeOf(name || attrs.url || '')
  const typeLabel = t(`activities.file_card.types.${type}`, type.toUpperCase())
  const size = formatFileSize(attrs.sizeBytes, i18n.language)
  const meta = [typeLabel, size].filter(Boolean).join(' · ')
  const Icon = ICONS[type]
  const task = uploads.tasks[0]

  const upload = (file: File) => {
    const kind = kindForFile(file)
    if (!kind) {
      setTypeError(t('editor.blocks_v2.file_card.type_error', 'This type of file can’t be uploaded. Upload a PDF, image, audio or video file, or link to the file instead.'))
      return
    }
    setTypeError(null)
    uploads.start(file, kind, (blockObject, f) =>
      commitAttrs(props, (live) => ({
        blockObject,
        url: null,
        name: String(live.name || '').trim() || f.name.slice(0, 200),
        sizeBytes: f.size,
        fileType: fileTypeOf(f.name),
      })),
    )
  }

  const setLink = (input: string): string | void => {
    const url = safeUrl(normalizeUserUrl(input) || input)
    if (!url) return uploadErrorText(t, { code: 'url' })
    commitAttrs(props, (live) => ({
      blockObject: null,
      url,
      name: String(live.name || '').trim() || fileNameFromUrl(url) || url,
      sizeBytes: null,
      fileType: fileTypeOf(fileNameFromUrl(url)),
    }))
  }

  const label = (
    <>
      <Paperclip size={11} weight="bold" />
      {t('editor.blocks_v2.file_card.label', 'File')}
    </>
  )

  // ── Editor, no file yet ──
  if (!hasFile) {
    if (!isEditable) return null
    const rejection = uploads.rejections[uploads.rejections.length - 1]
    return (
      <NodeViewWrapper className="lh-file-card my-4">
        <EditorBlockFrame editable node={node} editor={props.editor} getPos={props.getPos} selected={props.selected} tone="document" label={label}>
          {task ? (
            <MediaSourcePicker kind={task.kind} tone="document" icon={<Paperclip size={18} />} title="" onFile={() => {}} task={task} onCancel={() => uploads.cancel(task.id)} onRetry={() => uploads.retry(task.id)} onDismiss={() => uploads.dismiss(task.id)} />
          ) : (
            <DropZone
              icon={<Paperclip size={20} weight="duotone" />}
              title={t('editor.blocks_v2.file_card.empty_title', 'Add a file to download')}
              hint={t('editor.blocks_v2.file_card.empty_hint', 'Upload a PDF, image, audio or video file, or link to any file.')}
              actionLabel={t('editor.blocks_v2.file_card.upload', 'Upload a file')}
              accept={ACCEPT}
              onFiles={(files) => upload(files[0])}
              onUrl={setLink}
              linkLabel={t('editor.blocks_v2.from_link', 'From a link')}
              addLabel={t('editor.blocks_v2.file_card.add_link', 'Add link')}
            >
              {(typeError || rejection) && (
                <p role="alert" className="m-0 text-xs text-rose-600">
                  {typeError ?? uploadErrorText(t, { code: rejection!.code, kind: kindForFile({ name: rejection!.fileName, type: '', size: rejection!.fileSize }), fileSize: rejection!.fileSize, maxBytes: rejection!.maxBytes })}
                </p>
              )}
            </DropZone>
          )}
        </EditorBlockFrame>
      </NodeViewWrapper>
    )
  }

  const tools = (
    <>
      <BlockToolbarButton label={t('editor.blocks_v2.replace', 'Replace')} onClick={() => pickFiles(ACCEPT, false, (files) => upload(files[0]))}>
        <ArrowsClockwise size={14} />
      </BlockToolbarButton>
      <BlockPopover
        open={linkOpen}
        onOpenChange={setLinkOpen}
        title={t('editor.blocks_v2.link', 'Link')}
        trigger={
          <BlockToolbarButton label={t('editor.blocks_v2.file_card.link_settings', 'File link')} active={linkOpen}>
            <LinkSimple size={14} />
          </BlockToolbarButton>
        }
      >
        <SettingsField label={t('editor.blocks_v2.file_card.link_label', 'Link to the file')} hint={t('editor.blocks_v2.file_card.link_hint', 'Replaces the uploaded file, if there is one.')}>
          <CommitInput type="url" value={safeUrl(attrs.url) ?? ''} placeholder="https://" aria-label={t('editor.blocks_v2.file_card.link_label', 'Link to the file')} onCommit={(v) => v.trim() && setLink(v)} />
        </SettingsField>
      </BlockPopover>
    </>
  )

  const field = 'w-full min-w-0 bg-transparent outline-none placeholder:text-neutral-400'
  const fallbackName = t('editor.blocks_v2.file_card.label', 'File')

  return (
    <NodeViewWrapper className="lh-file-card my-4" data-file-type={type}>
      <EditorBlockFrame editable={isEditable} node={node} editor={props.editor} getPos={props.getPos} selected={props.selected} tone="document" label={label} tools={tools} forceToolbar={linkOpen}>
        <div className="flex items-center gap-3.5 rounded-2xl bg-white p-3.5 ring-1 ring-inset ring-neutral-200/80 sm:p-4">
          <span className={cn('flex h-12 w-12 flex-none items-center justify-center rounded-xl', TILE[type])} aria-hidden>
            <Icon size={24} weight="duotone" />
          </span>
          <div className="min-w-0 flex-1">
            {isEditable ? (
              <>
                <InlineInput value={name} maxLength={200} onCommit={(v) => commitAttrs(props, { name: v.trim() })} placeholder={fallbackName} aria-label={t('editor.blocks_v2.file_card.name', 'File name')} className={cn(field, 'text-[15px] font-semibold text-neutral-900')} />
                <div className="text-[12px] text-neutral-500">{meta}</div>
                <InlineInput value={String(attrs.description || '')} maxLength={300} onCommit={(v) => commitAttrs(props, { description: v.trim() || null })} placeholder={t('editor.blocks_v2.file_card.description_placeholder', 'What’s in this file? (optional)')} aria-label={t('editor.blocks_v2.file_card.description', 'Description')} className={cn(field, 'mt-0.5 text-[13px] text-neutral-600')} />
              </>
            ) : (
              <>
                <div className="truncate text-[15px] font-semibold text-neutral-900">{name || fallbackName}</div>
                <div className="text-[12px] text-neutral-500">{meta}</div>
                {attrs.description && <p className="m-0 mt-0.5 text-[13px] leading-snug text-neutral-600">{String(attrs.description)}</p>}
              </>
            )}
            {task && <div className="mt-2"><MediaSourcePicker kind={task.kind} tone="document" icon={<Paperclip size={18} />} title="" onFile={() => {}} task={task} onCancel={() => uploads.cancel(task.id)} onRetry={() => uploads.retry(task.id)} onDismiss={() => uploads.dismiss(task.id)} /></div>}
            {typeError && <p role="alert" className="m-0 mt-1 text-xs text-rose-600">{typeError}</p>}
          </div>
          {href && (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              download={blockObjectOf(attrs.blockObject) ? name || true : undefined}
              contentEditable={false}
              aria-label={t('activities.file_card.download_named', 'Download {{name}}', { name: name || fallbackName })}
              className="inline-flex h-9 flex-none items-center gap-1.5 rounded-xl bg-neutral-900 px-3 text-[13px] font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_1px_1px_rgba(0,0,0,0.08)] transition-colors hover:bg-neutral-800 lh-t-btn max-sm:w-9 max-sm:justify-center max-sm:px-0"
            >
              <DownloadSimple size={15} weight="bold" />
              <span className="max-sm:sr-only">{t('activities.file_card.download', 'Download')}</span>
            </a>
          )}
        </div>
      </EditorBlockFrame>
    </NodeViewWrapper>
  )
}
