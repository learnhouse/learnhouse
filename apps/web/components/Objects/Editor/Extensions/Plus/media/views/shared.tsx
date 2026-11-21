'use client'
/*
 Small pieces the media node views share: live-attr commits, media URLs
 (same storage and URL scheme as blockImage), multi-file uploads through the
 existing upload store, and a few UI bits.
*/
import React from 'react'
import type { NodeViewProps } from '@tiptap/react'
import { LinkSimple, UploadSimple } from '@phosphor-icons/react'
import { buttonClass } from '@components/Dashboard/Shared/DashKit/buttons'
import { getActivityBlockMediaDirectory } from '@services/media/media'
import { useOrg } from '@components/Contexts/OrgContext'
import { CourseContext } from '@components/Contexts/CourseContext'
import { useEditorProvider } from '@components/Contexts/Editor/EditorContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { cancelUpload, discardUpload, getUploadTask, retryUpload, startUpload, subscribeUploads, type UploadTask } from '../../../../Blocks/media/uploadStore'
import { validateFile, type MediaKind } from '../../../../Blocks/media/mediaKinds'
import { blockDirectory, blockFileName, blockObjectOf, safeUrl } from '../mediaModel'

type LiveProps = Pick<NodeViewProps, 'editor' | 'getPos' | 'node'>

/** Whether the node view sits in a real editor (false in StaticCanva / @learnhouse/react). */
export const hasLiveDoc = (editor: NodeViewProps['editor']) => !!(editor as any)?.view?.dom

/** The node's attrs as they are in the document now (collaborators' writes included). */
export function liveAttrs(props: LiveProps): Record<string, any> | null {
  const pos = typeof props.getPos === 'function' ? props.getPos() : undefined
  if (typeof pos !== 'number' || !hasLiveDoc(props.editor)) return null
  const node = props.editor.state.doc.nodeAt(pos)
  return node && node.type === props.node.type ? node.attrs : null
}

/**
 * Merge attrs into the live node in one transaction. `patch` may be a
 * function of the live attrs, so list edits apply to the latest list.
 */
export function commitAttrs(props: LiveProps, patch: Record<string, unknown> | ((_live: Record<string, any>) => Record<string, unknown> | null)) {
  const pos = typeof props.getPos === 'function' ? props.getPos() : undefined
  if (typeof pos !== 'number' || !hasLiveDoc(props.editor)) return false
  const node = props.editor.state.doc.nodeAt(pos)
  if (!node || node.type !== props.node.type) return false
  const next = typeof patch === 'function' ? patch(node.attrs) : patch
  if (!next || !Object.entries(next).some(([k, v]) => node.attrs[k] !== v)) return false
  props.editor.view.dispatch(props.editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...next }))
  return true
}

export function useIsEditable(): boolean {
  return !!(useEditorProvider() as any)?.isEditable
}

/** The activity the block belongs to (extension options, as for blockImage). */
export const activityOf = (props: Pick<NodeViewProps, 'extension'>) => (props.extension?.options as any)?.activity ?? null

/** Builds the URL of an uploaded block file, or returns the stored link. */
export function useMediaUrl(activity: any): (_src: { blockObject?: any; url?: string | null } | null | undefined) => string | null {
  const org = useOrg() as any
  // Read the context directly: outside a course page (previews, embeds) there is none, and that's fine.
  const course = React.useContext(CourseContext) as any
  const orgUuid = org?.org_uuid
  const courseUuid = course?.courseStructure?.course_uuid
  const activityUuid = activity?.activity_uuid
  return React.useCallback(
    (src) => {
      if (!src) return null
      const block = blockObjectOf(src.blockObject)
      if (block) {
        const url = getActivityBlockMediaDirectory(orgUuid, courseUuid, block.content.activity_uuid || activityUuid, block.block_uuid, blockFileName(block), blockDirectory(block))
        if (url) return url
      }
      return safeUrl(src.url)
    },
    [orgUuid, courseUuid, activityUuid],
  )
}

export function useAccessToken(): string | undefined {
  const session = useLHSession() as any
  return session?.data?.tokens?.access_token
}

export interface UploadRejection {
  fileName: string
  code: string
  maxBytes?: number
  fileSize: number
}

/**
 * Several uploads at once through the shared upload store (the same
 * endpoints and progress UI as the single-file blocks). Progress stays local;
 * `onDone` writes the final blockObject into the document once per file.
 */
export function useUploads({ activityUuid, accessToken }: { activityUuid: string | undefined; accessToken: string | undefined }) {
  const [ids, setIds] = React.useState<string[]>([])
  const [rejections, setRejections] = React.useState<UploadRejection[]>([])
  const tokenRef = React.useRef(accessToken)
  const idsRef = React.useRef(ids)
  React.useEffect(() => {
    tokenRef.current = accessToken
    idsRef.current = ids
  })
  React.useEffect(() => () => idsRef.current.forEach((id) => discardUpload(id)), [])

  const snapshot = React.useRef<{ key: string; tasks: UploadTask[] }>({ key: '', tasks: [] })
  const getTasks = React.useCallback(() => {
    const tasks = ids.map((id) => getUploadTask(id)).filter(Boolean) as UploadTask[]
    const key = tasks.map((t) => `${t.id}:${t.status}:${t.progress}:${t.errorCode ?? ''}`).join('|')
    // Same tasks, same array: useSyncExternalStore needs a stable snapshot.
    if (key !== snapshot.current.key) snapshot.current = { key, tasks }
    return snapshot.current.tasks
  }, [ids])
  const getServerTasks = React.useCallback(() => snapshot.current.tasks, [])
  const tasks = React.useSyncExternalStore(subscribeUploads, getTasks, getServerTasks)

  const start = React.useCallback(
    (file: File, kind: MediaKind, onDone: (_blockObject: any, _file: File) => void): boolean => {
      const check = validateFile(file, kind)
      if (!check.ok && !(kind === 'image' && check.code === 'size')) {
        setRejections((r) => [...r.slice(-3), { fileName: file.name, code: check.code, maxBytes: check.maxBytes, fileSize: file.size }])
        return false
      }
      if (!activityUuid) return false
      const id = startUpload({
        kind,
        file,
        activityUuid,
        getToken: () => tokenRef.current,
        onDone: (result) => {
          onDone(result, file)
          discardUpload(id)
          setIds((cur) => cur.filter((x) => x !== id))
        },
      })
      setIds((cur) => [...cur, id])
      return true
    },
    [activityUuid],
  )

  const dismiss = React.useCallback((id: string) => {
    discardUpload(id)
    setIds((cur) => cur.filter((x) => x !== id))
  }, [])

  const cancel = React.useCallback((id: string) => {
    cancelUpload(id)
    discardUpload(id)
    setIds((cur) => cur.filter((x) => x !== id))
  }, [])

  const retry = React.useCallback((id: string) => retryUpload(id), [])

  const clearRejections = React.useCallback(() => setRejections([]), [])

  return { tasks, start, dismiss, cancel, retry, rejections, clearRejections }
}

/** Open the file picker for one or more files. */
export function pickFiles(accept: string, multiple: boolean, onFiles: (_files: File[]) => void) {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = accept
  input.multiple = multiple
  input.onchange = () => {
    const files = Array.from(input.files ?? [])
    if (files.length) onFiles(files)
  }
  input.click()
}

export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

/** Live reduced-motion preference (false on the server). */
export function useReducedMotion(): boolean {
  return React.useSyncExternalStore(
    (cb) => {
      try {
        const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
        mq.addEventListener?.('change', cb)
        return () => mq.removeEventListener?.('change', cb)
      } catch {
        return () => {}
      }
    },
    prefersReducedMotion,
    () => false,
  )
}

/** The element's content width, kept up to date (fallback until measured). */
export function useElementWidth<T extends HTMLElement>(fallback: number): [React.RefObject<T | null>, number] {
  const ref = React.useRef<T | null>(null)
  const [width, setWidth] = React.useState(fallback)
  React.useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const read = () => {
      const w = Math.round(el.getBoundingClientRect().width)
      if (w > 0) setWidth((cur) => (Math.abs(cur - w) > 1 ? w : cur))
    }
    read()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width]
}

/** A text field that keeps a draft while focused and commits on blur / Enter. */
export function InlineInput({
  value,
  onCommit,
  className,
  multiline,
  maxLength = 300,
  ...rest
}: {
  value: string
  onCommit: (_v: string) => void
  className?: string
  multiline?: boolean
  maxLength?: number
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'maxLength'>) {
  const [draft, setDraft] = React.useState(value)
  const typing = React.useRef(false)
  React.useEffect(() => {
    if (!typing.current) setDraft(value)
  }, [value])
  const commit = () => {
    typing.current = false
    const next = draft.slice(0, maxLength)
    if (next !== value) onCommit(next)
  }
  const common = {
    value: draft,
    className,
    placeholder: rest.placeholder,
    'aria-label': rest['aria-label'],
    onFocus: () => (typing.current = true),
    onBlur: commit,
  }
  if (multiline) {
    return (
      <textarea
        {...common}
        rows={2}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Escape') {
            setDraft(value)
            ;(e.target as HTMLTextAreaElement).blur()
          }
        }}
      />
    )
  }
  return (
    <input
      {...rest}
      {...common}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter' || e.key === 'Escape') {
          e.preventDefault()
          if (e.key === 'Escape') setDraft(value)
          ;(e.target as HTMLInputElement).blur()
        }
      }}
    />
  )
}

/** A labelled switch row for settings popovers. */
export function SwitchRow({ label, checked, onChange, disabled }: { label: React.ReactNode; checked: boolean; onChange: (_v: boolean) => void; disabled?: boolean }) {
  return (
    <label className={`flex items-center justify-between gap-3 text-xs font-medium text-neutral-600 ${disabled ? 'opacity-50' : ''}`}>
      <span>{label}</span>
      <input type="checkbox" disabled={disabled} className="h-3.5 w-3.5 accent-neutral-900" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  )
}

/** Soft surface and ink per stat tone (palette classes, so dark mode and block themes remap them). */
export const STAT_TONE_CLASSES: Record<string, { card: string; value: string; dot: string }> = {
  neutral: { card: 'bg-neutral-50 ring-neutral-200/70', value: 'text-neutral-900', dot: 'bg-neutral-700' },
  blue: { card: 'bg-blue-50/70 ring-blue-200/60', value: 'text-blue-700', dot: 'bg-blue-600' },
  teal: { card: 'bg-teal-50/70 ring-teal-200/60', value: 'text-teal-700', dot: 'bg-teal-600' },
  green: { card: 'bg-green-50/70 ring-green-200/60', value: 'text-green-700', dot: 'bg-green-600' },
  amber: { card: 'bg-amber-50/70 ring-amber-200/60', value: 'text-amber-700', dot: 'bg-amber-500' },
  rose: { card: 'bg-rose-50/70 ring-rose-200/60', value: 'text-rose-700', dot: 'bg-rose-600' },
}

/**
 * The empty state of the multi-file blocks (gallery, file card): drop files,
 * pick them, or paste a link. Same look as MediaSourcePicker.
 */
export function DropZone({
  icon,
  title,
  hint,
  actionLabel,
  accept,
  multiple,
  onFiles,
  onUrl,
  urlPlaceholder,
  linkLabel,
  addLabel,
  className,
  children,
}: {
  icon: React.ReactNode
  title: string
  hint?: React.ReactNode
  actionLabel: string
  accept: string
  multiple?: boolean
  onFiles: (_files: File[]) => void
  /** Add from a link; return an error message to show it. */
  onUrl?: (_url: string) => string | void
  urlPlaceholder?: string
  linkLabel?: string
  addLabel?: string
  className?: string
  children?: React.ReactNode
}) {
  const [dragging, setDragging] = React.useState(false)
  const [urlMode, setUrlMode] = React.useState(false)
  const [url, setUrl] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!onUrl || !url.trim()) return
    const msg = onUrl(url.trim())
    if (msg) setError(msg)
    else {
      setUrl('')
      setUrlMode(false)
      setError(null)
    }
  }
  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files')
  return (
    <div
      contentEditable={false}
      data-lh-dropzone=""
      onDragEnter={(e) => {
        if (hasFiles(e)) {
          e.preventDefault()
          setDragging(true)
        }
      }}
      onDragOver={(e) => {
        if (hasFiles(e)) {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as globalThis.Node)) setDragging(false)
      }}
      onDrop={(e) => {
        const files = Array.from(e.dataTransfer?.files ?? [])
        if (!files.length) return
        e.preventDefault()
        e.stopPropagation()
        setDragging(false)
        onFiles(multiple ? files : files.slice(0, 1))
      }}
      className={`rounded-xl border border-dashed px-4 py-5 transition-colors sm:px-5 ${dragging ? 'border-sky-400 bg-sky-50/60' : 'border-neutral-200 bg-neutral-50/60'} ${className ?? ''}`}
    >
      <div className="flex flex-col items-center gap-3 text-center">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50 text-violet-600">{icon}</span>
        <div>
          <div className="text-[14px] font-semibold text-neutral-800">{title}</div>
          {hint && <div className="mt-0.5 text-[12px] text-neutral-500">{hint}</div>}
        </div>
        {urlMode && onUrl ? (
          <form onSubmit={submit} className="flex w-full max-w-md flex-wrap items-center justify-center gap-2">
            <input
              autoFocus
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Escape') setUrlMode(false)
              }}
              placeholder={urlPlaceholder ?? 'https://'}
              aria-label={linkLabel}
              className="h-8 min-w-0 flex-1 rounded-lg bg-white px-2.5 text-[13px] text-neutral-800 shadow-[0_0_0_1px_rgba(0,0,0,0.1)] outline-none focus:shadow-[0_0_0_1px_rgba(0,0,0,0.25),0_0_0_3px_rgba(0,0,0,0.05)]"
            />
            <button type="submit" className={buttonClass('primary', 'sm')}>
              {addLabel}
            </button>
          </form>
        ) : (
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button type="button" className={buttonClass('primary', 'sm')} onClick={() => pickFiles(accept, !!multiple, onFiles)}>
              <UploadSimple size={13} weight="bold" />
              {actionLabel}
            </button>
            {onUrl && (
              <button type="button" className={buttonClass('secondary', 'sm')} onClick={() => setUrlMode(true)}>
                <LinkSimple size={13} />
                {linkLabel}
              </button>
            )}
          </div>
        )}
        {error && (
          <p role="alert" className="m-0 text-xs text-rose-600">
            {error}
          </p>
        )}
        {children}
      </div>
    </div>
  )
}
