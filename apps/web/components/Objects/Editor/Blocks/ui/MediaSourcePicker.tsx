'use client'
/*
 The one empty state every upload block shares: drop a file, pick one from the
 device, import from a link, or reuse a file from the org Library. While an
 upload runs it turns into a progress row with Cancel; a failure shows the
 reason and Retry. Validation messages appear before anything is sent.
*/
import React from 'react'
import { useTranslation } from 'react-i18next'
import { Link as LinkIcon, UploadSimple, WarningCircle, X, ArrowClockwise } from '@phosphor-icons/react'
import { buttonClass } from '@components/Dashboard/Shared/DashKit/buttons'
import { cn } from '@/lib/utils'
import { MediaKind, acceptFor, formatBytes, formatHint } from '../media/mediaKinds'
import type { UploadTask } from '../media/uploadStore'
import { uploadErrorText } from '../media/uploadMessages'
import { BLOCK_TONE, FIELD_CLASS, type BlockTone } from './BlockChrome'
import { LibraryPickerButton } from './LibraryPicker'
import type { SelectedResource } from '@components/Dashboard/Library/ResourcePicker'

interface MediaSourcePickerProps {
  kind: MediaKind
  icon: React.ReactNode
  title: string
  onFile: (_file: File) => void
  /** Import from a link. Resolve to show nothing; throw/return a message to show it. */
  onUrl?: (_url: string) => Promise<string | void> | string | void
  urlPlaceholder?: string
  /** Reuse a file from the org Library (turns the block into a Library block). */
  onLibrarySelect?: (_resource: SelectedResource) => void
  /** Extra source buttons (e.g. the AI image generator). */
  extra?: React.ReactNode
  task?: UploadTask
  rejection?: { code: string; maxBytes?: number; fileSize?: number } | null
  onCancel?: () => void
  onRetry?: () => void
  onDismiss?: () => void
  className?: string
  tone?: BlockTone
}

export function MediaSourcePicker({
  kind,
  icon,
  title,
  onFile,
  onUrl,
  urlPlaceholder,
  onLibrarySelect,
  extra,
  task,
  rejection,
  onCancel,
  onRetry,
  onDismiss,
  className,
  tone = 'media',
}: MediaSourcePickerProps) {
  const { t } = useTranslation()
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = React.useState(false)
  const [urlMode, setUrlMode] = React.useState(false)
  const [url, setUrl] = React.useState('')
  const [urlBusy, setUrlBusy] = React.useState(false)
  const [urlError, setUrlError] = React.useState<string | null>(null)
  const hint = formatHint(kind)

  const pick = (files: FileList | null | undefined) => {
    const file = files?.[0]
    if (file) onFile(file)
  }

  const submitUrl = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!onUrl || !url.trim()) return
    setUrlBusy(true)
    setUrlError(null)
    try {
      const msg = await onUrl(url.trim())
      if (msg) setUrlError(msg)
      else {
        setUrl('')
        setUrlMode(false)
      }
    } catch (err: any) {
      setUrlError(err?.message || String(err))
    } finally {
      setUrlBusy(false)
    }
  }

  // ── Uploading / failed ──
  if (task) {
    const failed = task.status === 'error'
    const pct = Math.round(task.progress)
    return (
      <div
        contentEditable={false}
        className={cn(
          'flex items-center gap-3 rounded-xl bg-white p-3 shadow-[0_0_0_1px_var(--lhb-border,rgba(0,0,0,0.07))]',
          failed && 'bg-rose-50/60 shadow-[0_0_0_1px_rgba(225,29,72,0.2)]',
          className,
        )}
        aria-live="polite"
      >
        <div
          className={`flex h-11 w-11 flex-none items-center justify-center rounded-lg bg-cover bg-center ${BLOCK_TONE[tone].soft}`}
          style={task.previewUrl ? { backgroundImage: `url(${task.previewUrl})` } : undefined}
        >
          {!task.previewUrl && icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium text-neutral-900">{task.fileName}</div>
          {failed ? (
            <div className="mt-0.5 text-[11px] text-rose-700">
              {uploadErrorText(t, { code: task.errorCode, kind: task.kind, fileSize: task.fileSize, error: task.error })}
            </div>
          ) : (
            <>
              <div className="mt-0.5 text-[11px] tabular-nums text-neutral-500">
                {task.status === 'preparing'
                  ? t('editor.blocks_v2.preparing', 'Preparing…')
                  : task.status === 'processing'
                    ? t('editor.blocks_v2.processing', 'Finishing up…')
                    : t('editor.blocks_v2.progress', '{{percent}}% of {{size}}', { percent: pct, size: formatBytes(task.fileSize) })}
              </div>
              <div
                className="mt-1.5 h-1 overflow-hidden rounded-full bg-neutral-100"
                role="progressbar"
                aria-valuenow={pct}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  className={cn('h-full rounded-full bg-neutral-900 transition-[width] duration-200', task.status === 'processing' && 'animate-pulse')}
                  style={{ width: `${task.status === 'preparing' ? 2 : Math.max(2, pct)}%` }}
                />
              </div>
            </>
          )}
        </div>
        <div className="flex flex-none items-center gap-1">
          {failed && task.errorCode !== 'type' && task.errorCode !== 'size' && onRetry && (
            <button type="button" className={buttonClass('secondary', 'sm')} onClick={onRetry}>
              <ArrowClockwise size={13} />
              {t('editor.blocks_v2.retry', 'Retry')}
            </button>
          )}
          {failed ? (
            <button type="button" className={buttonClass('ghost', 'sm')} onClick={onDismiss}>
              {t('editor.blocks_v2.choose_another', 'Choose another')}
            </button>
          ) : (
            <button type="button" className={buttonClass('ghost', 'sm')} onClick={onCancel}>
              {t('editor.blocks.common.cancel', 'Cancel')}
            </button>
          )}
        </div>
      </div>
    )
  }

  // ── Empty ──
  return (
    <div
      contentEditable={false}
      data-lh-dropzone=""
      onDragEnter={(e) => {
        if (Array.from(e.dataTransfer.types).includes('Files')) {
          e.preventDefault()
          setDragging(true)
        }
      }}
      onDragOver={(e) => {
        if (Array.from(e.dataTransfer.types).includes('Files')) {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false)
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.files?.length) return
        e.preventDefault()
        e.stopPropagation()
        setDragging(false)
        pick(e.dataTransfer.files)
      }}
      className={cn(
        'rounded-xl border border-dashed px-4 py-4 transition-colors sm:px-5',
        dragging ? 'border-sky-400 bg-sky-50/60' : 'border-neutral-200 bg-neutral-50/60',
        className,
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept={acceptFor(kind)}
        className="hidden"
        onChange={(e) => {
          pick(e.target.files)
          e.target.value = ''
        }}
      />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span className={`flex h-10 w-10 flex-none items-center justify-center rounded-xl ${BLOCK_TONE[tone].soft}`}>
            {icon}
          </span>
          <div className="min-w-0">
            <div className="text-[13px] font-medium text-neutral-800">
              {dragging ? t('editor.blocks_v2.drop_to_upload', 'Drop to upload') : title}
            </div>
            <div className="text-[11px] text-neutral-400">
              {t('editor.blocks_v2.formats_hint', '{{formats}} · up to {{max}}', hint)}
            </div>
          </div>
        </div>
        {!urlMode && (
          <div className="flex flex-wrap items-center gap-1.5">
            <button type="button" className={buttonClass('primary', 'sm')} onClick={() => inputRef.current?.click()}>
              <UploadSimple size={13} weight="bold" />
              {t('editor.blocks.common.upload', 'Upload')}
            </button>
            {onUrl && (
              <button type="button" className={buttonClass('secondary', 'sm')} onClick={() => setUrlMode(true)}>
                <LinkIcon size={13} />
                {t('editor.blocks_v2.from_link', 'Link')}
              </button>
            )}
            {onLibrarySelect && <LibraryPickerButton onSelect={onLibrarySelect} />}
            {extra}
          </div>
        )}
      </div>

      {urlMode && (
        <form onSubmit={submitUrl} className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            autoFocus
            type="url"
            inputMode="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Escape') setUrlMode(false)
            }}
            placeholder={urlPlaceholder || t('editor.blocks_v2.paste_link', 'Paste a link…')}
            aria-label={t('editor.blocks_v2.paste_link', 'Paste a link…')}
            className={cn(FIELD_CLASS, 'flex-1')}
          />
          <div className="flex items-center gap-1.5">
            <button type="submit" disabled={!url.trim() || urlBusy} className={buttonClass('primary', 'sm')}>
              {urlBusy ? t('editor.blocks_v2.importing', 'Importing…') : t('editor.blocks_v2.import', 'Import')}
            </button>
            <button type="button" className={buttonClass('ghost', 'sm')} onClick={() => { setUrlMode(false); setUrlError(null) }}>
              {t('editor.blocks.common.cancel', 'Cancel')}
            </button>
          </div>
        </form>
      )}

      {(rejection || urlError) && (
        <div role="alert" className="mt-3 flex items-start gap-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">
          <WarningCircle size={14} weight="fill" className="mt-px flex-none" />
          <span className="flex-1">
            {urlError || uploadErrorText(t, { code: rejection?.code, kind, fileSize: rejection?.fileSize, maxBytes: rejection?.maxBytes })}
          </span>
          {onDismiss && (
            <button type="button" aria-label={t('common.close', 'Close')} onClick={() => { setUrlError(null); onDismiss() }} className="text-rose-400 hover:text-rose-700">
              <X size={12} />
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export default MediaSourcePicker
